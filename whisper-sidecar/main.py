"""
Local faster-whisper streaming sidecar.

A tiny WebSocket server that accepts a stream of raw Int16 PCM (mono, 16 kHz)
audio frames and emits transcript segments as JSON. The Node server (server.ts)
opens ONE connection per audio channel (mic vs meeting tab), so speaker
attribution ("me" vs "them") is handled upstream by which connection a segment
arrived on — no diarization needed here.

Protocol (per connection)
  → first text message: {"type": "config", "profile": "capable" | "modest"}
  → then binary messages: little-endian Int16 PCM, mono, 16 kHz
  ← text messages: {"type": "segment", "text": str, "interim": bool, "startMs": int}
  ← text messages: {"type": "error", "message": str}

Chunking strategy (near-real-time)
  Audio accumulates in a buffer. Every `step` seconds of fresh audio we transcribe
  the un-finalized buffer and emit an *interim* segment. When we detect a pause
  (RMS below threshold for `silence` seconds) or the buffer reaches `max_segment`
  seconds, we finalize: emit a *final* segment and reset the buffer.

Run:  python3 whisper-sidecar/main.py   (reads WHISPER_SIDECAR_PORT / WHISPER_PROFILE)
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import dataclass

import numpy as np
import websockets

try:
    from faster_whisper import WhisperModel
except ImportError:  # pragma: no cover - dependency guard
    print(
        "faster-whisper is not installed. Run: pip install -r whisper-sidecar/requirements.txt",
        file=sys.stderr,
    )
    raise

SAMPLE_RATE = 16_000
INT16_MAX = 32_768.0


@dataclass(frozen=True)
class Profile:
    model: str
    compute_type: str
    step_s: float          # transcribe interim this often (seconds of new audio)
    max_segment_s: float   # force-finalize a segment at this length
    silence_s: float       # finalize after this much trailing silence
    rms_threshold: float   # below this RMS counts as silence


PROFILES: dict[str, Profile] = {
    # Best accuracy + lowest latency on a capable machine (Apple Silicon / GPU).
    "capable": Profile(
        model="large-v3",
        compute_type="auto",
        step_s=1.0,
        max_segment_s=8.0,
        silence_s=0.6,
        rms_threshold=0.008,
    ),
    # Lighter model + longer chunks for a modest machine. A few seconds of lag.
    "modest": Profile(
        model="base",
        compute_type="int8",
        step_s=2.5,
        max_segment_s=12.0,
        silence_s=0.8,
        rms_threshold=0.008,
    ),
}


def pick_device_and_compute(requested_compute: str) -> tuple[str, str]:
    """Prefer CUDA when available; otherwise CPU with an int8 compute type."""
    try:
        import ctranslate2  # faster-whisper's backend

        if ctranslate2.get_cuda_device_count() > 0:
            compute = "float16" if requested_compute == "auto" else requested_compute
            return "cuda", compute
    except Exception:
        pass
    compute = "int8" if requested_compute == "auto" else requested_compute
    return "cpu", compute


# Models are expensive to load; cache one per (model, device, compute).
_model_cache: dict[tuple[str, str, str], WhisperModel] = {}


def get_model(profile: Profile) -> WhisperModel:
    device, compute = pick_device_and_compute(profile.compute_type)
    key = (profile.model, device, compute)
    if key not in _model_cache:
        print(f"[whisper] loading {profile.model} on {device} ({compute})", flush=True)
        _model_cache[key] = WhisperModel(profile.model, device=device, compute_type=compute)
    return _model_cache[key]


def transcribe(model: WhisperModel, audio: np.ndarray) -> str:
    """Run whisper on a float32 mono buffer and return the joined text."""
    segments, _ = model.transcribe(
        audio,
        beam_size=1,          # greedy for speed in a live setting
        vad_filter=True,
        condition_on_previous_text=False,
        language=None,        # auto-detect
    )
    return " ".join(seg.text.strip() for seg in segments).strip()


class StreamSession:
    """Per-connection buffering + chunked transcription state."""

    def __init__(self, profile: Profile, model: WhisperModel) -> None:
        self.profile = profile
        self.model = model
        self.buffer = np.zeros(0, dtype=np.float32)
        self.total_samples = 0          # samples seen across the whole session
        self.segment_start_sample = 0   # sample index where the current segment began
        self.samples_since_step = 0
        self.trailing_silence_samples = 0

    def add_pcm(self, pcm: bytes) -> None:
        samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / INT16_MAX
        self.buffer = np.concatenate([self.buffer, samples])
        self.total_samples += samples.size
        self.samples_since_step += samples.size
        # Track trailing silence for pause-based finalization.
        if samples.size:
            rms = float(np.sqrt(np.mean(np.square(samples))))
            if rms < self.profile.rms_threshold:
                self.trailing_silence_samples += samples.size
            else:
                self.trailing_silence_samples = 0

    @property
    def _start_ms(self) -> int:
        return int(self.segment_start_sample / SAMPLE_RATE * 1000)

    def should_step(self) -> bool:
        return self.samples_since_step >= self.profile.step_s * SAMPLE_RATE

    def should_finalize(self) -> bool:
        buffered_s = self.buffer.size / SAMPLE_RATE
        silent_s = self.trailing_silence_samples / SAMPLE_RATE
        has_audio = self.buffer.size > SAMPLE_RATE * 0.4  # ignore <0.4s blips
        return has_audio and (
            buffered_s >= self.profile.max_segment_s
            or silent_s >= self.profile.silence_s
        )

    def run_interim(self) -> dict | None:
        self.samples_since_step = 0
        if self.buffer.size < SAMPLE_RATE * 0.4:
            return None
        text = transcribe(self.model, self.buffer)
        if not text:
            return None
        return {"type": "segment", "text": text, "interim": True, "startMs": self._start_ms}

    def run_final(self) -> dict | None:
        text = transcribe(self.model, self.buffer) if self.buffer.size else ""
        start_ms = self._start_ms
        # Reset for the next segment.
        self.segment_start_sample = self.total_samples
        self.buffer = np.zeros(0, dtype=np.float32)
        self.samples_since_step = 0
        self.trailing_silence_samples = 0
        if not text:
            return None
        return {"type": "segment", "text": text, "interim": False, "startMs": start_ms}


async def handle(ws: websockets.WebSocketServerProtocol) -> None:
    session: StreamSession | None = None
    loop = asyncio.get_running_loop()
    try:
        async for message in ws:
            if isinstance(message, str):
                try:
                    msg = json.loads(message)
                except json.JSONDecodeError:
                    continue
                if msg.get("type") == "config":
                    profile = PROFILES.get(msg.get("profile", ""), PROFILES["capable"])
                    model = await loop.run_in_executor(None, get_model, profile)
                    session = StreamSession(profile, model)
                    await ws.send(json.dumps({"type": "ready"}))
                continue

            # Binary audio frame.
            if session is None:
                await ws.send(json.dumps({"type": "error", "message": "audio before config"}))
                continue
            session.add_pcm(message)

            if session.should_finalize():
                out = await loop.run_in_executor(None, session.run_final)
                if out:
                    await ws.send(json.dumps(out))
            elif session.should_step():
                out = await loop.run_in_executor(None, session.run_interim)
                if out:
                    await ws.send(json.dumps(out))
    except websockets.ConnectionClosed:
        pass
    finally:
        # Flush any remaining audio as a final segment.
        if session is not None and session.buffer.size:
            out = await loop.run_in_executor(None, session.run_final)
            if out:
                try:
                    await ws.send(json.dumps(out))
                except websockets.ConnectionClosed:
                    pass


async def main() -> None:
    port = int(os.environ.get("WHISPER_SIDECAR_PORT", "8765"))
    # Warm the default model so the first meeting doesn't pay load latency mid-call.
    default_profile = PROFILES.get(os.environ.get("WHISPER_PROFILE", "capable"), PROFILES["capable"])
    await asyncio.get_running_loop().run_in_executor(None, get_model, default_profile)
    print(f"[whisper] sidecar listening on ws://127.0.0.1:{port}", flush=True)
    async with websockets.serve(handle, "127.0.0.1", port, max_size=None):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass

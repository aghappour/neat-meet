# Whisper sidecar

Local, private speech-to-text for neat-meet using
[`faster-whisper`](https://github.com/SYSTRAN/faster-whisper). No audio leaves
your machine and there is no per-minute cost.

## Setup

```bash
cd whisper-sidecar
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run

The Node server (`server.ts`) spawns this automatically in development, using
`whisper-sidecar/.venv/bin/python3` when that venv exists (override with
`WHISPER_PYTHON`). To run it standalone:

```bash
WHISPER_PROFILE=modest WHISPER_SIDECAR_PORT=8765 python3 main.py
```

## Profiles

| Profile   | Model       | Latency        | Use when |
|-----------|-------------|----------------|----------|
| `modest`  | `base`      | ~2.5s chunks   | Default. Any CPU-only machine |
| `capable` | `large-v3`  | ~1s chunks     | A CUDA GPU is present |

`modest` is the default. `capable` is only worth selecting with a CUDA GPU:
CTranslate2 has no Metal/MPS backend, so Apple Silicon runs on CPU where
`large-v3` transcribes many times slower than real time — the buffer never
drains and the transcript pane stays empty. When no CUDA device is detected,
`resolve_profile` downgrades `capable` to `small` and logs that it did.

The profile is selectable at runtime from the app UI (the server restarts the
sidecar connection with the new profile). The first run downloads the model
(cached under `~/.cache/huggingface`).

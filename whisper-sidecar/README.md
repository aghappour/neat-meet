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

The Node server (`server.ts`) spawns this automatically in development. To run it
standalone:

```bash
WHISPER_PROFILE=capable WHISPER_SIDECAR_PORT=8765 python3 main.py
```

## Profiles

| Profile   | Model       | Latency        | Use when |
|-----------|-------------|----------------|----------|
| `capable` | `large-v3`  | ~1s chunks     | Apple Silicon or a GPU |
| `modest`  | `base`      | ~2.5s chunks   | Lower-powered machine |

The profile is selectable at runtime from the app UI (the server restarts the
sidecar connection with the new profile). The first run downloads the model
(cached under `~/.cache/huggingface`).

# neat-meet

A real-time meeting assistant. While you're in a meeting it gives you a **live
transcript**, a **rolling summary**, and **shareable insights** grounded in your
connected knowledge (Notion, Slack, Google Drive) — plus one-click sharing to
Slack, Notion, Gmail, and Telegram.

Everything runs locally: audio is captured in your browser, transcribed by a
local Whisper sidecar, and only the transcript text is sent to Claude for the
summary and insights.

## How it works

```
Browser tab (React)
  ├─ mic  (getUserMedia)        ─┐
  ├─ meeting tab audio          ─┤ mixed → 16kHz PCM (AudioWorklet)
  │  (getDisplayMedia)           │
  └─ WebSocket  /api/audio  ─────┘─►  Node server (server.ts)
                                        ├─ faster-whisper sidecar (local STT)
                                        └─ per-session transcript buffer
  panes ◄── /api/summary   → Claude (rolling summary)
        ◄── /api/insights  → Claude + MCP connectors (grounded insights)
        ──► /api/share      → Slack / Notion / Gmail / Telegram
```

**Works with AirPods (or any headset):** the far-end participants are captured
from the *meeting tab's* audio stream, and your voice from the mic — neither
depends on the output device. Join meetings **in a browser tab** (Google Meet, or
Zoom/Teams web) and tick "Share tab audio" in the share picker.

## Setup

Requires Node 20+ and Python 3.10+.

```bash
# 1. JS deps
npm install

# 2. Whisper sidecar (local, private STT)
cd whisper-sidecar
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ..

# 3. Config
cp .env.example .env   # then fill in ANTHROPIC_API_KEY (+ any connectors)
```

## Run

```bash
npm run dev
```

Open http://localhost:3000, click **Start meeting**, and in the share picker
choose your meeting tab with **Share tab audio** enabled. The server spawns the
Whisper sidecar automatically.

## Configuration

See `.env.example`. Highlights:

- `ANTHROPIC_API_KEY` — required, for summary + insights.
- `WHISPER_PROFILE=capable|modest` — model size / latency; also switchable in the
  UI. `capable` (large-v3, ~1s chunks) for Apple Silicon / GPU; `modest`
  (base, longer chunks) for lower-powered machines.
- `TRANSCRIPTION_PROVIDER=whisper|deepgram` — swap in Deepgram (needs
  `DEEPGRAM_API_KEY`) for lowest latency + speaker labels.
- `{NOTION,SLACK,GDRIVE,ZAPIER}_MCP_URL` / `_MCP_TOKEN` — hosted MCP endpoints
  for grounding + sharing. Each is optional and skipped gracefully if unset.
  **Zapier** is the fan-out for **Gmail and Telegram** — enable those Zapier
  actions and no separate OAuth is needed.

### Connections

Insights are grounded and shared through the **Claude MCP connector**: the app
attaches your configured MCP servers to Claude, which searches them for relevant
material and can post back. Configure only the services you want; the app runs
with whatever subset you provide.

**Signal** has no official API or Zapier integration, so it is intentionally not
wired up. The only way in is an unofficial `signal-cli` linked-device bridge run
locally — a possible future add-on, not part of this build.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start the app + spawn the Whisper sidecar |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (session store, JSON extraction) |
| `npm run sidecar` | Run the Whisper sidecar standalone |

## Project layout

- `server.ts` — custom Next server + `/api/audio` WebSocket relay; spawns the sidecar
- `whisper-sidecar/` — Python `faster-whisper` streaming STT
- `lib/transcription/` — pluggable STT interface (`whisper`, `deepgram`)
- `lib/session-store.ts` — per-session transcript buffer
- `lib/connectors.ts` — MCP connector registry (enabled-if-configured)
- `lib/claude.ts` — Anthropic client + shared helpers
- `app/api/{summary,insights,share}/` — Claude-backed endpoints
- `components/` + `app/page.tsx` — capture + transcript / summary / insight UI

## Privacy

Audio never leaves your machine — it's transcribed locally by Whisper. Only the
resulting transcript text is sent to Claude (for summary/insights) and to the
connectors you explicitly configure. Sessions are in-memory and ephemeral.

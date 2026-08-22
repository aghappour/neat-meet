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
npm install
npm run setup   # venv + Whisper deps + seeds .env from .env.example
```

Then put your Anthropic key in `.env` (`ANTHROPIC_API_KEY=…`) or use OAuth
(`ant auth login`, then `npm run dev:auth`). The API is billed separately from a
Claude subscription — add credits at <https://console.anthropic.com/settings/billing>.

<details><summary>Manual setup (what <code>npm run setup</code> does)</summary>

```bash
npm install
cd whisper-sidecar
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ..
cp .env.example .env
```
</details>

## Run

```bash
npm run dev
```

Open http://localhost:3000, click **Start meeting**, and in the share picker
choose your meeting tab with **Share tab audio** enabled. The server spawns the
Whisper sidecar automatically.

- **Transcript pane** — each distinct speaker gets a chip at the top; click one to
  **rename** them. The name is used everywhere, including in what's sent to Claude.
- **Rolling summary** — refreshes automatically as the conversation grows (toggle
  **Auto**); each summary covers the **whole meeting so far**, and past versions are
  kept — step through them with **◀ / ▶**.
- **Insights** — **Generate** grounds talking points in your connected tools; like
  the summary they consider the full meeting and keep a browsable history.
- **Shared context** — the meeting **chat** and **shared links** (via the Meet
  extension) appear inline in the transcript timeline and feed the summary/insights.
- **Capture slide** — while live, click **📷 Capture slide** to send the current
  shared frame (e.g. a deck) to Claude, which extracts its content into the
  meeting context. Opt-in per capture — see Privacy.

### Google Meet speaker names

neat-meet only receives the meeting tab's *audio*, so on its own it labels the far
end "Participant." To get **real per-person names** — plus the **chat and shared
links** — load the companion Chrome extension in [`extension/`](extension/), turn
on Meet's live captions, and open the chat panel. It reads Meet's
speaker-attributed captions and chat and streams them in. While captions are
flowing they become the transcript source and local Whisper is paused (no double
transcription). See [`extension/README.md`](extension/README.md) to install.

## Configuration

See `.env.example`. Highlights:

- **Anthropic credentials** (for summary + insights) — either set `ANTHROPIC_API_KEY`,
  or manage no raw key and run `ant auth login` (the Anthropic CLI); the app resolves
  the OAuth profile automatically. If it isn't picked up, run
  `eval "$(ant auth print-credentials --env)"` before starting.
- **Cost controls** — summaries run in *delta mode* (each refresh sends only what's
  new plus the prior summary; silence costs nothing) on the cheap `SUMMARY_MODEL`
  (Haiku 4.5 by default); insights use `CLAUDE_MODEL` (Sonnet). Per-call size is
  bounded by `TRANSCRIPT_MAX_CHARS` / `CONTEXT_MAX_CHARS`.
- `WHISPER_PROFILE=capable|modest` — model size / latency; also switchable in the
  UI. `capable` (large-v3, ~1s chunks) for Apple Silicon / GPU; `modest`
  (base, longer chunks) for lower-powered machines.
- `TRANSCRIPTION_PROVIDER=whisper|deepgram` — swap in Deepgram (needs
  `DEEPGRAM_API_KEY`) for lowest latency + speaker labels.
- `{NOTION,SLACK,GDRIVE,ZAPIER}_MCP_URL` / `_MCP_TOKEN` — hosted MCP endpoints
  for grounding + sharing. A connector turns on as soon as its `_MCP_URL` is set;
  the `_MCP_TOKEN` is optional (URL-embedded-auth servers like Zapier need no token).
  **Zapier** is the fan-out for **Gmail and Telegram** — generate a URL at
  <https://mcp.zapier.com>, enable those actions, and leave `ZAPIER_MCP_TOKEN` blank.

### Connections

Insights are grounded and shared through the **Claude MCP connector**: the app
attaches your configured MCP servers to Claude, which searches them for relevant
material and can post back. Configure only the services you want; the app runs
with whatever subset you provide.

**Signal** has no official API or Zapier integration, so it is delivered by an
**unofficial local `signal-cli` bridge** instead of a connector: signal-cli links
to your phone as a secondary device and runs as a local daemon; the app talks to
it over localhost only. Setup (once): install
[signal-cli](https://github.com/AsamK/signal-cli), run `signal-cli link -n
"neat-meet"` and scan the QR with your phone, start `signal-cli daemon --http
127.0.0.1:8686`, and set `SIGNAL_CLI_URL=http://127.0.0.1:8686/api/v1/rpc` in
`.env`. Share destinations are a phone number (`+1555…`) or a signal-cli group
id. Caveats: unofficial (can break on Signal updates) and uses one linked-device
slot.

### Message archive (Signal + WhatsApp → agent memory)

Optionally, neat-meet can **archive your Signal and WhatsApp messages — text and
media — locally** and serve them back as searchable memory for your agents:

- **Signal** — the same local signal-cli daemon used for sharing can also
  *receive*: set `SIGNAL_INGEST=1` and incoming messages (plus the ones you send
  from your phone) are archived, attachments included.
- **WhatsApp** — via the official Business Cloud API webhook
  (`/api/messages/whatsapp`), or a token-protected drop-off (`POST
  /api/messages`) for a personal-account bridge you run yourself.
- **Agent memory** — an MCP server (`npm run mcp:messages`) exposes
  `search_messages`, `get_message_context` (a token-bounded prompt block),
  `list_chats`, and `get_media` (images viewable inline); the same data is
  available over HTTP at `/api/messages` and `/api/messages/context`.

The archive is plain JSONL + files under `data/messages/` (gitignored) and
never leaves your machine on its own. Full setup, the personal-WhatsApp ToS
caveats, and a bridge recipe: [`docs/MESSAGES.md`](docs/MESSAGES.md).

### Redaction controls

Two per-meeting toggles in the header (reset each meeting):

- **Hold connectors** — a privacy hold: insights run from the meeting text alone
  (no MCP servers attached), and sharing/exporting is disabled outright.
- **Scrub PII** — emails, phone numbers, SSNs, card numbers, and IPs are redacted
  (locally, by regex) from all text before it leaves for Claude or any connector.
  Limitation: a captured slide **image** can't be scrubbed — only the text
  extracted from it is.

### Post-meeting export

Once there's a transcript, header buttons export the meeting — final summary,
insights, shared docs, captured slides, full transcript, and chat — as:

- **⬇ .md** — a local markdown download (no API call; works even with connectors held)
- **→ Notion / → Drive** — a new page/document created through your connector
  (shown only when configured; respects both redaction toggles)

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run setup` | venv + Whisper deps + seed `.env` (one-time) |
| `npm run dev` | Start the app + spawn the Whisper sidecar |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (session store, JSON extraction) |
| `npm run sidecar` | Run the Whisper sidecar standalone |
| `npm run mcp:messages` | Serve the message archive to agents over MCP (stdio) |

## Project layout

- `server.ts` — custom Next server + `/api/audio` WebSocket relay; spawns the sidecar
- `whisper-sidecar/` — Python `faster-whisper` streaming STT
- `lib/transcription/` — pluggable STT interface (`whisper`, `deepgram`)
- `lib/session-store.ts` — per-session transcript buffer
- `lib/connectors.ts` — MCP connector registry (enabled-if-configured)
- `lib/claude.ts` — Anthropic client + shared helpers
- `app/api/{summary,insights,share}/` — Claude-backed endpoints
- `lib/messages/` + `app/api/messages/` — local Signal/WhatsApp message archive + memory API
- `scripts/messages-mcp.ts` — MCP server exposing the archive to agents
- `components/` + `app/page.tsx` — capture + transcript / summary / insight UI
- `extension/` — Chrome extension that imports Google Meet speaker-attributed captions

## Privacy

Audio never leaves your machine — it's transcribed locally by Whisper. Only the
resulting transcript text (plus chat/links you receive via the extension) is sent
to Claude for summary/insights, and to the connectors you explicitly configure.
Sessions are in-memory and ephemeral.

**One deliberate exception — Capture slide.** When (and only when) you click
**📷 Capture slide**, that single video frame is sent to Claude to extract its
content. It's never automatic and no frame is stored. If you never click it, no
image ever leaves your machine.

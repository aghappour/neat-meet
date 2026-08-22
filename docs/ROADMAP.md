# neat-meet — features, privacy tests, next steps

A living overview of what's built, what the privacy guarantees are (and how
they're tested), and where to go next.

## Features (built)

### Capture & transcript
- **Browser capture** — mic via `getUserMedia` + meeting-tab audio via
  `getDisplayMedia`, mixed to 16 kHz Int16 PCM in an `AudioWorklet` and streamed
  over a WebSocket (`/api/audio`). Works with AirPods/any headset (capture is at
  the source, independent of output device).
- **Local transcription** — Python `faster-whisper` sidecar, spawned by the
  server. Speaker attribution from the audio channel (mic = you, tab = far end),
  so no diarization needed.
- **Profile toggle** — `capable` (large-v3, GPU) vs `modest` (base, CPU),
  switchable at runtime from the UI.
- **Pluggable providers** — Deepgram is a drop-in behind the same interface.

### Speaker names
- **Editable labels** — click a speaker chip to rename; distinct color per
  speaker; names flow into the summary/insight prompts.
- **Persistence** — names are saved to `localStorage` and restored next time.
- **Roster quick-pick** — every name you assign is remembered and offered as an
  autocomplete when renaming.
- **Google Meet import** — a companion Chrome extension (`extension/`) reads
  Meet's speaker-attributed live captions and streams them in; while captions
  flow they become the transcript source and local Whisper is suppressed (no
  double transcription). Shown with a "Meet captions" badge.

### Shared context (non-spoken)
- **Meeting chat & shared links** — the Meet extension also reads the chat panel;
  messages appear in the transcript timeline and links are tagged as shared
  documents. All of it feeds the summary/insight prompts.
- **Capture slide (video frame → context)** — while live, one click sends the
  current shared frame to Claude, which extracts its content (title, bullets,
  figures) into the meeting context. Opt-in per capture; see Privacy.

### Intelligence
- **Rolling summary** — Claude returns gist / decisions / open questions /
  action items. Auto-refreshes on an interval while live (only when there's new
  transcript, never overlapping), and every version is kept and browsable.
- **Grounded insights** — Claude + the MCP connector beta searches your Notion /
  Slack / Google Drive / Zapier and returns sharable, cited cards. Also kept as
  browsable history.
- **Cumulative** — both summary and insights consider the whole meeting so far,
  not just a trailing window.
- **Token guard** — a configurable cap (`TRANSCRIPT_MAX_CHARS` / `CONTEXT_MAX_CHARS`)
  bounds per-call cost on long meetings by sending the most recent portion; the
  summary folds in its previous version so it stays cumulative even when older
  lines are trimmed. Trimmed runs show a "condensed" chip.
- **Cost optimization** — the rolling summary runs in *delta mode*: after the
  first call, each refresh sends only the previous summary + the new lines since
  (watermarked by segment id), and skips the API entirely when nothing new was
  said. The summary and slide-extraction paths default to Haiku 4.5
  (`SUMMARY_MODEL`, ~3x cheaper than Sonnet); insights keep `CLAUDE_MODEL`
  (Sonnet) for MCP tool use. Auto-refresh runs at 30s.

### Privacy & delivery
- **Redaction controls** — per-meeting **Hold connectors** (insights run
  transcript-only; sharing/export disabled) and **Scrub PII** (local regex
  redaction of emails/phones/SSNs/cards/IPs before text leaves for Claude or a
  connector; slide images can't be scrubbed — only their extracted text).
- **Signal sharing** — via an unofficial local `signal-cli` linked-device bridge
  (`SIGNAL_CLI_URL`); localhost-only, never routed through MCP/Zapier.
- **Post-meeting export** — one click to a local `.md` download (no API), or to
  a new Notion page / Drive document through the connector layer.
- **One-click share** — push an insight to Slack / Notion / Gmail / Telegram
  (Gmail + Telegram fan out through Zapier).

### Message archive (Signal + WhatsApp → agent memory)
- **Local archive** — messages + media stored as JSONL + hash-named files under
  `data/messages/` (gitignored); idempotent ingest (deduped by platform message
  id), crash-tolerant log loading.
- **Signal ingest** — opt-in (`SIGNAL_INGEST=1`) SSE consumer of the local
  signal-cli daemon; archives incoming *and* your own phone-sent messages
  (device sync), copies attachments; reconnects with backoff.
- **WhatsApp ingest** — official Business Cloud API webhook
  (verification handshake, optional `X-Hub-Signature-256` check, Graph API media
  download) + a token-protected generic bridge endpoint for personal-account
  bridges the user runs themselves (ToS caveats documented in
  `docs/MESSAGES.md`).
- **Agent memory** — `get_message_context` builds a character-budgeted,
  optionally PII-scrubbed prompt block (newest-kept trim, like the meeting token
  guard); exposed via an MCP stdio server (`npm run mcp:messages`:
  search/context/chats/media-inline) and HTTP (`/api/messages`,
  `/api/messages/context`, `/api/messages/media/:id`).

### Setup & ops
- **Credentials** — `ANTHROPIC_API_KEY`, or OAuth via `ant auth login`
  (`npm run dev:auth`). No raw key required.
- **One-command setup** — `npm run setup` (venv + Whisper deps + seed `.env`).

## Privacy

### Guarantees
1. **Audio never leaves the machine.** It's transcribed locally by Whisper; only
   the resulting *text* is sent onward.
2. **Only text goes to Claude** (transcript + chat/links) — **with one opt-in
   exception:** clicking **Capture slide** sends that single video frame to
   Claude to extract its content. Never automatic; no frame is stored. Skip the
   button and no image ever leaves the machine.
3. **Connectors are opt-in.** A service is contacted only if you set its
   `*_MCP_URL`; a token is sent only if you set `*_MCP_TOKEN`.
4. **Sessions are ephemeral and in-memory**, isolated per meeting, and can be
   cleared with no residue.
5. **Speaker names are local** — stored in your browser's `localStorage`, sent
   onward only as labels inside the transcript text you already send.
6. **The Meet extension** runs only on `meet.google.com`, reads only caption
   text, and sends only to `localhost`.

### What the tests pin (`npm test` — 59 tests)
- **`lib/privacy.test.ts`**
  - No connector is attached when none is configured; no share target offered.
  - An auth token is never sent unless explicitly set.
  - Only the connectors you configured are attached.
  - The transcript store retains **only text metadata — never audio bytes**
    (asserts no `Buffer`/typed-array is ever stored, and the stored shape is
    exactly the text fields).
  - Interim (unfinalized) speech is not retained.
  - Sessions are isolated from each other.
  - Clearing a session leaves no residue.
- **`lib/connectors.test.ts`** — enabled-if-configured, token-optional, target routing.
- **`lib/session-store.test.ts`** — id assignment, finals-only retention, name
  overrides, caption routing, and context (chat → chat/doc, slide extraction,
  context-as-content).
- **`lib/claude.test.ts`** — client resolution + tolerant JSON parsing.
- **`lib/redact.test.ts`** — the PII scrubber redacts emails/phones/SSNs/cards/IPs
  and leaves ordinary meeting text (years, ids, short numbers) untouched.
- **`lib/export.test.ts`** — the export markdown compiles all sections and omits
  empty ones.
- **`lib/messages/*.test.ts`** — archive persistence/dedupe/reload, media
  content-hash storage and path-traversal rejection, Signal envelope
  normalization (incoming, group, sent-sync, receipts ignored), WhatsApp webhook
  normalization (statuses ignored) and bridge validation, and the context
  builder's budget trim + PII scrub.
- Signal routing: `connectorForTarget("signal")` is pinned to null — Signal can
  never silently fall through to an MCP/Zapier connector.

### Honest gaps (not yet automated)
- The **extension → server → app caption path** is verified by a manual smoke
  script, not a committed CI test. *(Next step: promote it to an integration test.)*
- No test asserts the **API route request bodies** exclude non-transcript data
  (route construction isn't unit-isolated from the network call yet).
- No automated check that the **Meet extension** only talks to `localhost`
  (enforced by manifest host permissions + code review, not a test).
- The **Whisper sidecar** isn't exercised in CI (Python deps aren't installed there).

## Next steps

### P1 — correctness & coverage
- Promote the WebSocket **audio + caption relay smoke test** to a committed
  integration test so the privacy/routing path is covered in CI.
- Add a **CI workflow** running `typecheck` + `test` + `build` on push.
- Reconcile the toolchain: the lockfile pins **vitest 4** but this environment
  resolved vitest 2 — verify a clean `npm ci` installs the intended versions.

### P2 — product
- **Graceful billing/error surfaces** — show "add API credits" / "invalid key"
  inline in the panes instead of a raw error.

### P3 — bigger bets
- **Diarization for the far end** when Meet captions aren't available (or use
  Deepgram speaker labels) to split multiple participants on one audio channel.
- **Meeting-bot transcription** (e.g. self-hosted Vexa, or Recall.ai) as an
  optional real-time multi-party attribution source — documented tradeoff:
  a bot joins and audio leaves the machine.

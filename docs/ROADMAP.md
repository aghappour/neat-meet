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

### Intelligence
- **Rolling summary** — Claude returns gist / decisions / open questions /
  action items. Auto-refreshes on an interval while live (only when there's new
  transcript, never overlapping), and every version is kept and browsable.
- **Grounded insights** — Claude + the MCP connector beta searches your Notion /
  Slack / Google Drive / Zapier and returns sharable, cited cards. Also kept as
  browsable history.
- **Cumulative** — both summary and insights consider the whole meeting so far,
  not just a trailing window.
- **One-click share** — push an insight to Slack / Notion / Gmail / Telegram
  (Gmail + Telegram fan out through Zapier).

### Setup & ops
- **Credentials** — `ANTHROPIC_API_KEY`, or OAuth via `ant auth login`
  (`npm run dev:auth`). No raw key required.
- **One-command setup** — `npm run setup` (venv + Whisper deps + seed `.env`).

## Privacy

### Guarantees
1. **Audio never leaves the machine.** It's transcribed locally by Whisper; only
   the resulting *text* is sent onward.
2. **Only transcript text goes to Claude** (for summary/insights).
3. **Connectors are opt-in.** A service is contacted only if you set its
   `*_MCP_URL`; a token is sent only if you set `*_MCP_TOKEN`.
4. **Sessions are ephemeral and in-memory**, isolated per meeting, and can be
   cleared with no residue.
5. **Speaker names are local** — stored in your browser's `localStorage`, sent
   onward only as labels inside the transcript text you already send.
6. **The Meet extension** runs only on `meet.google.com`, reads only caption
   text, and sends only to `localhost`.

### What the tests pin (`npm test` — 36 tests)
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
  overrides, caption routing to the active session.
- **`lib/claude.test.ts`** — client resolution + tolerant JSON parsing.

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
- **Token/cost guard** for long meetings: cumulative prompts grow unbounded —
  fold older transcript into a running digest, or cap with a visible note.
- **Post-meeting export** — save transcript + final summary + insights to
  Notion / Drive / a markdown file in one click.
- **Redaction controls** — a per-meeting "don't send to connectors" toggle and
  optional PII scrubbing before anything leaves for Claude.
- **Graceful billing/error surfaces** — show "add API credits" / "invalid key"
  inline in the panes instead of a raw error.

### P3 — bigger bets
- **Diarization for the far end** when Meet captions aren't available (or use
  Deepgram speaker labels) to split multiple participants on one audio channel.
- **Meeting-bot transcription** (e.g. self-hosted Vexa, or Recall.ai) as an
  optional real-time multi-party attribution source — documented tradeoff:
  a bot joins and audio leaves the machine.
- **Signal** via an unofficial `signal-cli` linked-device bridge (no official
  API/Zapier path exists).

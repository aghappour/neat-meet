# Message archive — Signal + WhatsApp → local memory for your agents

Archives your Signal and WhatsApp messages (text **and** media) on your own
disk, and exposes them to agents as searchable memory: an MCP server, an HTTP
API, and a token-bounded "context block" builder you can drop into any prompt.

```
Signal phone ──► signal-cli daemon (localhost) ──► SSE /api/v1/events ─┐
WhatsApp Business number ──► Meta Cloud API webhook ──► /api/messages/whatsapp ─┤
WhatsApp personal (bridge you run) ──► POST /api/messages (x-bridge-token) ─┘
                                                                        │
                                              data/messages/messages.jsonl
                                              data/messages/media/<hash>.<ext>
                                                                        │
        agents ◄── MCP (npm run mcp:messages) ◄─────────────────────────┤
        agents ◄── GET /api/messages/context  ◄─────────────────────────┤
            UI ◄── GET /api/messages, /api/messages/media/:id ◄─────────┘
```

Everything is local: the archive is plain JSONL + files under `MESSAGES_DIR`
(default `./data/messages`, gitignored). Ingesting never sends anything
anywhere. What leaves the machine is only what *you* pass to a model, and the
context endpoints support local PII scrubbing (`scrub=1`) before handing text out.

## 1. Signal (personal account — receive + your own sent messages)

Uses the same unofficial local `signal-cli` linked-device bridge the app
already uses for *sending* (see README caveats: unofficial, may break on Signal
updates, occupies a linked-device slot). Receiving is a separate opt-in.

```bash
# once
signal-cli link -n "neat-meet"          # scan the QR with your phone
# every session (or as a service)
signal-cli daemon --http 127.0.0.1:8686
```

`.env`:

```
SIGNAL_CLI_URL=http://127.0.0.1:8686/api/v1/rpc
SIGNAL_INGEST=1
# SIGNAL_ATTACHMENTS_DIR=~/.local/share/signal-cli/attachments   # only if custom
```

Start the app (`npm run dev`). The server streams the daemon's event feed and
archives:

- **incoming messages** (direct + group), with attachments copied out of
  signal-cli's data dir into the archive;
- **messages you send from your phone** (device sync), so conversations are
  complete — they're stored with `fromMe: true` / sender `me`.

Receipts and typing indicators are ignored. If the daemon is down the server
retries with backoff and logs — it never crashes the meeting features.
Re-delivered events are deduped by (sender, timestamp).

> Note: Signal messages are e2e-encrypted in transit, but this archive stores
> them in **plaintext on your disk**. Treat `data/messages/` like you'd treat
> your Signal desktop data — full-disk encryption recommended.

## 2. WhatsApp

There is no official API for *personal* WhatsApp accounts, so there are two
routes with different tradeoffs:

### 2a. Official — Business Cloud API webhook

Meta's sanctioned path, but it only carries traffic on a **WhatsApp Business
number** (free Meta developer app + test/business number).

1. Create a Meta app with the WhatsApp product, get a permanent access token.
2. Point the webhook at `https://<your-host>/api/messages/whatsapp` (Meta
   requires HTTPS — a Cloudflare/ngrok tunnel to localhost works) and pick a
   verify token.
3. `.env`:

```
WHATSAPP_VERIFY_TOKEN=<the token you typed into the Meta console>
WHATSAPP_ACCESS_TOKEN=<Graph API token — needed to download media>
WHATSAPP_APP_SECRET=<app secret — enables webhook signature verification>
```

The route answers Meta's verification handshake (GET) and archives message
events (POST): text, and image/video/audio/document/sticker media downloaded
from the Graph API and stored locally. Statuses (delivered/read) are ignored;
webhook retries are deduped by the `wamid` message id. When
`WHATSAPP_APP_SECRET` is set, requests with a bad `X-Hub-Signature-256` are
rejected.

### 2b. Personal account — bring your own bridge

Unofficial WhatsApp Web bridges (Baileys, whatsmeow, mautrix-whatsapp) can see
your personal chats, but they **violate WhatsApp's Terms of Service and risk
getting your number banned**. That tradeoff is yours, so the app doesn't embed
one — it gives you a local, token-protected drop-off instead:

```
MESSAGES_BRIDGE_TOKEN=<any long random string>
```

Then have your bridge POST normalized messages:

```bash
curl -s http://localhost:3000/api/messages \
  -H 'content-type: application/json' \
  -H "x-bridge-token: $MESSAGES_BRIDGE_TOKEN" \
  -d '{
    "messages": [{
      "platform": "whatsapp",
      "id": "3EB0A9C7...",             // WhatsApp message id (dedupe key)
      "chatId": "12036304@g.us",
      "chatName": "Family",
      "sender": "15550002222",
      "senderName": "Mom",
      "fromMe": false,
      "at": 1700000000000,
      "text": "look at this",
      "media": [{ "contentType": "image/jpeg", "filename": "cat.jpg", "dataBase64": "..." }]
    }]
  }'
```

Minimal Baileys relay sketch (runs as a separate process you own):

```js
import makeWASocket, { useMultiFileAuthState, downloadMediaMessage } from "@whiskeysockets/baileys";

const { state, saveCreds } = await useMultiFileAuthState("./wa-auth");
const sock = makeWASocket({ auth: state });
sock.ev.on("creds.update", saveCreds);
sock.ev.on("messages.upsert", async ({ messages }) => {
  for (const m of messages) {
    const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? m.message?.imageMessage?.caption ?? "";
    const img = m.message?.imageMessage;
    const media = img ? [{ contentType: img.mimetype, dataBase64: (await downloadMediaMessage(m, "buffer", {})).toString("base64") }] : [];
    if (!text && !media.length) continue;
    await fetch("http://localhost:3000/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": process.env.MESSAGES_BRIDGE_TOKEN },
      body: JSON.stringify({ messages: [{ platform: "whatsapp", id: m.key.id, chatId: m.key.remoteJid, sender: m.key.participant ?? m.key.remoteJid, senderName: m.pushName, fromMe: m.key.fromMe, at: Number(m.messageTimestamp) * 1000, text, media }] }),
    });
  }
});
```

The same endpoint also accepts `"platform": "signal"`, if you'd rather script
signal-cli yourself than use the built-in SSE ingest.

## 3. Using the archive as agent memory

### MCP server (recommended for Claude Code / Claude Desktop / SDK agents)

```bash
claude mcp add messages -- npx tsx scripts/messages-mcp.ts     # from the repo dir
# or run it directly: npm run mcp:messages
```

Tools it exposes (all read-only):

| tool | what it does |
|---|---|
| `search_messages` | filter by text / platform / chat / time / has-media, returns JSON rows |
| `get_message_context` | compact prompt-ready block, character-budgeted (newest kept), optional PII scrub |
| `list_chats` | every conversation with counts + latest activity |
| `get_media` | an archived attachment by id — images come back inline, viewable by the model |

### HTTP API (for anything else)

- `GET /api/messages?q=dinner&platform=signal&chat=Family&since=2026-08-01&hasMedia=1&limit=50`
- `GET /api/messages/context?q=project%20x&maxChars=6000&scrub=1` →
  `{ context, count, truncated }` — append `context` to any prompt.
- `GET /api/messages/media/<id>` — serve an archived attachment.

Example: give an agent the last month of a chat as memory:

```bash
curl -s "http://localhost:3000/api/messages/context?chat=Family&since=$(date -d '30 days ago' +%s)000"
```

## Privacy notes

- The archive lives in `data/messages/` (gitignored) and never leaves the
  machine on its own. Ingest paths are localhost/webhook-in only.
- The bridge endpoint is off until `MESSAGES_BRIDGE_TOKEN` is set, and
  authenticated per-request. The WhatsApp webhook is off until
  `WHATSAPP_VERIFY_TOKEN` is set, and signature-checked when
  `WHATSAPP_APP_SECRET` is set.
- Media ids are content hashes; the media routes refuse any other id shape, so
  they cannot be used to read outside the media directory.
- `scrub=1` (HTTP) / `scrub: true` (MCP) runs the same local regex PII
  redaction the meeting features use before text is handed to a model.

# neat-meet — Google Meet captions extension

A tiny companion Chrome extension that reads **Google Meet's live captions**
(which already include each speaker's name) **and the chat panel**, and streams
them to your local neat-meet app. This is how neat-meet gets **real speaker
names** and **the meeting chat / shared links** during a Meet call — the app
itself only receives the meeting tab's audio, not its DOM, so it can't see who's
speaking or what's typed on its own.

- **Captions** → speaker-attributed transcript. Turn on **captions (CC)**.
- **Chat** → chat messages and any shared links appear in neat-meet's timeline
  (links are tagged as shared documents). **Open the chat panel** ("Chat with
  everyone") so the messages are in the DOM to read.

While captions are flowing, neat-meet uses them as the transcript source and
suppresses the local Whisper transcription for that session (so words aren't
transcribed twice). For non-Meet calls, or with the extension off, Whisper
works exactly as before.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Start neat-meet locally (`npm run dev`) and open it at `http://localhost:3000`.
5. Join your meeting at **meet.google.com** and click **Turn on captions (CC)** —
   nothing imports until Meet is actually showing captions.

> **Reload any Meet tab that was already open.** Chrome only injects the content
> script into tabs opened *after* the extension is loaded or updated, so a Meet
> call you already had open won't import until you refresh it. When it's working
> you'll see `[neat-meet] caption reader active` in the Meet tab's console
> (DevTools → Console).

In neat-meet, click **Start meeting** as usual. Speaker-named lines from Meet
will appear in the transcript (with a **Meet captions** badge), and the
summary/insights will use the real names.

## Configuration

- The extension talks to `ws://localhost:3000/api/audio`. If you run neat-meet on
  a different port, edit `NEAT_MEET_URL` in `background.js` and reload the
  extension.

## If captions stop importing after a Meet update

Google obfuscates and periodically changes Meet's CSS class names, which can
break caption scraping. The selectors live at the top of `content.js`
(`SELECTORS`). Open the captions area in devtools, find the speaker-name node and
the text node, add their selectors, and reload the extension. When the region
can't be found you'll see `[neat-meet] captions region not found` in the page
console.

## Privacy

The extension only runs on `meet.google.com`, only reads caption text, and only
sends it to `localhost`. Nothing leaves your machine.

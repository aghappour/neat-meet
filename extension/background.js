// Background service worker: holds the WebSocket to the local neat-meet server.
//
// Why here and not in the content script: Google Meet's page has a strict
// Content-Security-Policy that blocks a page-context script from opening a
// socket to localhost. The service worker isn't bound by the page CSP, so the
// content script reads the caption DOM and forwards lines here to be sent.

const NEAT_MEET_URL = "ws://localhost:3000/api/audio";
const RECONNECT_MS = 2000;

let ws = null;
let reconnectTimer = null;
const queue = [];

function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  try {
    ws = new WebSocket(NEAT_MEET_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = flush;
  ws.onclose = scheduleReconnect;
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, RECONNECT_MS);
}

function flush() {
  while (queue.length && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(queue.shift()));
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || (msg.type !== "caption" && msg.type !== "chat")) return;
  // Cap the backlog so a long offline stretch can't grow unbounded.
  if (queue.length > 500) queue.shift();
  queue.push({ type: msg.type, ...msg.payload });
  connect();
  flush();
});

connect();

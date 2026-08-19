// Reads Google Meet's live captions and forwards each line (speaker + text) to
// the neat-meet background worker, which relays them to the local app.
//
// IMPORTANT: turn on captions in Meet ("CC" / Turn on captions) — this reads
// what Meet renders, so nothing happens until captions are visible.
//
// Meet's DOM is obfuscated and Google changes the class names periodically. The
// selectors below are best-effort with fallbacks; if captions stop importing
// after a Meet update, update SELECTORS (open the captions area in devtools and
// find the speaker-name node and the text node). The console logs "[neat-meet]"
// when it can't find the caption region, which is the usual symptom.

const SELECTORS = {
  // The captions container. Multiple candidates across Meet versions.
  region: [
    'div[jsname="dsyhDe"]',
    ".a4cQT",
    'div[role="region"][aria-label*="aption" i]',
  ],
  // A single speaker's caption block within the region.
  row: [".nMcdL", ".TBMuR", 'div[jsname="dsyhDe"] > div'],
  // The speaker's name within a row.
  name: [".KcIKyf", ".zs7s8d", ".jxFHg", "[data-self-name]"],
  // The spoken text within a row.
  text: ['[jsname="tgaKEf"]', ".bh44bd", ".ygicle", ".iTTPOb"],
};

// How long a caption line must stop changing before we treat it as final.
const FINALIZE_MS = 1200;

const rows = new WeakMap(); // rowEl -> { name, text, timer }
let warnedNoRegion = false;

function firstMatch(root, selectors) {
  for (const sel of selectors) {
    const el = root.querySelector?.(sel);
    if (el) return el;
  }
  return null;
}

function pickText(row, selectors) {
  const el = firstMatch(row, selectors);
  return el ? el.textContent.trim() : "";
}

function currentRows() {
  const region = firstMatch(document, SELECTORS.region);
  if (!region) {
    if (!warnedNoRegion) {
      console.log("[neat-meet] captions region not found — turn on Meet captions (CC).");
      warnedNoRegion = true;
    }
    return [];
  }
  warnedNoRegion = false;
  for (const sel of SELECTORS.row) {
    const found = region.querySelectorAll(sel);
    if (found.length) return Array.from(found);
  }
  // Fallback: treat the region's direct children as rows.
  return Array.from(region.children);
}

function send(name, text, interim) {
  // Meet marks the local participant "You".
  const speaker = /^you\b/i.test(name) ? "me" : "them";
  chrome.runtime.sendMessage({
    type: "caption",
    payload: { speaker, speakerName: name || "Speaker", text, interim },
  });
}

function handleRow(row) {
  const name = pickText(row, SELECTORS.name) || "Speaker";
  let text = pickText(row, SELECTORS.text);
  if (!text) {
    // Fallback: the row's text minus the leading name.
    const whole = row.textContent.trim();
    text = name && whole.startsWith(name) ? whole.slice(name.length).trim() : whole;
  }
  if (!text) return;

  const prev = rows.get(row);
  if (prev && prev.text === text && prev.name === name) return;

  clearTimeout(prev?.timer);
  send(name, text, true); // live/interim update
  const timer = setTimeout(() => send(name, text, false), FINALIZE_MS); // finalize when it settles
  rows.set(row, { name, text, timer });
}

let scheduled = false;
function scan() {
  scheduled = false;
  for (const row of currentRows()) handleRow(row);
}

const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  // Coalesce bursts of caption mutations into one scan per frame.
  requestAnimationFrame(scan);
});

observer.observe(document.body, { childList: true, subtree: true, characterData: true });
console.log("[neat-meet] caption reader active — turn on Meet captions to import speakers.");

// Isolated-world bridge: reads settings from extension storage and hands them
// to inject.js (page world). Audio data is only sent once the page asks for it,
// and again only when the audio list itself changes.
"use strict";
(() => {
  const KEYS = ["enabled", "paused", "tracks", "mode", "gap", "volume", "monitor", "selected", "voices", "inputFilter"];
  let wantTracks = false;

  async function push(withTracks) {
    try {
      const cfg = await chrome.storage.local.get(KEYS);
      const out = { ...cfg };
      out.trackCount = (cfg.tracks || []).length;
      if (!(wantTracks && withTracks)) delete out.tracks;
      window.postMessage({ __loop: true, type: "config", cfg: out }, "*");
    } catch (_) { /* extension reloaded: ignore */ }
  }

  window.addEventListener("message", ev => {
    const d = ev.data;
    if (ev.source !== window || !d || d.__loop !== true) return;
    if (d.type === "needTracks") { wantTracks = true; push(true); }
    else if (d.type === "hello") push(false);
    else if (d.type === "autoPaused") { chrome.storage.local.set({ paused: true }).catch(() => {}); }
    else if (d.type === "statusReply") { window.__loopLastStatus = d.status; }
  });

  try { chrome.storage.onChanged.addListener(changes => push(!!changes.tracks)); } catch (_) {}
  push(false);

  // Answers the popup's "how's this tab doing" check (used for the Destination line).
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.type !== "getStatus") return false;
      const onReply = ev => {
        const d = ev.data;
        if (ev.source !== window || !d || d.__loop !== true || d.type !== "statusReply") return;
        window.removeEventListener("message", onReply);
        clearTimeout(to);
        sendResponse(d.status);
      };
      const to = setTimeout(() => { window.removeEventListener("message", onReply); sendResponse(null); }, 800);
      window.addEventListener("message", onReply);
      window.postMessage({ __loop: true, type: "getStatus" }, "*");
      return true; // keep the message channel open for the async response
    });
  } catch (_) {}
})();

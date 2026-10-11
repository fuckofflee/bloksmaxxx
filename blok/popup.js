"use strict";
const $ = s => document.querySelector(s);
const DEF = { enabled: false, paused: false, tracks: [], mode: "once", gap: 0, volume: 1,
              monitor: false, selected: 0, voices: 1, inputFilter: "all" };
let st = { ...DEF };

const save = p => { Object.assign(st, p); return chrome.storage.local.set(p); };

function ui() {
  const p = $("#power");
  p.textContent = st.enabled ? "ON · microphone replaced" : "OFF";
  p.classList.toggle("on", st.enabled);
  $("#pp").textContent = st.paused ? "▶ Play" : "⏸ Pause";
  $("#pp").classList.toggle("on", st.paused);
  $("#mode").value = st.mode;
  $("#gap").value = st.gap;
  $("#vol").value = st.volume;
  $("#volVal").textContent = Math.round(st.volume * 100) + "%";
  $("#voices").value = st.voices;
  $("#voicesVal").textContent = st.voices;
  $("#inputFilter").value = st.inputFilter;
  $("#monitor").checked = st.monitor;

  const ol = $("#list");
  ol.innerHTML = "";
  st.tracks.forEach((t, i) => {
    const li = document.createElement("li");
    if (i === st.selected) li.className = "sel";
    li.innerHTML = '<span class="n"></span><button title="Remove">✕</button>';
    li.querySelector(".n").textContent = t.name;
    li.onclick = () => { save({ selected: i }); ui(); };
    li.querySelector("button").onclick = e => {
      e.stopPropagation();
      const tracks = st.tracks.filter((_, j) => j !== i);
      save({ tracks, selected: Math.min(st.selected, Math.max(0, tracks.length - 1)) }).then(ui);
    };
    ol.appendChild(li);
  });
  const bytes = st.tracks.reduce((a, t) => a + t.b64.length * 0.75, 0);
  $("#size").textContent = st.tracks.length
    ? st.tracks.length + " file(s), " + (bytes / 1048576).toFixed(1) + " MB"
    : "No audio yet. Add a file before switching ON.";
}

const toB64 = f => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = rej;
  r.readAsDataURL(f);
});

$("#power").onclick = () => save({ enabled: !st.enabled }).then(ui);
$("#pp").onclick = () => save({ paused: !st.paused }).then(ui);
$("#mode").onchange = e => save({ mode: e.target.value });
$("#gap").onchange = e => save({ gap: Math.max(0, +e.target.value || 0) });
$("#vol").oninput = e => { $("#volVal").textContent = Math.round(e.target.value * 100) + "%"; save({ volume: +e.target.value }); };
$("#voices").oninput = e => { $("#voicesVal").textContent = e.target.value; save({ voices: +e.target.value }); };
$("#inputFilter").onchange = e => save({ inputFilter: e.target.value });
$("#monitor").onchange = e => save({ monitor: e.target.checked });

$("#files").onchange = async e => {
  const added = [];
  for (const f of e.target.files) added.push({ name: f.name, mime: f.type, b64: await toB64(f) });
  e.target.value = "";
  await save({ tracks: st.tracks.concat(added) });
  ui();
};

// Another context (the autoplay-once finish, or another popup) changed settings: stay in sync.
chrome.storage.onChanged.addListener(changes => {
  const patch = {};
  for (const k in changes) if (k in DEF) patch[k] = changes[k].newValue;
  if (Object.keys(patch).length) { Object.assign(st, patch); ui(); }
});

/* ---------- destination: which tab is this replacing the mic on? ---------- */
function showDest(text) { $("#dest").textContent = text; }
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const tab = tabs && tabs[0];
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) { showDest("This tab can't be read (browser page)."); return; }
  let host; try { host = new URL(tab.url).hostname; } catch (_) { host = tab.url; }
  showDest(host + " — checking…");
  chrome.tabs.sendMessage(tab.id, { type: "getStatus" }, resp => {
    if (chrome.runtime.lastError || !resp) { showDest(host + " — extension not active on this tab (reload it)."); return; }
    showDest(host + " — " + (resp.active ? "microphone replaced ✓" : resp.enabled ? "ON, waiting for the call to ask for a mic" : "not switched on"));
  });
});

chrome.storage.local.get(Object.keys(DEF)).then(v => { st = { ...DEF, ...v }; ui(); });

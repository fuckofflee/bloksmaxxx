"use strict";
const $ = s => document.querySelector(s);
const out = $("#out"), listEl = $("#list"), statusEl = $("#status");

let ctx, dest, gain, analyser;
let tracks = [];          // {id, name, blob, buffer}
let current = -1, playing = false, src = null, timer = null;

/* ---------- storage (IndexedDB, so files survive reloads) ---------- */
const db = new Promise((res, rej) => {
  const r = indexedDB.open("loop-db", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "id" });
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function tx(mode, fn) {
  const d = await db;
  return new Promise((res, rej) => {
    const t = d.transaction("files", mode);
    const rq = fn(t.objectStore("files"));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = () => rej(t.error);
  });
}
const saveTrack = t => tx("readwrite", s => s.put({ id: t.id, name: t.name, blob: t.blob })).catch(() => {});
const delTrack = id => tx("readwrite", s => s.delete(id)).catch(() => {});

/* ---------- audio graph ---------- */
async function initAudio() {
  if (ctx) { if (ctx.state === "suspended") await ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  dest = ctx.createMediaStreamDestination();
  gain = ctx.createGain();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  gain.gain.value = +$("#vol").value;
  gain.connect(dest);
  gain.connect(analyser);
  out.srcObject = dest.stream;
  await applyDevice();
  await out.play();
  meter();
}

async function applyDevice() {
  const id = $("#device").value;
  if (!("setSinkId" in HTMLMediaElement.prototype)) {
    $("#devStatus").textContent = "This browser cannot choose an output device. Use Chrome or Edge.";
    return;
  }
  try {
    await out.setSinkId(id || "");
    $("#devStatus").textContent = "Output → " + ($("#device").selectedOptions[0]?.text || "default");
  } catch (e) {
    $("#devStatus").textContent = "Cannot use device: " + e.message;
  }
}

async function listDevices() {
  const sel = $("#device"), prev = sel.value;
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audiooutput");
  sel.innerHTML = "";
  devs.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label || "Output " + (i + 1);
    sel.appendChild(o);
  });
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  if (!devs.length) $("#devStatus").textContent = "No output devices found.";
}

$("#detect").onclick = async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true }); // only to reveal device names
    s.getTracks().forEach(t => t.stop());
  } catch (e) { $("#devStatus").textContent = "Permission denied: names stay hidden."; }
  await listDevices();
  if (ctx) applyDevice();
};
$("#device").onchange = () => { if (ctx) applyDevice(); else $("#devStatus").textContent = ""; };
navigator.mediaDevices?.addEventListener?.("devicechange", listDevices);
listDevices();

/* ---------- playlist ---------- */
function render() {
  listEl.innerHTML = "";
  tracks.forEach((t, i) => {
    const li = document.createElement("li");
    if (i === current) li.className = "cur";
    li.innerHTML = '<span class="n"></span><button title="Remove">✕</button>';
    li.querySelector(".n").textContent = t.name;
    li.onclick = () => { if (playing) { clearTimeout(timer); playIndex(i); } else { current = i; render(); } };
    li.querySelector("button").onclick = e => { e.stopPropagation(); removeTrack(i); };
    listEl.appendChild(li);
  });
}

function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|flac|aac|opus)$/i.test(f.name)) continue;
    const t = { id: Date.now() + Math.random(), name: f.name, blob: f, buffer: null };
    tracks.push(t);
    saveTrack(t);
  }
  if (current < 0 && tracks.length) current = 0;
  render();
}

function removeTrack(i) {
  delTrack(tracks[i].id);
  tracks.splice(i, 1);
  if (current >= tracks.length) current = tracks.length - 1;
  if (!tracks.length) stop();
  render();
}

$("#files").onchange = e => { addFiles(e.target.files); e.target.value = ""; };
const drop = $("#drop");
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => addFiles(e.dataTransfer.files));

(async () => {
  try {
    const rows = await tx("readonly", s => s.getAll());
    rows.forEach(r => tracks.push({ ...r, buffer: null }));
    if (tracks.length) current = 0;
    render();
  } catch (_) {}
})();

/* ---------- playback ---------- */
function stopSource() {
  if (src) { src.onended = null; try { src.stop(); } catch (_) {} src.disconnect(); src = null; }
}

async function playIndex(i) {
  stopSource();
  current = i; render();
  const t = tracks[i];
  if (!t) return stop();
  try {
    if (!t.buffer) t.buffer = await ctx.decodeAudioData(await t.blob.arrayBuffer());
  } catch (e) {
    statusEl.textContent = "Cannot decode " + t.name;
    return next();
  }
  if (!playing) return;
  const s = ctx.createBufferSource();
  s.buffer = t.buffer;
  s.connect(gain);
  const seamless = $("#mode").value === "one" && +$("#gap").value === 0;
  s.loop = seamless;
  s.onended = () => { if (src === s) next(); };
  src = s;
  s.start();
  statusEl.textContent = "Playing: " + t.name;
}

function next() {
  if (!playing || !tracks.length) return;
  const mode = $("#mode").value;
  let n = current;
  if (mode === "all") n = (current + 1) % tracks.length;
  else if (mode === "shuffle" && tracks.length > 1) {
    do { n = Math.floor(Math.random() * tracks.length); } while (n === current);
  }
  const gap = Math.max(0, +$("#gap").value) * 1000;
  statusEl.textContent = gap ? "Waiting…" : statusEl.textContent;
  timer = setTimeout(() => playIndex(n), gap);
}

async function start() {
  if (!tracks.length) { statusEl.textContent = "Add at least one audio file."; return; }
  await initAudio();
  playing = true;
  $("#play").classList.add("on");
  playIndex(current < 0 ? 0 : current);
}

function stop() {
  playing = false;
  clearTimeout(timer);
  stopSource();
  $("#play").classList.remove("on");
  statusEl.textContent = "Idle";
}

$("#play").onclick = start;
$("#stop").onclick = stop;
$("#vol").oninput = e => { if (gain) gain.gain.value = +e.target.value; };

/* ---------- level meter ---------- */
function meter() {
  const buf = new Uint8Array(analyser.fftSize);
  (function tick() {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
    $("#bar").style.width = Math.min(100, Math.sqrt(sum / buf.length) * 220) + "%";
    requestAnimationFrame(tick);
  })();
}

/* keep screen awake while playing, when available */
let wl = null;
document.addEventListener("visibilitychange", async () => {
  if (playing && document.visibilityState === "visible" && navigator.wakeLock) {
    try { wl = await navigator.wakeLock.request("screen"); } catch (_) {}
  }
});

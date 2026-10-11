// Runs inside the page (MAIN world) before any page script.
// Replaces microphone capture with a looped audio stream.
"use strict";
(() => {
  if (window.__loopMic) return;
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  window.__loopMic = true;

  const AC = window.AudioContext || window.webkitAudioContext;
  const origGUM = md.getUserMedia.bind(md);
  const origEnum = md.enumerateDevices ? md.enumerateDevices.bind(md) : async () => [];
  const DEV_ID = "loop-virtual", LABEL = "LOOP virtual microphone";

  let cfg = { enabled: false, paused: false, mode: "all", gap: 0, volume: 1,
              monitor: false, selected: 0, voices: 1, inputFilter: "all" };
  let tracks = null;
  let trackWaiters = [];
  let readyRes;
  const ready = new Promise(r => (readyRes = r));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitReady = () => Promise.race([ready, sleep(2500)]);
  const post = (type, extra) => window.postMessage({ __loop: true, type, ...extra }, "*");

  const E = { ctx: null, dest: null, gain: null, monOn: false, group: [], buf: null,
              current: -1, nextIdx: 0, inGap: false, groupStartedAt: 0, token: 0,
              running: false, sig: "", resume: null, lastServedAt: 0, buffers: new Map() };

  /* ---------- config / status messaging ---------- */
  window.addEventListener("message", ev => {
    const d = ev.data;
    if (ev.source !== window || !d || d.__loop !== true) return;
    if (d.type === "config") {
      const { tracks: t, ...rest } = d.cfg || {};
      cfg = { ...cfg, ...rest };
      if (Array.isArray(t)) { tracks = t; trackWaiters.splice(0).forEach(f => f()); }
      readyRes();
      onConfig();
    } else if (d.type === "getStatus") {
      post("statusReply", { status: {
        enabled: cfg.enabled, paused: cfg.paused, active: !!(cfg.enabled && E.running && !cfg.paused),
        host: location.host, lastServedMsAgo: E.lastServedAt ? Date.now() - E.lastServedAt : null,
      } });
    }
  });

  function getTracks() {
    if (tracks) return Promise.resolve(tracks);
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new DOMException("Audio not loaded", "NotReadableError")), 8000);
      trackWaiters.push(() => { clearTimeout(to); res(tracks); });
      post("needTracks");
    });
  }

  const currentSig = () =>
    cfg.mode + "|" + cfg.gap + "|" + cfg.voices + "|" + (cfg.mode !== "all" && cfg.mode !== "shuffle" ? cfg.selected : "") + "|" +
    (tracks ? tracks.map(t => t.name + ":" + t.b64.length).join(",") : "");

  /* ---------- audio engine ---------- */
  async function ensureEngine() {
    if (!E.ctx) {
      E.ctx = new AC();
      E.dest = E.ctx.createMediaStreamDestination();
      E.gain = E.ctx.createGain();
      E.gain.connect(E.dest);
    }
    if (E.ctx.state !== "running") { try { await E.ctx.resume(); } catch (_) {} }
    applyGain();
    applyMonitor();
  }

  function applyGain() { if (E.gain) E.gain.gain.value = Math.max(0, +cfg.volume || 0); }
  function applyMonitor() {
    if (!E.gain) return;
    if (cfg.monitor && !E.monOn) { E.gain.connect(E.ctx.destination); E.monOn = true; }
    else if (!cfg.monitor && E.monOn) { E.gain.disconnect(E.ctx.destination); E.monOn = false; }
  }

  function b64ToBuf(b) {
    const s = atob(b), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  }
  async function decode(t) {
    const k = t.name + ":" + t.b64.length;
    if (!E.buffers.has(k)) E.buffers.set(k, await E.ctx.decodeAudioData(b64ToBuf(t.b64)));
    return E.buffers.get(k);
  }

  const STAGGER = 0.045; // seconds between each echoing voice
  function detach() {
    E.group.forEach(s => { s.onended = null; try { s.stop(); } catch (_) {} try { s.disconnect(); } catch (_) {} });
    E.group = [];
  }
  function stopHard() { E.running = false; E.token++; detach(); E.inGap = false; }

  // The whole chain is driven by audio events (onended), never setTimeout for
  // track-to-track playback, so background-tab timer throttling cannot stall it.
  // "Voices" plays N staggered, slightly detuned copies of the same buffer so the
  // message echoes over itself, like several voices repeating it in a round.
  async function playIndex(i, offset) {
    const my = ++E.token;
    detach();
    E.inGap = false;
    E.current = i;
    let buf;
    try { buf = await decode(tracks[i]); }
    catch (_) { if (my === E.token && E.running) afterTrack(true); return; }
    if (my !== E.token || !E.running) return;

    const V = Math.min(7, Math.max(1, +cfg.voices || 1));
    const off = buf.duration ? (offset || 0) % buf.duration : 0;
    const now = E.ctx.currentTime;
    const group = [];
    for (let v = 0; v < V; v++) {
      const s = E.ctx.createBufferSource();
      s.buffer = buf;
      s.loop = cfg.mode === "one" && !(+cfg.gap > 0);
      let node = s;
      if (V > 1) {
        if (s.detune) { try { s.detune.value = (v - (V - 1) / 2) * 7; } catch (_) {} }
        if (E.ctx.createStereoPanner) {
          const p = E.ctx.createStereoPanner();
          p.pan.value = (V === 1) ? 0 : ((v - (V - 1) / 2) / (V - 1)) * 0.7;
          node.connect(p);
          node = p;
        }
      }
      node.connect(E.gain);
      group.push(s);
      s.start(now + v * STAGGER, off);
    }
    group[V - 1].onended = () => { if (E.group === group) { E.group = []; afterTrack(false); } };
    E.group = group;
    E.buf = buf;
    E.groupStartedAt = now;
    E.lastServedAt = Date.now();
  }

  function afterTrack(failed) {
    if (!E.running || !tracks || !tracks.length) return;
    if (cfg.mode === "once") { autoStop(); return; }
    const n = tracks.length;
    let nx = E.current;
    if (cfg.mode === "all") nx = (E.current + 1) % n;
    else if (cfg.mode === "shuffle" && n > 1) { do { nx = Math.floor(Math.random() * n); } while (nx === E.current); }
    else if (cfg.mode === "one") nx = Math.min(+cfg.selected || 0, n - 1);
    let wait = Math.min(120, Math.max(0, +cfg.gap || 0));
    if (failed) wait = Math.max(wait, 1);
    if (wait > 0) {
      const my = ++E.token;
      E.nextIdx = nx;
      E.inGap = true;
      const rate = E.ctx.sampleRate;
      const s = E.ctx.createBufferSource();
      s.buffer = E.ctx.createBuffer(1, Math.max(1, Math.round(rate * wait)), rate);
      s.connect(E.gain);
      s.onended = () => { if (E.group[0] === s && my === E.token) { E.group = []; playIndex(nx, 0); } };
      E.group = [s];
      s.start();
    } else {
      playIndex(nx, 0);
    }
  }

  // "Play once" finished: silence the loop and tell the UI to flip back to Play.
  function autoStop() {
    stopHard();
    E.resume = null;
    post("autoPaused");
  }

  function startPlayback() {
    stopHard();
    E.sig = currentSig();
    if (!cfg.enabled || cfg.paused || !tracks || !tracks.length) return;
    E.running = true;
    let idx = (cfg.mode === "one" || cfg.mode === "once") ? Math.min(+cfg.selected || 0, tracks.length - 1) : 0, off = 0;
    if (E.resume && E.resume.sig === E.sig && E.resume.idx < tracks.length) { idx = E.resume.idx; off = E.resume.off; }
    E.resume = null;
    playIndex(idx, off);
  }

  function pausePlayback() {
    if (!E.running) return;
    let idx = E.current, off = 0;
    if (E.inGap) idx = E.nextIdx;
    else if (E.group.length && E.buf) off = (E.ctx.currentTime - E.groupStartedAt) % (E.buf.duration || 1);
    E.resume = { idx, off, sig: E.sig };
    stopHard();
  }

  function onConfig() {
    if (!E.ctx) return;
    applyGain(); applyMonitor();
    if (!cfg.enabled) { stopHard(); E.sig = ""; E.resume = null; return; }
    if (cfg.paused) { pausePlayback(); return; }
    if (tracks && (!E.running || currentSig() !== E.sig)) startPlayback();
  }

  // Autoplay policy: resume audio on any user gesture.
  ["pointerdown", "keydown", "touchstart"].forEach(ev =>
    window.addEventListener(ev, () => { if (E.ctx && E.ctx.state !== "running") E.ctx.resume().catch(() => {}); }, true));

  /* ---------- fake microphone track ---------- */
  function fakeTrack() {
    const t = E.dest.stream.getAudioTracks()[0].clone();
    const gs = t.getSettings.bind(t);
    Object.defineProperty(t, "label", { value: LABEL });
    t.getSettings = () => ({ ...gs(), deviceId: DEV_ID, groupId: "loop",
      echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    return t;
  }

  // inputFilter "default": only override requests that don't name a specific
  // real device, so a different real mic picked inside the app's own device
  // menu keeps working.
  function wantsSpecificRealDevice(c) {
    const a = c && c.audio;
    if (!a || typeof a !== "object") return false;
    const d = a.deviceId;
    const id = typeof d === "object" ? (d.exact || d.ideal) : d;
    return !!id && id !== "default" && id !== "communications" && id !== DEV_ID;
  }

  /* ---------- overrides ---------- */
  md.getUserMedia = async function (constraints) {
    const c = constraints || {};
    if (!c.audio) return origGUM(constraints);
    await waitReady();
    if (!cfg.enabled) return origGUM(constraints);
    if (cfg.inputFilter === "default" && wantsSpecificRealDevice(c)) return origGUM(constraints);
    const list = await getTracks();
    if (!list.length) throw new DOMException("Requested device not found", "NotFoundError");
    await ensureEngine();
    if (!cfg.paused && (!E.running || E.sig !== currentSig())) startPlayback();
    E.lastServedAt = Date.now();
    const out = new MediaStream([fakeTrack()]);
    if (c.video) {
      const v = await origGUM({ video: c.video });   // camera stays real
      v.getVideoTracks().forEach(t => out.addTrack(t));
    }
    return out;
  };

  md.enumerateDevices = async function () {
    let list = [];
    try { list = await origEnum(); } catch (_) {}
    await waitReady();
    if (!cfg.enabled || cfg.inputFilter === "default") return list;
    const virt = {
      deviceId: DEV_ID, groupId: "loop", kind: "audioinput", label: LABEL,
      toJSON() { return { deviceId: DEV_ID, groupId: "loop", kind: "audioinput", label: LABEL }; }
    };
    return [virt, ...list.filter(d => d.kind !== "audioinput")];
  };

  if (navigator.permissions && navigator.permissions.query) {
    const oq = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = async function (d) {
      if (d && d.name === "microphone") {
        await waitReady();
        if (cfg.enabled) {
          const et = new EventTarget();
          Object.defineProperties(et, { state: { value: "granted" }, name: { value: "microphone" } });
          et.onchange = null;
          return et;
        }
      }
      return oq(d);
    };
  }

  // Handshake: content.js may load before or after this script, so ask for the
  // config now AND let content.js push it on its own. Whichever order wins works.
  post("hello");
})();

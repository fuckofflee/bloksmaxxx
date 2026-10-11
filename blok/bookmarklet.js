(function () {
  if (window.__loopMic) { var old = document.getElementById("__loopbar"); if (old) old.style.display = "flex"; return; }
  var md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) { alert("LOOP: microphone API not available on this page."); return; }
  window.__loopMic = true;

  var AC = window.AudioContext || window.webkitAudioContext;
  var origGUM = md.getUserMedia.bind(md);
  var origEnum = md.enumerateDevices ? md.enumerateDevices.bind(md) : function () { return Promise.resolve([]); };
  var ctx = new AC();
  var dest = ctx.createMediaStreamDestination();
  var gain = ctx.createGain();
  var monOn = false;
  gain.connect(dest);

  var STAGGER = 0.045;
  var cfg = { mode: "once", gap: 0, volume: 1, voices: 1, monitor: false, inputFilter: "all" };
  var files = [], cur = 0, group = [], buf = null, groupStartedAt = 0, token = 0;
  var running = false, paused = false, resume = null;

  function decode(ab) {
    return new Promise(function (ok, ko) {
      var p = ctx.decodeAudioData(ab, ok, ko);
      if (p && p.catch) p.catch(ko);
    });
  }
  function detach() {
    group.forEach(function (s) { s.onended = null; try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} });
    group = [];
  }
  function stopHard() { running = false; token++; detach(); }

  function playIndex(i, off) {
    var my = ++token;
    detach();
    if (!files.length) return;
    cur = i;
    buf = files[i].buf;
    var V = Math.min(7, Math.max(1, +cfg.voices || 1));
    var o = buf.duration ? (off || 0) % buf.duration : 0;
    var now = ctx.currentTime;
    var g = [];
    for (var v = 0; v < V; v++) {
      var s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = cfg.mode === "one" && !(+cfg.gap > 0);
      var node = s;
      if (V > 1) {
        if (s.detune) { try { s.detune.value = (v - (V - 1) / 2) * 7; } catch (e) {} }
        if (ctx.createStereoPanner) {
          var p2 = ctx.createStereoPanner();
          p2.pan.value = ((v - (V - 1) / 2) / (V - 1)) * 0.7;
          node.connect(p2); node = p2;
        }
      }
      node.connect(gain);
      g.push(s);
      s.start(now + v * STAGGER, o);
    }
    (function (lastS) {
      lastS.onended = function () { if (group === g) { group = []; afterTrack(); } };
    })(g[V - 1]);
    group = g; groupStartedAt = now;
    label();
  }

  function afterTrack() {
    if (!running || !files.length) return;
    if (cfg.mode === "once") { stopHard(); paused = true; resume = null; label(); return; }
    var n = files.length, nx = cur;
    if (cfg.mode === "all") nx = (cur + 1) % n;
    else if (cfg.mode === "shuffle" && n > 1) { do { nx = Math.floor(Math.random() * n); } while (nx === cur); }
    else if (cfg.mode === "one") nx = cur;
    var wait = Math.min(120, Math.max(0, +cfg.gap || 0));
    if (wait > 0) {
      var my = ++token, rate = ctx.sampleRate;
      var s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, Math.max(1, Math.round(rate * wait)), rate);
      s.connect(gain);
      s.onended = function () { if (group[0] === s && my === token) { group = []; playIndex(nx, 0); } };
      group = [s]; s.start();
    } else {
      playIndex(nx, 0);
    }
  }

  function label() {
    status.textContent = !files.length ? "pick audio" : (paused ? "paused: " : "playing: ") + files[cur].name;
    pp.textContent = paused ? "▶" : "⏸";
    pp.disabled = !files.length;
  }

  function startPlay() {
    stopHard();
    running = true;
    var idx = (cfg.mode === "one" || cfg.mode === "once") ? cur : 0, off = 0;
    if (resume) { idx = resume.idx; off = resume.off; }
    resume = null;
    playIndex(idx, off);
  }
  function pausePlay() {
    if (!running) return;
    var off = group.length ? (ctx.currentTime - groupStartedAt) % (buf.duration || 1) : 0;
    resume = { idx: cur, off: off };
    stopHard();
  }
  function toggle() {
    ctx.resume();
    if (!files.length) return;
    if (running) { pausePlay(); paused = true; }
    else { paused = false; startPlay(); }
    label();
  }
  function applyMonitor() {
    if (cfg.monitor && !monOn) { gain.connect(ctx.destination); monOn = true; }
    else if (!cfg.monitor && monOn) { gain.disconnect(ctx.destination); monOn = false; }
  }

  /* ---------- UI ---------- */
  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text != null) e.textContent = text;
    return e;
  }
  var BTN = "background:#000;color:#eee;border:1px solid #666;padding:9px 12px;font:14px monospace";
  var LBL = "display:flex;flex-direction:column;gap:3px;color:#999;font:11px monospace";

  var bar = el("div", "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;gap:8px;align-items:center;padding:10px;background:#000;color:#eee;font:14px monospace;border-top:1px solid #444;flex-wrap:wrap");
  bar.id = "__loopbar";

  var gearBtn = el("button", BTN, "⚙");
  var pick = el("label", BTN + ";cursor:pointer", "AUDIO");
  var input = el("input"); input.type = "file"; input.accept = "audio/*"; input.multiple = true; input.style.display = "none";
  pick.appendChild(input);
  var pp = el("button", BTN, "⏸"); pp.disabled = true;
  var status = el("span", "flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#999", "pick audio");
  var close = el("button", "background:#000;color:#999;border:0;padding:9px;font:14px monospace", "✕");
  [gearBtn, pick, pp, status, close].forEach(function (x) { bar.appendChild(x); });

  var panel = el("div", "display:none;width:100%;order:9;border-top:1px dashed #444;margin-top:8px;padding-top:8px;gap:10px;flex-wrap:wrap");
  panel.style.display = "none";
  panel.style.flexDirection = "row";

  function field(labelText, control) {
    var w = el("label", LBL, labelText);
    w.appendChild(control);
    panel.appendChild(w);
    return control;
  }
  var modeSel = document.createElement("select"); modeSel.style.cssText = BTN;
  [["once", "Play once"], ["one", "Loop selected"], ["all", "Loop playlist"], ["shuffle", "Shuffle"]].forEach(function (o) {
    var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; modeSel.appendChild(op);
  });
  field("mode", modeSel);

  var gapInp = document.createElement("input"); gapInp.type = "number"; gapInp.min = "0"; gapInp.step = "0.5"; gapInp.value = "0";
  gapInp.style.cssText = BTN + ";width:70px"; field("gap (s)", gapInp);

  var volInp = document.createElement("input"); volInp.type = "range"; volInp.min = "0"; volInp.max = "1.5"; volInp.step = "0.01"; volInp.value = "1";
  volInp.style.cssText = "width:110px;accent-color:#fff"; field("volume", volInp);

  var voiceInp = document.createElement("input"); voiceInp.type = "range"; voiceInp.min = "1"; voiceInp.max = "7"; voiceInp.step = "1"; voiceInp.value = "1";
  voiceInp.style.cssText = "width:110px;accent-color:#fff"; field("voices (echo)", voiceInp);

  var filterSel = document.createElement("select"); filterSel.style.cssText = BTN;
  [["all", "All mics"], ["default", "Default mic only"]].forEach(function (o) {
    var op = document.createElement("option"); op.value = o[0]; op.textContent = o[1]; filterSel.appendChild(op);
  });
  field("replace", filterSel);

  var monLbl = el("label", LBL.replace("column", "row") + ";align-items:center;gap:6px");
  var monInp = document.createElement("input"); monInp.type = "checkbox";
  monLbl.appendChild(monInp); monLbl.appendChild(el("span", "color:#ccc", "hear locally"));
  panel.appendChild(monLbl);

  var destLine = el("div", "width:100%;color:#777;font:11px monospace;margin-top:4px", "on: " + location.hostname);
  panel.appendChild(destLine);

  bar.appendChild(panel);
  document.documentElement.appendChild(bar);

  gearBtn.onclick = function () { panel.style.display = panel.style.display === "none" ? "flex" : "none"; };
  pp.onclick = toggle;
  close.onclick = function () { bar.style.display = "none"; };
  modeSel.onchange = function () { cfg.mode = modeSel.value; if (running) startPlay(); };
  gapInp.onchange = function () { cfg.gap = Math.max(0, +gapInp.value || 0); };
  volInp.oninput = function () { cfg.volume = +volInp.value; gain.gain.value = cfg.volume; };
  voiceInp.oninput = function () { cfg.voices = +voiceInp.value; if (running) startPlay(); };
  filterSel.onchange = function () { cfg.inputFilter = filterSel.value; };
  monInp.onchange = function () { cfg.monitor = monInp.checked; applyMonitor(); };

  input.onchange = function () {
    ctx.resume();
    var list = Array.prototype.slice.call(input.files);
    status.textContent = "decoding...";
    Promise.all(list.map(function (f) {
      return f.arrayBuffer().then(decode).then(function (b) { return { name: f.name, buf: b }; });
    })).then(function (res) {
      files = files.concat(res);
      cur = files.length - res.length;
      running = true; paused = false; resume = null;
      playIndex(cur, 0);
    }).catch(function () { status.textContent = "cannot decode this file"; });
    input.value = "";
  };

  /* ---------- device override ---------- */
  function track() {
    var t = dest.stream.getAudioTracks()[0].clone();
    var gs = t.getSettings.bind(t);
    Object.defineProperty(t, "label", { value: "LOOP virtual microphone" });
    t.getSettings = function () {
      var o = gs(); o.deviceId = "loop-virtual"; o.echoCancellation = false; o.noiseSuppression = false; o.autoGainControl = false; return o;
    };
    return t;
  }
  function wantsSpecific(c) {
    var a = c && c.audio;
    if (!a || typeof a !== "object") return false;
    var d = a.deviceId, id = typeof d === "object" ? (d.exact || d.ideal) : d;
    return !!id && id !== "default" && id !== "communications" && id !== "loop-virtual";
  }
  md.getUserMedia = function (c) {
    c = c || {};
    if (!c.audio) return origGUM(c);
    if (cfg.inputFilter === "default" && wantsSpecific(c)) return origGUM(c);
    ctx.resume();
    if (files.length && !running && !paused) { running = true; playIndex(cur, 0); }
    var out = new MediaStream([track()]);
    if (!c.video) return Promise.resolve(out);
    return origGUM({ video: c.video }).then(function (v) {
      v.getVideoTracks().forEach(function (t) { out.addTrack(t); });
      return out;
    });
  };
  md.enumerateDevices = function () {
    return origEnum().catch(function () { return []; }).then(function (list) {
      if (cfg.inputFilter === "default") return list;
      var virt = { deviceId: "loop-virtual", groupId: "loop", kind: "audioinput", label: "LOOP virtual microphone",
        toJSON: function () { return { deviceId: "loop-virtual", groupId: "loop", kind: "audioinput", label: "LOOP virtual microphone" }; } };
      return [virt].concat(list.filter(function (d) { return d.kind !== "audioinput"; }));
    });
  };
  if (navigator.permissions && navigator.permissions.query) {
    var oq = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = function (d) {
      if (d && d.name === "microphone") {
        var et = new EventTarget();
        Object.defineProperties(et, { state: { value: "granted" }, name: { value: "microphone" } });
        et.onchange = null;
        return Promise.resolve(et);
      }
      return oq(d);
    };
  }
})();

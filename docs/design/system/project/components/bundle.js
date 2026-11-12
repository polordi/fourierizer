/* @ds-bundle: {"format":4,"namespace":"Fourierizer","components":[{"name":"Knob"},{"name":"Fader"},{"name":"Stepper"},{"name":"Segmented"},{"name":"SpectrogramDisplay"},{"name":"LayerSlot"},{"name":"FourierizeKey"}]} */
// Fourierizer design-system components (v0). Plain DOM, no framework: each component is a
// function (root, options) that renders into `root`. Styles live in bundle.css.
(function () {
  "use strict";
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var fmtDb = function (v) { return v < 0.005 ? "−∞" : (20 * Math.log10(2 * v * v)).toFixed(1).replace("-", "−"); };

  // ---- Knob --------------------------------------------------------------------------
  var ICON = {
    attack: '<svg viewBox="0 0 14 14"><path d="M1 12 L6 2 L13 2"/></svg>',
    release: '<svg viewBox="0 0 14 14"><path d="M1 2 L7 2 L13 12"/></svg>',
    feather: '<svg viewBox="0 0 14 14"><path d="M1 12 C5 12 5 2 13 2"/></svg>',
    gain: '<svg viewBox="0 0 14 14"><path d="M1 12 L13 12 L13 2 Z"/></svg>'
  };
  var DEFAULT_KNOBS = [
    { layer: 1, icon: "attack", silk: "ATK", v: 0.18, def: 0.1, fmt: function (v) { return Math.round(1 + v * v * 1999) + " ms"; } },
    { layer: 2, icon: "release", silk: "REL", v: 0.4, def: 0.3, fmt: function (v) { return Math.round(5 + v * v * 4995) + " ms"; } },
    { layer: 3, icon: "feather", silk: "FTHR", v: 0.25, def: 0.15, fmt: function (v) { return Math.round(v * 100) + " %"; } },
    { layer: 4, icon: "gain", silk: "GAIN", v: 0.66, def: 0.707, fmt: function (v) { return fmtDb(v) + " dB"; } }
  ];
  function ticksSvg() {
    var s = "";
    for (var i = 0; i < 11; i++) {
      var a = (-135 + i * 27 - 90) * Math.PI / 180;
      s += '<line data-i="' + i + '" x1="' + (36 + 31 * Math.cos(a)) + '" y1="' + (36 + 31 * Math.sin(a)) + '" x2="' + (36 + 35 * Math.cos(a)) + '" y2="' + (36 + 35 * Math.sin(a)) + '" stroke-width="1.5"/>';
    }
    return s;
  }
  function Knob(root, options) {
    var knobs = (options && options.knobs) || DEFAULT_KNOBS;
    root.style.display = "flex"; root.style.flexWrap = "wrap"; root.style.gap = "24px";
    knobs.forEach(function (k) {
      var el = document.createElement("div");
      el.className = "fz-knob fz-l" + k.layer;
      el.innerHTML = '<div class="fz-knob__dial fz-focus" tabindex="0" role="slider" aria-label="' + k.silk + '" aria-valuemin="0" aria-valuemax="1">' +
        '<svg viewBox="0 0 72 72" aria-hidden="true">' + ticksSvg() + '</svg><div class="fz-knob__cap"></div></div>' +
        '<div class="fz-knob__row">' + (ICON[k.icon] || "") + '<span class="fz-readout"></span></div><span class="fz-silk">' + k.silk + '</span>';
      root.appendChild(el);
      var dial = el.querySelector(".fz-knob__dial"), cap = el.querySelector(".fz-knob__cap"), out = el.querySelector(".fz-readout");
      function paint(spring) {
        cap.style.transition = spring ? "transform 420ms cubic-bezier(.3,1.7,.45,1)" : "none";
        cap.style.transform = "rotate(" + (-135 + 270 * k.v) + "deg)";
        out.textContent = k.fmt(k.v);
        dial.setAttribute("aria-valuenow", k.v.toFixed(2)); dial.setAttribute("aria-valuetext", k.fmt(k.v));
        var on = Math.round(k.v * 10);
        Array.prototype.forEach.call(dial.querySelectorAll("line"), function (l) { l.setAttribute("stroke", +l.getAttribute("data-i") <= on ? "#16181A" : "#B7BDC3"); });
      }
      var y0 = 0, v0 = 0;
      dial.addEventListener("pointerdown", function (e) { dial.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = k.v; });
      dial.addEventListener("pointermove", function (e) { if (!dial.hasPointerCapture(e.pointerId)) return; k.v = clamp(v0 + (y0 - e.clientY) / (e.shiftKey ? 600 : 150), 0, 1); paint(false); });
      dial.addEventListener("dblclick", function () { k.v = k.def; paint(true); });
      dial.addEventListener("keydown", function (e) {
        var d = { ArrowUp: .02, ArrowRight: .02, ArrowDown: -.02, ArrowLeft: -.02 }[e.key];
        if (d) { e.preventDefault(); k.v = clamp(k.v + d, 0, 1); paint(true); }
      });
      paint(false);
    });
  }

  // ---- Fader -------------------------------------------------------------------------
  function Fader(root, options) {
    var values = (options && options.values) || [0.707, 0.55, 0.8, 0.35];
    root.style.display = "flex"; root.style.gap = "16px"; root.style.alignItems = "flex-end";
    values.forEach(function (v0, i) {
      var v = v0, H = 150, C = 16;
      var el = document.createElement("div");
      el.className = "fz-fader fz-l" + (i + 1);
      el.innerHTML = '<span class="fz-readout"></span><div class="fz-fader__slot fz-focus" tabindex="0" role="slider" aria-label="Layer ' + (i + 1) + ' level" aria-valuemin="0" aria-valuemax="1">' +
        '<div class="fz-fader__track"><div class="fz-fader__fill"></div></div><div class="fz-fader__cap"></div></div><span class="fz-silk">L' + (i + 1) + '</span>';
      root.appendChild(el);
      var slot = el.querySelector(".fz-fader__slot"), fill = el.querySelector(".fz-fader__fill"), cap = el.querySelector(".fz-fader__cap"), out = el.querySelector(".fz-readout");
      function paint() {
        var y = (1 - v) * (H - C);
        cap.style.top = y + "px"; fill.style.height = Math.max(0, H - y - C / 2 - 3) + "px";
        out.textContent = fmtDb(v) + " dB";
        slot.setAttribute("aria-valuenow", v.toFixed(2)); slot.setAttribute("aria-valuetext", fmtDb(v) + " dB");
      }
      function move(e) { var r = slot.getBoundingClientRect(); v = clamp(1 - (e.clientY - r.top - C / 2) / (H - C), 0, 1); paint(); }
      slot.addEventListener("pointerdown", function (e) { slot.setPointerCapture(e.pointerId); move(e); });
      slot.addEventListener("pointermove", function (e) { if (slot.hasPointerCapture(e.pointerId)) move(e); });
      slot.addEventListener("keydown", function (e) { var d = { ArrowUp: .02, ArrowDown: -.02 }[e.key]; if (d) { e.preventDefault(); v = clamp(v + d, 0, 1); paint(); } });
      paint();
    });
  }

  // ---- Stepper -----------------------------------------------------------------------
  var FS = 48000, NOTES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  var DEFAULT_STEPPERS = [
    { silk: "FFT SIZE N", v: 12, min: 8, max: 14, show: function (v) { return Math.pow(2, v); }, derived: function (v) { return (Math.pow(2, v) / FS * 1000).toFixed(1) + " ms · Δf " + (FS / Math.pow(2, v)).toFixed(1) + " Hz"; } },
    { silk: "HOP H", v: 3, min: 1, max: 3, show: function (v) { return 4096 / Math.pow(2, v); }, derived: function (v) { return "overlap " + (100 - 100 / Math.pow(2, v)) + "% · " + (4096 / Math.pow(2, v) / FS * 1000).toFixed(1) + " ms"; } },
    { silk: "PITCH", v: 3, min: -24, max: 24, show: function (v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) + " st"; }, derived: function (v) { return "ratio ×" + Math.pow(2, v / 12).toFixed(3); } },
    { silk: "ROOT", v: 60, min: 0, max: 127, show: function (v) { return NOTES[v % 12] + (Math.floor(v / 12) - 1); }, derived: function (v) { return "MIDI " + v + " · " + (440 * Math.pow(2, (v - 69) / 12)).toFixed(1) + " Hz"; } }
  ];
  function Stepper(root, options) {
    var steppers = (options && options.steppers) || DEFAULT_STEPPERS;
    root.style.display = "flex"; root.style.flexWrap = "wrap"; root.style.gap = "24px";
    steppers.forEach(function (s) {
      var el = document.createElement("div");
      el.className = "fz-stepper";
      el.innerHTML = '<span class="fz-silk">' + s.silk + '</span><div class="fz-stepper__body">' +
        '<button class="fz-stepper__btn" type="button" aria-label="Decrease ' + s.silk + '">−</button>' +
        '<div class="fz-stepper__val fz-readout-lg" aria-live="polite"></div>' +
        '<button class="fz-stepper__btn" type="button" aria-label="Increase ' + s.silk + '">+</button></div><span class="fz-readout-sm"></span>';
      root.appendChild(el);
      var btns = el.querySelectorAll("button"), val = el.querySelector(".fz-stepper__val"), der = el.querySelector(".fz-readout-sm");
      function paint() { val.textContent = s.show(s.v); der.textContent = s.derived(s.v); btns[0].disabled = s.v <= s.min; btns[1].disabled = s.v >= s.max; }
      btns[0].addEventListener("click", function () { s.v = Math.max(s.min, s.v - 1); paint(); });
      btns[1].addEventListener("click", function () { s.v = Math.min(s.max, s.v + 1); paint(); });
      paint();
    });
  }

  // ---- Segmented (window icons plot the real w[n]) -----------------------------------
  function I0(x) { var s = 1, t = 1; for (var k = 1; k < 30; k++) { t *= Math.pow(x / (2 * k), 2); s += t; } return s; }
  var W = {
    rect: function () { return 1; },
    hann: function (n) { return 0.5 - 0.5 * Math.cos(2 * Math.PI * n); },
    hamming: function (n) { return 0.54 - 0.46 * Math.cos(2 * Math.PI * n); },
    bh: function (n) { return 0.35875 - 0.48829 * Math.cos(2 * Math.PI * n) + 0.14128 * Math.cos(4 * Math.PI * n) - 0.01168 * Math.cos(6 * Math.PI * n); },
    kaiser: function (n) { return I0(8 * Math.sqrt(Math.max(0, 1 - Math.pow(2 * n - 1, 2)))) / I0(8); },
    gauss: function (n) { return Math.exp(-0.5 * Math.pow((n - 0.5) / 0.2, 2)); },
    flat: function (n) { return 0.21557895 - 0.41663158 * Math.cos(2 * Math.PI * n) + 0.277263158 * Math.cos(4 * Math.PI * n) - 0.083578947 * Math.cos(6 * Math.PI * n) + 0.006947368 * Math.cos(8 * Math.PI * n); }
  };
  function windowPath(f) {
    var lo = 0, i, d = "";
    for (i = 0; i <= 40; i++) lo = Math.min(lo, f(i / 40));
    for (i = 0; i <= 40; i++) d += (i ? "L" : "M") + i + " " + (15 - ((f(i / 40) - lo) / (1 - lo)) * 13).toFixed(2) + " ";
    return d;
  }
  function segGroup(label, opts, sel, icons) {
    var wrap = document.createElement("div");
    wrap.style.display = "grid"; wrap.style.gap = "6px";
    var id = "seg_" + label.replace(/\W/g, "");
    wrap.innerHTML = '<span class="fz-silk" id="' + id + '">' + label + '</span><div class="fz-seg" role="radiogroup" aria-labelledby="' + id + '">' +
      opts.map(function (o) {
        return '<button class="fz-seg__opt" type="button" role="radio" data-id="' + o[0] + '" aria-checked="' + (o[0] === sel) + '">' +
          (icons ? '<svg viewBox="0 0 40 16" aria-hidden="true"><path d="' + windowPath(W[o[0]]) + '"/></svg>' : "") + "<span>" + o[1] + "</span></button>";
      }).join("") + "</div>";
    wrap.addEventListener("click", function (e) {
      var b = e.target.closest(".fz-seg__opt"); if (!b) return;
      Array.prototype.forEach.call(wrap.querySelectorAll(".fz-seg__opt"), function (x) { x.setAttribute("aria-checked", String(x === b)); });
    });
    return wrap;
  }
  function Segmented(root) {
    root.style.display = "grid"; root.style.gap = "20px"; root.style.justifyItems = "start";
    root.appendChild(segGroup("WINDOW", [["rect", "Rect"], ["hann", "Hann"], ["hamming", "Hamm"], ["bh", "B-H"], ["kaiser", "Kaiser"], ["gauss", "Gauss"], ["flat", "Flat"]], "hann", true));
    root.appendChild(segGroup("KEYTRACK", [["tape", "Tape"], ["spectral", "Spectral"]], "tape", false));
  }

  // ---- SpectrogramDisplay ------------------------------------------------------------
  function SpectrogramDisplay(root, options) {
    var layer = (options && options.layer) || 1;
    var DUR = 3.84, FMIN = 30, FMAX = 20000, SW = 260, SH = 100;
    root.innerHTML = '<div class="fz-l' + layer + '" style="display:grid;gap:6px;max-width:640px">' +
      '<div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><span class="fz-silk">L' + layer + ' · Hann · N 4096 · H 512</span><span class="fz-readout-sm" data-cursor>—</span></div>' +
      '<div style="display:grid;grid-template-columns:34px 1fr;gap:4px"><div data-yaxis style="position:relative"></div>' +
      '<div class="fz-display" style="position:relative;aspect-ratio:2.6/1"><canvas style="position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated"></canvas>' +
      '<svg data-sel style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Spectrogram selection area"></svg></div>' +
      '<span></span><div data-xaxis style="position:relative;height:14px"></div></div></div>';
    var host = root.firstChild, canvas = root.querySelector("canvas"), svg = root.querySelector("[data-sel]");
    var probe = document.createElement("canvas").getContext("2d");
    function rgb(s, fallback) { probe.fillStyle = fallback; probe.fillStyle = (s || "").trim() || fallback; var h = probe.fillStyle; return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
    var cs = getComputedStyle(host);
    var ground = rgb(cs.getPropertyValue("--display"), "#ffffff"), mid = rgb(cs.getPropertyValue("--layer"), "#f28c28"), deep = rgb(cs.getPropertyValue("--layer-deep"), "#b85a00");
    function mix(a, b, t) { return a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }); }
    function cmap(v) { return v < 0.6 ? mix(ground, mid, v / 0.6) : mix(mid, deep, (v - 0.6) / 0.4); }
    function yToF(y) { return FMIN * Math.pow(FMAX / FMIN, 1 - y); }
    function fToY(f) { return 1 - Math.log(f / FMIN) / Math.log(FMAX / FMIN); }

    canvas.width = SW; canvas.height = SH;
    var ctx = canvas.getContext("2d"), img = ctx.createImageData(SW, SH), m = new Float32Array(SW * SH), mx = 0, seed = 3;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var x = 0; x < SW; x++) {
      var t = x / SW * DUR;
      for (var y = 0; y < SH; y++) {
        var f = yToF(y / SH), v = 0;
        for (var k = 1; k <= 30; k++) { var fk = 196 * k * Math.sqrt(1 + 0.0004 * k * k), d = Math.log2(f / fk) * 30; v += Math.exp(-d * d) * Math.exp(-t * (0.6 + 0.25 * k)) / Math.pow(k, 0.8); }
        v += (t < 0.05 ? (0.05 - t) * 14 * rnd() : 0) + 0.015 * rnd();
        m[y * SW + x] = v; if (v > mx) mx = v;
      }
    }
    for (var i = 0; i < m.length; i++) { var c = cmap(Math.min(1, Math.pow(m[i] / mx, 0.42))); img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);

    root.querySelector("[data-yaxis]").innerHTML = [50, 100, 200, 500, 1000, 2000, 5000, 10000].map(function (f) {
      return '<span class="fz-readout-sm" style="position:absolute;right:0;top:calc(' + (fToY(f) * 100).toFixed(2) + '% - 6px)">' + (f >= 1000 ? f / 1000 + "k" : f) + "</span>";
    }).join("");
    root.querySelector("[data-xaxis]").innerHTML = [0, 1, 2, 3].map(function (s) {
      return '<span class="fz-readout-sm" style="position:absolute;left:' + (s / DUR * 100).toFixed(2) + '%">' + s + " s</span>";
    }).join("");

    var toX = function (t) { return t / DUR * 1000; }, toY = function (f) { return fToY(f) * 1000; };
    var shapes = [{ kind: "rect", t: [0.0, 2.2], f: [150, 1100] }, { kind: "lasso", pts: [[2.4, 900], [3.1, 2600], [3.6, 1800], [3.4, 700], [2.8, 500]] }];
    var style = "fill:var(--layer);fill-opacity:.16;stroke:var(--ink,#16181A);stroke-width:2;stroke-dasharray:6 4;vector-effect:non-scaling-stroke";
    function handle(x, y) { return '<rect x="' + (x - 6) + '" y="' + (y - 14) + '" width="12" height="28" style="fill:var(--layer-deep);stroke:var(--ink,#16181A);stroke-width:1.5;vector-effect:non-scaling-stroke"/>'; }
    function draw(extra) {
      svg.innerHTML = shapes.concat(extra ? [extra] : []).map(function (s) {
        return s.kind === "rect"
          ? '<rect x="' + toX(s.t[0]) + '" y="' + toY(s.f[1]) + '" width="' + (toX(s.t[1]) - toX(s.t[0])) + '" height="' + (toY(s.f[0]) - toY(s.f[1])) + '" style="' + style + '"/>' + handle(toX(s.t[0]), toY(s.f[1])) + handle(toX(s.t[1]), toY(s.f[0]))
          : '<polygon points="' + s.pts.map(function (p) { return toX(p[0]) + "," + toY(p[1]); }).join(" ") + '" style="' + style + '"/>';
      }).join("") + '<line x1="' + toX(1.3) + '" x2="' + toX(1.3) + '" y1="0" y2="1000" style="stroke:var(--ink,#16181A);stroke-width:1.5;vector-effect:non-scaling-stroke"/>';
    }
    draw();
    function at(e) { var r = svg.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1) * DUR, yToF(clamp((e.clientY - r.top) / r.height, 0, 1))]; }
    function fmtF(f) { return f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : f.toFixed(0) + " Hz"; }
    function box(a, b) { return { kind: "rect", t: [Math.min(a[0], b[0]), Math.max(a[0], b[0])], f: [Math.min(a[1], b[1]), Math.max(a[1], b[1])] }; }
    var start = null, cursor = root.querySelector("[data-cursor]");
    svg.addEventListener("pointerdown", function (e) { svg.setPointerCapture(e.pointerId); start = at(e); });
    svg.addEventListener("pointermove", function (e) { var p = at(e); cursor.textContent = p[0].toFixed(3) + " s · " + fmtF(p[1]); if (start && svg.hasPointerCapture(e.pointerId)) draw(box(start, p)); });
    svg.addEventListener("pointerup", function (e) { if (!start) return; var p = at(e); if (Math.abs(p[0] - start[0]) > 0.02) shapes.push(box(start, p)); if (shapes.length > 5) shapes.splice(2, 1); start = null; draw(); });
  }

  // ---- LayerSlot ---------------------------------------------------------------------
  var SLOT_ICON = {
    load: '<svg viewBox="0 0 16 16"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2 13h12"/></svg>',
    rec: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>',
    mute: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10L5 10H2z"/><path d="M11 6l3 4M14 6l-3 4"/></svg>',
    solo: '<svg viewBox="0 0 16 16"><path d="M2 6h3l4-3v10L5 10H2z"/><path d="M11.5 5.5a4 4 0 0 1 0 5"/></svg>'
  };
  function LayerSlot(root, options) {
    var slots = (options && options.slots) || [
      { layer: 1, name: "Lead Piano.wav", meta: "48.0 kHz · 3.84 s · ST", loaded: true },
      { layer: 2, name: "", meta: "", loaded: false }
    ];
    root.style.display = "grid"; root.style.gridTemplateColumns = "repeat(auto-fit,minmax(280px,1fr))"; root.style.gap = "24px";
    slots.forEach(function (s) {
      var el = document.createElement("div");
      el.className = "fz-module fz-l" + s.layer;
      el.style.display = "grid"; el.style.gap = "12px"; el.style.paddingTop = "22px";
      el.innerHTML = '<span class="fz-screw tl"></span><span class="fz-screw tr"></span><span class="fz-screw bl"></span><span class="fz-screw br"></span>' +
        '<div style="display:flex;align-items:center;gap:10px;min-width:0">' +
        '<span style="width:28px;height:28px;flex:none;display:grid;place-items:center;background:var(--layer);color:var(--on-layer);border:1.5px solid var(--ink,#16181A);border-radius:var(--radius-sm,3px);font:600 14px var(--font-mono,monospace)">' + s.layer + '</span>' +
        '<div style="min-width:0;display:grid"><span style="font:600 16px/20px var(--font-sans,sans-serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (s.name || "Empty slot") + '</span>' +
        '<span class="fz-readout-sm">' + (s.meta || "Drop a sound or capture from the mixer") + '</span></div>' +
        '<span class="fz-led" data-on="' + s.loaded + '" style="margin-left:auto;flex:none" title="' + (s.loaded ? "Loaded" : "Empty") + '"></span></div>' +
        '<div class="fz-display" style="height:56px">' + (s.loaded ? '<canvas style="width:100%;height:100%;display:block"></canvas>' : '<div style="height:100%;display:grid;place-items:center" class="fz-silk">Drop audio here</div>') + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="fz-key" type="button" aria-label="Load file">' + SLOT_ICON.load + '</button>' +
        '<button class="fz-key" type="button" aria-label="Capture">' + SLOT_ICON.rec + '<span>Rec</span></button><span style="flex:1"></span>' +
        '<button class="fz-key" type="button" aria-pressed="false" aria-label="Mute layer">' + SLOT_ICON.mute + '</button>' +
        '<button class="fz-key" type="button" aria-pressed="false" aria-label="Solo layer">' + SLOT_ICON.solo + '</button></div>';
      root.appendChild(el);
      Array.prototype.forEach.call(el.querySelectorAll(".fz-key[aria-pressed]"), function (k) {
        k.addEventListener("click", function () { k.setAttribute("aria-pressed", String(k.getAttribute("aria-pressed") !== "true")); });
      });
      var c = el.querySelector("canvas");
      if (c) requestAnimationFrame(function () {
        var r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        c.width = Math.max(1, r.width * dpr); c.height = Math.max(1, r.height * dpr);
        var g = c.getContext("2d"); g.scale(dpr, dpr);
        g.strokeStyle = getComputedStyle(el).getPropertyValue("--layer-deep").trim() || "#B85A00"; g.lineWidth = 1;
        g.beginPath();
        for (var x = 0; x < r.width; x++) {
          var t = x / r.width, env = Math.exp(-t * 3.2) * (t < .01 ? t / .01 : 1), a = env * (0.75 + 0.25 * Math.sin(x * 1.7)) * (r.height / 2 - 4);
          g.moveTo(x + .5, r.height / 2 - a); g.lineTo(x + .5, r.height / 2 + a);
        }
        g.stroke();
      });
    });
  }

  // ---- FourierizeKey -----------------------------------------------------------------
  function FourierizeKey(root) {
    root.style.display = "flex"; root.style.alignItems = "center"; root.style.gap = "20px"; root.style.flexWrap = "wrap";
    root.innerHTML = '<button class="fz-key fz-focus" type="button" style="min-height:64px;padding:0 28px;font-size:15px;letter-spacing:.12em;gap:12px">' +
      '<svg viewBox="0 0 16 16" style="width:20px;height:20px" aria-hidden="true"><path d="M1 8c1.5-5 3-5 4.5 0s3 5 4.5 0 3-5 4.5 0"/></svg>Fourierize</button>' +
      '<div style="display:grid;gap:6px"><div style="display:flex;gap:8px"><span class="fz-led fz-l1"></span><span class="fz-led fz-l2"></span><span class="fz-led fz-l3"></span><span class="fz-led fz-l4"></span></div>' +
      '<span class="fz-readout-sm" aria-live="polite">Ready · 4 layers</span></div>';
    var go = root.querySelector("button"), leds = root.querySelectorAll(".fz-led"), msg = root.querySelector("[aria-live]"), busy = false;
    go.addEventListener("click", function () {
      if (busy) return; busy = true; go.setAttribute("aria-pressed", "true");
      Array.prototype.forEach.call(leds, function (l) { l.setAttribute("data-on", "false"); });
      msg.textContent = "Rendering…";
      var t0 = performance.now(), i = 0;
      (function next() {
        if (i < leds.length) { leds[i++].setAttribute("data-on", "true"); setTimeout(next, 140); return; }
        msg.textContent = "Done · " + ((performance.now() - t0) / 1000).toFixed(2) + " s · −0.3 dBFS peak";
        go.setAttribute("aria-pressed", "false"); busy = false;
      })();
    });
  }

  window.Fourierizer = {
    Knob: Knob, Fader: Fader, Stepper: Stepper, Segmented: Segmented,
    SpectrogramDisplay: SpectrogramDisplay, LayerSlot: LayerSlot, FourierizeKey: FourierizeKey
  };
})();

// Fourierizer UI entry point. Builds the window, owns the project state and talks to the engine
// through `Host` (browser worker now, JUCE bridge in the plugin).

import { BrowserHost, type Host } from "./host.ts";
import { Sampler } from "./audio/sampler.ts";
import { LayerView, paintSpectrogram, type LayerHost, type Mode } from "./view/layer.ts";
import { h, icon, ICONS, screws } from "./view/dom.ts";
import { Fader, Knob, Segmented, Stepper, key } from "./view/controls.ts";
import { EXAMPLE_NAMES } from "./dsp/examples.ts";
import { OPS, type Op } from "./dsp/ops.ts";
import type { Shape } from "./dsp/mask.ts";
import type { LayerJob } from "./protocol.ts";
import {
  SR, MAX_SECONDS, activeLayers, adsrMap, cloneShapes, exampleState, featherOf, gridOf, noteName,
  type LayerState, type State, type Tool,
} from "./model.ts";

const KEYMAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

class App implements LayerHost {
  st: State = exampleState();
  host: Host = new BrowserHost();
  sampler = new Sampler();
  views: LayerView[] = [];
  private layersEl!: HTMLElement;
  private pickedShape: { layer: number; shape: number } | null = null;
  private undoStack: Shape[][][] = [];
  private redoStack: Shape[][][] = [];
  private specReq = [0, 0, 0, 0];
  private specTimer: number[] = [0, 0, 0, 0];
  private renderTimer = 0;
  private rendering = false;
  private queued = false;
  private result: { channels: Float32Array[]; duration: number } | null = null;
  private keyBase = 48;
  private held = new Map<string, number>();
  private midiInputs = 0;
  private refreshers: { refresh(): void }[] = [];

  // footer elements
  private statusEl!: HTMLElement;
  private leds: HTMLElement[] = [];
  private resultCanvas!: HTMLCanvasElement;
  private resultMeta!: HTMLElement;
  private resultAxis!: HTMLElement;
  private playheadEl!: HTMLElement;
  private pairRow!: HTMLElement;
  private opHint!: HTMLElement;
  private slotPick!: HTMLElement;
  private autoKey!: HTMLButtonElement;
  private keysEl!: HTMLElement;
  private midiKey!: HTMLButtonElement;
  private resultEmpty!: HTMLElement;

  // ------------------------------------------------------------------ LayerHost
  state(i: number): LayerState { return this.st.layers[i]; }
  tool(): Tool { return this.st.tool; }
  isFocused(i: number): boolean { return this.st.focus === i + 1; }
  picked() { return this.pickedShape; }
  setPicked(p: { layer: number; shape: number } | null): void {
    const prev = this.pickedShape;
    this.pickedShape = p;
    if (prev) this.views[prev.layer].drawShapes();
    if (p && (!prev || prev.layer !== p.layer)) this.views[p.layer].drawShapes();
  }
  ensureAudio(): void { this.sampler.ensure(); }

  focus(n: number): void {
    if (n === this.st.focus) return;
    this.st.focus = n;
    this.layout(true);
    this.refreshers.forEach((r) => r.refresh());
  }

  editShapes(i: number, fn: (shapes: Shape[]) => void, opts: { undo?: boolean; render?: boolean } = {}): void {
    if (opts.undo ?? true) this.snapshot();
    fn(this.st.layers[i].shapes);
    this.views[i].refresh();
    if (opts.render ?? true) this.scheduleRender();
  }

  paramsChanged(i: number, what: { spectrogram?: boolean; render?: boolean }): void {
    if (what.spectrogram) {
      clearTimeout(this.specTimer[i]);
      this.specTimer[i] = window.setTimeout(() => this.requestSpectrogram(i), 120);
      this.views[i].refresh();
    }
    if (what.render) this.scheduleRender();
  }

  pickFile(i: number): void { void i; }
  capture(_i: number): void {
    this.toast("Capturing from the mixer works inside FL Studio with the Fourierizer Capture plugin.");
  }
  toggleMute(i: number): void { const l = this.st.layers[i]; l.mute = !l.mute; this.views[i].refresh(); this.scheduleRender(); }
  toggleSolo(i: number): void { const l = this.st.layers[i]; l.solo = !l.solo; this.views[i].refresh(); this.scheduleRender(); }

  async load(i: number, file: File): Promise<void> {
    try {
      this.toast(`Loading ${file.name}…`);
      const data = await file.arrayBuffer();
      const audio = await new OfflineAudioContext(2, 1, SR).decodeAudioData(data);
      const n = Math.min(audio.length, MAX_SECONDS * SR), chs = Math.min(2, audio.numberOfChannels);
      const channels = Array.from({ length: chs }, (_, c) => audio.getChannelData(c).slice(0, n));
      this.setLayerAudio(i, file.name.replace(/\.[^.]+$/, ""), channels, false);
      this.toast(audio.duration > MAX_SECONDS ? `Loaded the first ${MAX_SECONDS} s of ${file.name}` : `Loaded ${file.name} into layer ${i + 1}`);
    } catch {
      this.toast(`Could not read ${file.name}. Try WAV, AIFF, FLAC, MP3 or OGG.`);
    }
  }

  private setLayerAudio(i: number, name: string, channels: Float32Array[], keepShapes: boolean): void {
    const l = this.st.layers[i];
    l.name = name; l.loaded = true; l.samples = channels[0].length; l.channels = channels.length;
    if (!keepShapes) { l.shapes = []; l.pitch = 0; l.offset = 0; }
    if (this.pickedShape?.layer === i) this.pickedShape = null;
    this.host.setSource(i, channels);
    this.views[i].clearSpectrogram();
    this.views[i].refresh();
    void this.requestSpectrogram(i);
    this.scheduleRender();
  }

  private async requestSpectrogram(i: number): Promise<void> {
    const l = this.st.layers[i];
    if (!l.loaded) return;
    const req = ++this.specReq[i];
    try {
      const img = await this.host.spectrogram(i, l.pitch, gridOf(l), SR);
      if (req === this.specReq[i]) this.views[i].setSpectrogram(img);
    } catch (e) { this.toast((e as Error).message); }
  }

  // ------------------------------------------------------------------ undo
  private snapshot(): void {
    this.undoStack.push(this.st.layers.map((l) => cloneShapes(l.shapes)));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(redo = false): void {
    const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack;
    const snap = from.pop();
    if (!snap) return;
    to.push(this.st.layers.map((l) => cloneShapes(l.shapes)));
    snap.forEach((shapes, i) => { this.st.layers[i].shapes = shapes; });
    this.pickedShape = null;
    this.views.forEach((v) => v.refresh());
    this.scheduleRender();
  }

  // ------------------------------------------------------------------ render
  scheduleRender(force = false): void {
    if (!this.st.auto && !force) { this.status("Changed · press Fourierize"); return; }
    clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => void this.renderNow(), force ? 0 : 220);
  }

  private job(l: LayerState): LayerJob {
    const f = featherOf(l.feather);
    return { id: l.index, pitch: l.pitch, grid: gridOf(l), shapes: l.shapes, featherS: f.s, featherOct: f.oct, gainDb: l.levelDb, offsetS: l.offset };
  }

  async renderNow(): Promise<void> {
    if (this.rendering) { this.queued = true; return; }
    const active = activeLayers(this.st).filter((l) => l.levelDb > -Infinity);
    const op = this.st.op, pair = OPS.find((o) => o.id === op)!.pair;
    if (!active.length) { this.setResult(null); this.status("Load a sound to begin"); return; }
    if (pair && (!active.includes(this.st.layers[this.st.opA]) || !active.includes(this.st.layers[this.st.opB]))) {
      this.status(`${OPS.find((o) => o.id === op)!.label} needs layers A and B loaded and unmuted`); return;
    }
    this.rendering = true;
    this.status("Rendering…");
    const lit = active.map((l) => l.index);
    this.leds.forEach((e) => (e.dataset.on = "false"));
    let k = 0;
    const blink = window.setInterval(() => { this.leds.forEach((e, i) => (e.dataset.on = String(lit.includes(i) && i === k % 4))); k++; }, 110);
    try {
      const all = this.st.layers.map((l) => (active.includes(l) ? this.job(l) : null));
      const r = await this.host.render({ sr: SR, op, a: this.st.opA, b: this.st.opB, layers: active.map((l) => this.job(l)), all });
      const dur = r.channels[0]?.length / SR || 0;
      this.setResult(r.channels[0]?.length ? { channels: r.channels, duration: dur } : null, r.image);
      const used = pair ? [this.st.opA, this.st.opB] : lit;
      this.leds.forEach((e, i) => (e.dataset.on = String(used.includes(i))));
      this.status(r.peak > 0 ? `Done · ${(r.ms / 1000).toFixed(2)} s · peak −0.3 dBFS` : "Silent · nothing is selected");
    } catch (e) {
      this.status("Render failed");
      this.toast((e as Error).message);
    } finally {
      clearInterval(blink);
      this.rendering = false;
      if (this.queued) { this.queued = false; void this.renderNow(); }
    }
  }

  private setResult(r: { channels: Float32Array[]; duration: number } | null, image?: { data: Uint8Array; cols: number; rows: number } | null): void {
    this.result = r;
    this.sampler.setResult(r ? r.channels : [], SR);
    if (r && image) paintSpectrogram(this.resultCanvas, image, 0);
    else this.resultCanvas.getContext("2d")?.clearRect(0, 0, this.resultCanvas.width, this.resultCanvas.height);
    this.resultEmpty.style.display = r ? "none" : "";
    const opLabel = OPS.find((o) => o.id === this.st.op)!;
    this.resultMeta.textContent = r ? `${opLabel.id === "sum" ? "Σ" : opLabel.label} · ${r.duration.toFixed(2)} s · stereo` : "";
    const dur = r?.duration ?? 4, step = dur > 30 ? 10 : dur > 12 ? 5 : dur > 5 ? 2 : 1;
    const spans: HTMLElement[] = [];
    for (let t = 0; t < dur - step * 0.3; t += step) spans.push(h("span", { class: "ro-sm", style: `left:${(t / dur * 100).toFixed(2)}%` }, `${t} s`));
    this.resultAxis.replaceChildren(...spans);
  }

  private status(t: string): void { this.statusEl.textContent = t; }

  private toastTimer = 0;
  toast(t: string): void {
    const el = document.getElementById("toast")!;
    el.textContent = t; el.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove("show"), 3200);
  }

  // ------------------------------------------------------------------ layout
  layout(animate: boolean): void {
    const W = this.layersEl.clientWidth, H = this.layersEl.clientHeight, G = 24, f = this.st.focus;
    if (!animate) {
      this.layersEl.classList.add("instant");
      requestAnimationFrame(() => requestAnimationFrame(() => this.layersEl.classList.remove("instant")));
    }
    const cw = (W - G) / 2, ch = (H - G) / 2, railW = Math.round(Math.min(340, Math.max(260, W * 0.22))), rh = (H - 2 * 12) / 3;
    const others = [0, 1, 2, 3].filter((j) => j !== f - 1);
    this.views.forEach((v, i) => {
      let box, mode: Mode, delay: number, z = 1;
      if (!f) { box = { x: (i % 2) * (cw + G), y: Math.floor(i / 2) * (ch + G), w: cw, h: ch }; mode = "grid"; delay = i * 35; }
      else if (i === f - 1) { box = { x: railW + G, y: 0, w: W - railW - G, h: H }; mode = "editor"; delay = 0; z = 3; }
      else { const k = others.indexOf(i); box = { x: 0, y: k * (rh + 12), w: railW, h: rh }; mode = "rail"; delay = 60 + k * 45; }
      v.place(box, mode, animate ? delay : 0, z);
    });
  }

  // ------------------------------------------------------------------ build
  build(root: HTMLElement): void {
    const st = this.st;

    // header
    const viewSeg = new Segmented(null, [
      { id: "0", label: "Grid", icon: icon(ICONS.grid), cls: "row", aria: "Show all four layers", title: "All four layers (0)" },
      ...[1, 2, 3, 4].map((n) => {
        const sw = h("span", { class: "swatch", "aria-hidden": "true" });
        return { id: String(n), label: String(n), icon: sw as unknown as SVGElement, cls: `row fz-l${n}`, aria: `Focus layer ${n}`, title: `Focus layer ${n} (${n})` };
      }),
    ], () => String(st.focus), (id) => this.focus(+id), "");
    const toolSeg = new Segmented(null, ([
      ["rect", "Rect", ICONS.rect, "Drag a rectangle to select (Alt subtracts)"],
      ["lasso", "Lasso", ICONS.lasso, "Draw a free shape to select (Alt subtracts)"],
      ["erase", "Erase", ICONS.erase, "Drag a rectangle to remove from the selection"],
      ["move", "Move", ICONS.move, "Pick a selection to move it; in the focus view drag its handles; Delete removes it"],
    ] as const).map(([id, label, ic, title]) => ({ id, label, icon: icon(ic), cls: "row", title })),
    () => st.tool, (id) => { st.tool = id as Tool; this.views.forEach((v) => { v.el.className = v.el.className.replace(/\btool-\w+/g, ""); v.el.classList.add(`tool-${id}`); v.drawShapes(); }); });
    this.refreshers.push(viewSeg, toolSeg);
    const header = h("header", { class: "top" },
      h("div", { class: "brand" }, h("span", { class: "wordmark" }, "Fourierizer"), h("span", { class: "silk" }, "Time–frequency selection synth")),
      h("span", { class: "grow" }),
      h("div", { class: "group" }, h("span", { class: "silk" }, "View"), viewSeg.el),
      h("div", { class: "group" }, h("span", { class: "silk" }, "Tool"), toolSeg.el),
      h("div", { class: "group" },
        key(null, ICONS.undo, { class: "sm", "aria-label": "Undo", title: "Undo (Ctrl+Z)" }, () => this.undo()),
        key(null, ICONS.redo, { class: "sm", "aria-label": "Redo", title: "Redo (Ctrl+Shift+Z)" }, () => this.undo(true))));

    // layers
    this.layersEl = h("main", { id: "layers", "aria-label": "Layers" });
    this.views = [0, 1, 2, 3].map((i) => new LayerView(i, this));
    this.views.forEach((v) => { v.el.classList.add(`tool-${st.tool}`); this.layersEl.append(v.el); });

    // result module
    this.statusEl = h("span", { class: "ro-sm", "aria-live": "polite" }, "Starting…");
    this.leds = [1, 2, 3, 4].map((n) => h("span", { class: `led fz-l${n}`, "data-on": "false" }));
    const go = key("Fourierize", ICONS.wave, { class: "go", title: "Render the result now" }, () => { this.ensureAudio(); void this.renderNow(); });
    this.autoKey = key("Auto", null, { class: "sm", "aria-pressed": String(st.auto), title: "Re-render automatically after every change" }, () => {
      st.auto = !st.auto; this.autoKey.setAttribute("aria-pressed", String(st.auto)); if (st.auto) this.scheduleRender(true);
    });
    this.slotPick = h("div", { class: "slotpick", hidden: true });
    this.slotPick.append(...[1, 2, 3, 4].map((n) => {
      const b = key(String(n), null, { class: `sm fz-l${n}`, "aria-label": `Send the result to layer ${n}`, title: `Replace layer ${n} with the result` }, () => this.toSlot(n - 1));
      b.prepend(h("span", { class: "swatch", "aria-hidden": "true" }));
      return b;
    }));
    const slotKey = key("→ Slot", null, { class: "sm", title: "Use the result as a source (iteration)" }, () => {
      if (!this.result) { this.toast("Render something first"); return; }
      this.slotPick.hidden = !this.slotPick.hidden;
    });
    const goCol = h("div", { class: "go-col" }, go, h("div", { class: "leds" }, ...this.leds), this.statusEl,
      h("div", { style: "display:flex;gap:8px" }, this.autoKey, slotKey), this.slotPick);

    const opSeg = new Segmented(null, OPS.map((o) => ({ id: o.id, label: o.label, title: o.hint })), () => st.op, (id) => {
      st.op = id as Op; this.syncOp(); this.scheduleRender(true);
    });
    const pairSeg = (which: "opA" | "opB") => new Segmented(null, [0, 1, 2, 3].map((i) => ({ id: String(i), label: String(i + 1), cls: `fz-l${i + 1}`, aria: `Layer ${i + 1}` })),
      () => String(st[which]), (id) => { st[which] = +id; this.scheduleRender(true); }, "pairpick");
    const segA = pairSeg("opA"), segB = pairSeg("opB");
    this.opHint = h("span", { class: "ro-sm", style: "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0" });
    this.pairRow = h("div", { class: "pairpick" }, h("span", { class: "silk sm" }, "A"), segA.el, h("span", { class: "silk sm" }, "B"), segB.el);
    this.resultMeta = h("span", { class: "ro-sm", style: "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto" });
    this.resultCanvas = h("canvas", { class: "spec" });
    this.playheadEl = h("span", { class: "playhead" });
    this.resultEmpty = h("div", { class: "empty-hint silk" }, "Nothing selected yet");
    const resultDisplay = h("div", { class: "display", title: "Click to play the result at the root note", role: "button", tabindex: 0, "aria-label": "Result spectrogram. Press to play" },
      this.resultCanvas, this.playheadEl, this.resultEmpty);
    const audition = () => {
      this.ensureAudio();
      if (!this.result) return;
      this.sampler.noteOn(st.root, 0.9);
      const root = st.root;
      window.setTimeout(() => this.sampler.noteOff(root), Math.max(50, this.result.duration * 1000 - this.sampler.env.r * 500));
    };
    resultDisplay.addEventListener("click", audition);
    resultDisplay.addEventListener("keydown", (e) => { if (e.key === "Enter") audition(); });
    this.resultAxis = h("div", { class: "rx", "aria-hidden": "true" });
    const resultMain = h("div", { class: "main" },
      h("div", { class: "rhead" }, h("span", { style: "font:600 16px/20px var(--font-sans)" }, "Result"), this.pairRow, h("span", { class: "grow" }), this.resultMeta),
      h("div", { class: "rhead" }, opSeg.el, this.opHint),
      resultDisplay, this.resultAxis);
    const resultMod = h("section", { class: "module result", "aria-label": "Result" }, ...screws(), goCol, resultMain);
    this.refreshers.push(opSeg, segA, segB);

    // sampler module
    const keytrack = new Segmented("Keytrack", [
      { id: "tape", label: "Tape", title: "Pitch by playback speed: higher notes are shorter" },
      { id: "spectral", label: "Spectral", disabled: true, title: "Pitch without changing length — arrives in milestone H6" },
    ], () => st.keytrack, (id) => { st.keytrack = id as "tape"; });
    const rootStep = new Stepper({
      label: "Root", display: () => noteName(st.root), derived: () => `MIDI ${st.root} · ${(440 * 2 ** ((st.root - 69) / 12)).toFixed(1)} Hz`,
      canStep: (d) => d > 0 ? st.root < 127 : st.root > 0,
      step: (d, fine) => { st.root = Math.max(0, Math.min(127, st.root + d * (fine ? 12 : 1))); this.sampler.root = st.root; },
      dragPx: 10,
    });
    this.keysEl = h("span", { class: "ro-sm keys" });
    this.midiKey = key("MIDI", ICONS.midi, { class: "sm", title: "Play from a MIDI keyboard (if the browser allows it)" }, () => void this.enableMidi());
    const fmtMs = (s: number) => s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`;
    const env = () => { const a = st.adsr; this.sampler.env = { a: adsrMap.a(a.a), d: adsrMap.d(a.d), s: adsrMap.s(a.s), r: adsrMap.r(a.r) }; };
    env();
    const knob = (k: "a" | "d" | "s" | "r", label: string, fmt: (v: number) => string, reset: number) =>
      new Knob({ label, aria: { a: "Attack", d: "Decay", s: "Sustain", r: "Release" }[k], get: () => st.adsr[k], set: (v) => { st.adsr[k] = v; env(); }, format: fmt, reset });
    const kA = knob("a", "Atk", (v) => fmtMs(adsrMap.a(v)), 0.18), kD = knob("d", "Dec", (v) => fmtMs(adsrMap.d(v)), 0.33);
    const kS = knob("s", "Sus", (v) => v < 0.005 ? "−∞ dB" : `${(20 * Math.log10(v)).toFixed(1).replace("-", "−")} dB`, 0.7);
    const kR = knob("r", "Rel", (v) => fmtMs(adsrMap.r(v)), 0.4);
    const samplerMod = h("section", { class: "module sampler fz-l0", "aria-label": "Sampler" }, ...screws(),
      h("div", { class: "row" }, keytrack.el, rootStep.el, h("span", { class: "grow" }),
        h("div", { style: "display:grid;gap:6px;justify-items:end" }, this.midiKey, this.keysEl)),
      h("div", { class: "knobs" }, kA.el, kD.el, kS.el, kR.el));

    // mix
    const faders = [0, 1, 2, 3].map((i) => new Fader(`L${i + 1}`, `fz-l${i + 1}`, () => st.layers[i].levelDb, (db) => { st.layers[i].levelDb = db; this.scheduleRender(); }));
    const mixMod = h("section", { class: "module mix", "aria-label": "Layer levels" }, ...screws(), ...faders.map((f) => f.el));

    root.append(header, this.layersEl, h("footer", { class: "bottom" }, resultMod, samplerMod, mixMod));
    this.syncOp();
    this.updateKeys();
    this.setResult(null);

    new ResizeObserver(() => this.layout(false)).observe(this.layersEl);
    this.layout(false);
    this.sampler.onActivity = () => this.animatePlayhead();
    this.wireKeyboard();
  }

  private syncOp(): void {
    const o = OPS.find((x) => x.id === this.st.op)!;
    this.pairRow.hidden = !o.pair;
    this.opHint.textContent = o.hint;
  }

  private toSlot(i: number): void {
    if (!this.result) return;
    const copies = this.result.channels.map((c) => c.slice());
    this.slotPick.hidden = true;
    this.setLayerAudio(i, `Result → L${i + 1}`, copies, false);
    this.toast(`The result is now layer ${i + 1}. Select parts of it to iterate.`);
  }

  private raf = 0;
  private animatePlayhead(): void {
    if (this.raf) return;
    const tick = () => {
      const p = this.sampler.playhead();
      if (p < 0) { this.playheadEl.style.display = "none"; this.raf = 0; if (!this.sampler.active) return; }
      else { this.playheadEl.style.display = "block"; this.playheadEl.style.left = `${p * 100}%`; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private updateKeys(): void {
    this.keysEl.textContent = `Keys A–L · ${noteName(this.keyBase)}\nZ X octave${this.midiInputs ? ` · MIDI ×${this.midiInputs}` : ""}`;
  }

  private async enableMidi(): Promise<void> {
    this.ensureAudio();
    const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
    if (!nav.requestMIDIAccess) { this.toast("This browser has no Web MIDI. Use the computer keyboard, or the plugin."); return; }
    try {
      const access = await nav.requestMIDIAccess();
      const attach = () => {
        this.midiInputs = 0;
        access.inputs.forEach((inp) => { inp.onmidimessage = (m) => this.onMidi(m.data); this.midiInputs++; });
        this.midiKey.setAttribute("aria-pressed", String(this.midiInputs > 0));
        this.updateKeys();
      };
      attach();
      access.onstatechange = attach;
      this.toast(this.midiInputs ? `MIDI on · ${this.midiInputs} input${this.midiInputs > 1 ? "s" : ""}` : "MIDI on · no keyboard connected yet");
    } catch {
      this.toast("MIDI is blocked on this page. The computer keyboard works, and MIDI works in the plugin.");
    }
  }

  private onMidi(d: Uint8Array | null): void {
    if (!d) return;
    const type = d[0] & 0xf0;
    if (type === 0x90 && d[2] > 0) this.sampler.noteOn(d[1], d[2] / 127);
    else if (type === 0x80 || (type === 0x90 && d[2] === 0)) this.sampler.noteOff(d[1]);
  }

  private wireKeyboard(): void {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    window.addEventListener("keydown", (e) => {
      if (typing(e.target)) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.code === "KeyZ") { e.preventDefault(); this.undo(e.shiftKey); }
        else if (e.code === "KeyY") { e.preventDefault(); this.undo(true); }
        return;
      }
      if (e.altKey) return;
      if ((e.key === "Delete" || e.key === "Backspace") && this.pickedShape) {
        e.preventDefault();
        const p = this.pickedShape;
        this.pickedShape = null;
        this.editShapes(p.layer, (sh) => { sh.splice(p.shape, 1); });
        return;
      }
      if (e.key === "Escape") { if (this.pickedShape) this.setPicked(null); else this.focus(0); return; }
      if (/^Digit[0-4]$/.test(e.code) && !e.shiftKey) { this.focus(+e.code.slice(5)); return; }
      if (e.repeat) { if (e.code in KEYMAP || e.code === "Space") e.preventDefault(); return; }
      if (e.code === "KeyZ" || e.code === "KeyX") { this.keyBase = Math.max(12, Math.min(96, this.keyBase + (e.code === "KeyX" ? 12 : -12))); this.updateKeys(); return; }
      if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); this.ensureAudio(); this.sampler.noteOn(this.st.root); this.held.set("Space", this.st.root); return; }
      const off = KEYMAP[e.code];
      if (off === undefined) return;
      if (e.target instanceof HTMLElement && e.target.getAttribute("role") === "slider" && /^Arrow/.test(e.key)) return;
      this.ensureAudio();
      const note = this.keyBase + off;
      this.held.set(e.code, note);
      this.sampler.noteOn(note, 0.85);
    });
    window.addEventListener("keyup", (e) => {
      const n = this.held.get(e.code);
      if (n !== undefined) { this.held.delete(e.code); this.sampler.noteOff(n); }
    });
    window.addEventListener("blur", () => { this.held.clear(); this.sampler.allOff(); });
  }

  async boot(): Promise<void> {
    try {
      const sounds = await this.host.examples(SR);
      sounds.forEach((x, i) => this.setLayerAudio(i, EXAMPLE_NAMES[i], [x], true));
      await this.renderNow();
    } catch (e) {
      this.status("Engine failed to start");
      this.toast((e as Error).message);
    }
  }
}

/** Below the design size, scale the whole instrument (like resizing the plugin window). */
function fit(app: HTMLElement): void {
  const minW = 1180, minH = 760, z = Math.min(1, window.innerWidth / minW);
  app.style.zoom = z < 1 ? String(z) : "";
  app.style.height = z < 1 ? `${Math.max(minH, window.innerHeight / z)}px` : "";
}

const root = document.getElementById("app")!;
const app = new App();
fit(root);
window.addEventListener("resize", () => fit(root));
app.build(root);
void app.boot();

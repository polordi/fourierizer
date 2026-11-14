// Fourierizer UI entry point. Builds the window, owns the project state and talks to its
// environment through `Host`: BrowserHost in the demo, PluginHost inside the plugin.

import { BrowserHost, type Host, type PlayState, type ResultInfo, type SamplerParams, type SourceInfo } from "./host.ts";
import { PluginHost, insidePlugin } from "./plugin-host.ts";
import { HELP } from "./view/help.ts";
import { installTooltips } from "./view/tooltip.ts";
import { Piano } from "./view/piano.ts";
import { LayerView, paintSpectrogram, type LayerHost, type Mode } from "./view/layer.ts";
import { h, icon, ICONS, screws } from "./view/dom.ts";
import { Fader, Knob, MiniKnob, Segmented, Stepper, confirmKey, key } from "./view/controls.ts";
import { getAxis, setAxis, type Look } from "./dsp/spectrogram.ts";
import { EXAMPLE_NAMES } from "./dsp/examples.ts";
import { OPS, type Op } from "./dsp/ops.ts";
import type { Shape } from "./dsp/mask.ts";
import type { LayerJob } from "./protocol.ts";
import {
  SR, MAX_SECONDS, DEFAULT_DISPLAY, HIGH_HZ, LOW_HZ, activeLayers, adsrMap, axisOf, cloneShapes, emptyLayer, emptyState, exampleState, featherOf, gridOf, noteName,
  type LayerState, type State, type Tool,
} from "./model.ts";

const KEYMAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};

class App implements LayerHost {
  host: Host = insidePlugin() ? new PluginHost() : new BrowserHost();
  st: State = this.host.kind === "plugin" ? emptyState() : exampleState();
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
  private result: { duration: number } | null = null;
  private keyBase = 48;
  private held = new Map<string, number>();
  private midiInputs = 0;
  private refreshers: { refresh(): void }[] = [];
  private savedJson = "";
  private original = [false, false, false, false];   // A/B per layer: preview the original sound
  private resultImg: { data: Uint8Array; cols: number; rows: number } | null = null;

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
  private outKeys!: HTMLElement;

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
  ensureAudio(): void { this.host.ensureAudio(); }

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

  pickFile(i: number): boolean {
    const p = this.host.pickFile(i);
    if (!p) return false;
    p.then((info) => { if (info) this.applySource(i, info, false); }).catch((e: Error) => this.toast(e.message));
    return true;
  }
  capture(_i: number): void {
    this.toast("Capturing from the mixer arrives with the Fourierizer Capture plugin (milestone H8).");
  }
  isOriginal(i: number): boolean { return this.original[i]; }
  setOriginal(i: number, on: boolean): void {
    this.original[i] = on;
    this.views[i].refresh();
    if (this.previewShown === i || this.previewWanted === i) this.host.setPreviewOriginal(on);
  }
  look(): Look { return { rangeDb: this.st.display.rangeDb, gainDb: this.st.display.gainDb }; }
  labels(): "hz" | "notes" { return this.st.display.labels; }
  root(): number { return this.st.root; }
  /** The pianos on every axis follow the root and the display axis. */
  private refreshPianos(): void {
    this.views?.forEach((v) => v.refreshAxis());
    this.resultPiano.setRoot(this.st.root);
    this.resultPiano.draw();
  }
  private resultPiano = new Piano();

  /** Empty one slot: its sound, selections and parameters. */
  removeSound(i: number): void {
    if (this.previewShown === i || this.previewWanted === i) this.stopPreview();
    this.host.clearSource(i);
    this.st.layers[i] = emptyLayer(i);
    this.original[i] = false;
    if (this.pickedShape?.layer === i) this.pickedShape = null;
    this.undoStack = []; this.redoStack = [];
    this.views[i].clearSpectrogram();
    this.views[i].refresh();
    this.toast(`Layer ${i + 1} is empty`);
    this.scheduleRender(true);
  }

  /** New project: every slot and the result emptied; sampler and display settings stay. */
  private resetAll(): void {
    this.stopPreview();
    for (let i = 0; i < 4; i++) this.host.clearSource(i);
    const keep = { adsr: this.st.adsr, root: this.st.root, display: this.st.display, auto: this.st.auto };
    this.st = { ...emptyState(), ...keep };
    this.original = [false, false, false, false];
    this.pickedShape = null;
    this.undoStack = []; this.redoStack = [];
    this.host.clearResult();
    this.setResult(null);
    this.syncOp();
    this.refreshers.forEach((x) => x.refresh());
    this.layout(false);
    this.views.forEach((v) => { v.clearSpectrogram(); v.refresh(); });
    this.status("Drop sounds on the layers to begin");
  }

  toggleMute(i: number): void { const l = this.st.layers[i]; l.mute = !l.mute; this.views[i].refresh(); this.scheduleRender(); }
  toggleSolo(i: number): void { const l = this.st.layers[i]; l.solo = !l.solo; this.views[i].refresh(); this.scheduleRender(); }

  private previewReq = 0;
  private previewWanted = -1;
  private previewShown = -1;
  togglePreview(i: number): void {
    this.ensureAudio();
    if (this.previewShown === i || this.previewWanted === i) { this.stopPreview(); return; }
    const l = this.st.layers[i];
    if (!l.loaded) return;
    if (!l.shapes.length && !this.original[i]) { this.toast(`Nothing is selected on layer ${i + 1} yet (Orig plays the whole sound)`); return; }
    this.stopPreview();
    this.previewWanted = i;
    this.views[i].setPreviewing(true);
    const req = ++this.previewReq;
    this.host.preview(i, this.job(l), this.original[i]).then((r) => {
      if (req !== this.previewReq) return;
      this.previewWanted = -1;
      if (!(r.peak > 0)) { this.views[i].setPreviewing(false); this.toast(`The selection on layer ${i + 1} is silent`); return; }
      this.previewShown = i;
      this.animatePlayhead();
    }).catch((e: Error) => { if (req === this.previewReq) { this.previewWanted = -1; this.views[i].setPreviewing(false); this.toast(e.message); } });
  }
  private stopPreview(): void {
    this.previewReq++;
    for (const j of [this.previewWanted, this.previewShown]) if (j >= 0) this.views[j].setPreviewing(false);
    this.previewWanted = this.previewShown = -1;
    this.host.stopPreview();
  }

  async load(i: number, file: File): Promise<void> {
    try {
      this.toast(`Loading ${file.name}…`);
      const info = await this.host.loadFile(i, file);
      this.applySource(i, info, false);
      this.toast(info.trimmed ? `Loaded the first ${MAX_SECONDS} s of ${file.name}` : `Loaded ${file.name} into layer ${i + 1}`);
    } catch (e) {
      this.toast((e as Error).message || `Could not read ${file.name}. Try WAV, AIFF, FLAC, MP3 or OGG.`);
    }
  }

  /** A layer got new audio (its source already lives in the host). */
  private applySource(i: number, info: SourceInfo, keepShapes: boolean, render = true): void {
    const l = this.st.layers[i];
    l.name = info.name; l.loaded = true; l.samples = info.samples; l.channels = info.channels;
    if (!keepShapes) { l.shapes = []; l.pitch = 0; l.offset = 0; }
    if (this.pickedShape?.layer === i) this.pickedShape = null;
    if (this.previewShown === i || this.previewWanted === i) this.stopPreview();
    this.views[i].clearSpectrogram();
    this.views[i].refresh();
    void this.requestSpectrogram(i);
    if (render) this.scheduleRender();
  }

  private async requestSpectrogram(i: number): Promise<void> {
    const l = this.st.layers[i];
    if (!l.loaded) return;
    const req = ++this.specReq[i];
    try {
      const img = await this.host.spectrogram(i, l.pitch, gridOf(l), SR, getAxis());
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
    if (!active.length) { this.host.clearResult(); this.setResult(null); this.status(this.st.layers.some((l) => l.loaded) ? "Every layer is muted" : "Load a sound to begin"); return; }
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
      const r = await this.host.render({ sr: SR, op, a: this.st.opA, b: this.st.opB, layers: active.map((l) => this.job(l)), all, axis: getAxis() });
      this.showResult(r);
      const used = pair ? [this.st.opA, this.st.opB] : lit;
      this.leds.forEach((e, i) => (e.dataset.on = String(used.includes(i))));
    } catch (e) {
      this.status("Render failed");
      this.toast((e as Error).message);
    } finally {
      clearInterval(blink);
      this.rendering = false;
      if (this.queued) { this.queued = false; void this.renderNow(); }
    }
  }

  private showResult(r: ResultInfo): void {
    this.setResult(r.duration > 0 && r.peak > 0 ? { duration: r.duration } : null, r.image);
    this.status(r.peak > 0 ? `Done · ${(r.ms / 1000).toFixed(2)} s · peak −0.3 dBFS` : "Silent · nothing is selected");
  }

  private setResult(r: { duration: number } | null, image?: { data: Uint8Array; cols: number; rows: number } | null): void {
    this.result = r;
    this.resultImg = r && image ? image : null;
    if (r && image) paintSpectrogram(this.resultCanvas, image, 0, this.look());
    else this.resultCanvas.getContext("2d")?.clearRect(0, 0, this.resultCanvas.width, this.resultCanvas.height);
    this.resultEmpty.style.display = r ? "none" : "";
    this.outKeys.toggleAttribute("data-off", !r);
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

  // ------------------------------------------------------------------ sampler
  private samplerParams(): SamplerParams { return { ...this.st.adsr, root: this.st.root, mode: this.st.keytrack, window: this.st.spectralWindow }; }

  private prepBar!: HTMLElement;
  private windowOpts: HTMLButtonElement[] = [];
  private tapeNote!: HTMLElement;
  private keytrackSub!: HTMLElement;
  private keytrackSeg: { refresh(): void } | null = null;
  private syncKeytrack(): void {
    const spectral = this.st.keytrack === "spectral";
    this.keytrackSub.classList.toggle("spectral", spectral);
    this.windowOpts.forEach((b) => b.setAttribute("aria-checked", String(b.textContent!.toLowerCase() === this.st.spectralWindow)));
    this.keytrackSeg?.refresh();
    this.showPrep(this.host.playState());
  }
  private showPrep(s: PlayState): void {
    const total = s.spectralTotal ?? 0, ready = s.spectralReady ?? 0;
    const busy = this.st.keytrack === "spectral" && total > 0 && ready < total;
    this.prepBar.style.width = busy ? `${(100 * ready) / total}%` : "0";
    this.prepBar.parentElement!.title = busy ? `${HELP.spectral}

Ready: ${ready} of ${total} notes around the root` : HELP.spectral;
  }
  private pushSampler(): void { this.host.setSampler(this.samplerParams()); this.refreshPianos(); }

  private audition(): void {
    this.ensureAudio();
    if (!this.result) return;
    const root = this.st.root;
    this.host.noteOn(root, 0.9);
    window.setTimeout(() => this.host.noteOff(root), Math.max(50, this.result.duration * 1000 - adsrMap.r(this.st.adsr.r) * 500));
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
  private knobs: { refresh(spring?: boolean): void }[] = [];
  private rootStep!: Stepper;

  build(root: HTMLElement): void {
    const st = this.st;
    const plugin = this.host.kind === "plugin";

    // header
    const viewSeg = new Segmented(null, [
      { id: "0", label: "Grid", icon: icon(ICONS.grid), cls: "row", aria: "Show all four layers", title: "All four layers (0)" },
      ...[1, 2, 3, 4].map((n) => {
        const sw = h("span", { class: "swatch", "aria-hidden": "true" });
        return { id: String(n), label: String(n), icon: sw as unknown as SVGElement, cls: `row fz-l${n}`, aria: `Focus layer ${n}`, title: `Focus layer ${n} (${n})` };
      }),
    ], () => String(this.st.focus), (id) => this.focus(+id), "");
    const toolSeg = new Segmented(null, ([
      ["rect", "Rect", ICONS.rect, "Drag a rectangle to select (Alt subtracts). Click a selection to move, resize, fade or delete it"],
      ["lasso", "Lasso", ICONS.lasso, "Draw a free shape to select (Alt subtracts). Click a selection to move, scale, fade or delete it"],
      ["erase", "Erase", ICONS.erase, "Drag a rectangle to remove from the selection"],
      ["move", "Move", ICONS.move, "Only pick and move selections, never draw. Delete removes the picked one"],
    ] as const).map(([id, label, ic, title]) => ({ id, label, icon: icon(ic), cls: "row", title })),
    () => this.st.tool, (id) => { this.st.tool = id as Tool; this.applyTool(); });
    this.refreshers.push(viewSeg, toolSeg);
    const header = h("header", { class: "top" },
      h("div", { class: "brand" }, h("span", { class: "wordmark" }, "Fourierizer"), h("span", { class: "silk" }, "Time–frequency selection synth")),
      h("span", { class: "grow" }),
      h("div", { class: "group" }, h("span", { class: "silk" }, "View"), viewSeg.el),
      h("div", { class: "group" }, h("span", { class: "silk" }, "Tool"), toolSeg.el),
      h("div", { class: "group" }, this.buildDisplayPanel(),
        confirmKey(key("New", ICONS.fresh, { class: "sm", title: HELP.fresh }), () => this.resetAll())),
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
    this.autoKey = key("Auto-render", null, { class: "sm", "aria-pressed": String(st.auto), title: "Re-render automatically after every change" }, () => {
      this.st.auto = !this.st.auto; this.autoKey.setAttribute("aria-pressed", String(this.st.auto)); if (this.st.auto) this.scheduleRender(true);
    });
    this.slotPick = h("div", { class: "slotpick", hidden: true });
    this.slotPick.append(...[1, 2, 3, 4].map((n) => {
      const b = key(String(n), null, { class: `sm fz-l${n}`, "aria-label": `Send the result to layer ${n}`, title: `Replace layer ${n} with the result` }, () => void this.toSlot(n - 1));
      b.prepend(h("span", { class: "swatch", "aria-hidden": "true" }));
      return b;
    }));
    this.slotPick.prepend(h("span", { class: "silk sm" }, "Replace layer"));
    const slotKey = key("Send to layer", null, { class: "sm", title: "Use the result as a source: it replaces one of the four layers, so you can select from it again (iteration)" }, () => {
      if (!this.result) { this.toast("Render something first"); return; }
      this.slotPick.hidden = !this.slotPick.hidden;
    });
    const goCol = h("div", { class: "go-col" }, go, h("div", { class: "leds" }, ...this.leds), this.statusEl,
      this.autoKey, slotKey, this.slotPick);

    const opSeg = new Segmented(null, OPS.map((o) => ({ id: o.id, label: o.label, title: o.hint })), () => this.st.op, (id) => {
      this.st.op = id as Op; this.syncOp(); this.scheduleRender(true);
    });
    const pairSeg = (which: "opA" | "opB") => new Segmented(null, [0, 1, 2, 3].map((i) => ({ id: String(i), label: String(i + 1), cls: `fz-l${i + 1}`, aria: `Layer ${i + 1}` })),
      () => String(this.st[which]), (id) => { this.st[which] = +id; this.scheduleRender(true); }, "pairpick");
    const segA = pairSeg("opA"), segB = pairSeg("opB");
    this.opHint = h("span", { class: "ro-sm", style: "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0" });
    this.pairRow = h("div", { class: "pairpick" }, h("span", { class: "silk sm" }, "A"), segA.el, h("span", { class: "silk sm" }, "B"), segB.el);
    this.resultMeta = h("span", { class: "ro-sm", style: "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto" });

    // Export and drag-out (the plugin writes the WAV; dragging drops it into FL's playlist)
    const exportKey = key("WAV", ICONS.load, { class: "sm", title: "Export the result as a 24-bit WAV file" }, () => {
      if (!this.result || !this.host.exportResult) return;
      this.host.exportResult().then((path) => { if (path) this.toast(`Saved ${path}`); }).catch((e: Error) => this.toast(e.message));
    });
    const dragKey = key("Drag", ICONS.move, { class: "sm drag", title: "Drag the result into the playlist or a sampler" });
    dragKey.addEventListener("pointerdown", (e) => { if (e.button === 0 && this.result && this.host.dragResult) this.host.dragResult(); });
    this.outKeys = h("div", { class: "outkeys" }, exportKey, dragKey);
    this.outKeys.hidden = !plugin;

    this.resultCanvas = h("canvas", { class: "spec" });
    this.playheadEl = h("span", { class: "playhead" });
    this.resultEmpty = h("div", { class: "empty-hint silk" }, "Nothing selected yet");
    const resultDisplay = h("div", { class: "display", title: "Click to play the result at the root note", role: "button", tabindex: 0, "aria-label": "Result spectrogram. Press to play" },
      this.resultCanvas, this.playheadEl, this.resultEmpty);
    resultDisplay.addEventListener("click", () => this.audition());
    resultDisplay.addEventListener("keydown", (e) => { if (e.key === "Enter") this.audition(); });
    this.resultAxis = h("div", { class: "rx", "aria-hidden": "true" });
    const resultMain = h("div", { class: "main" },
      h("div", { class: "rhead" }, h("span", { style: "font:600 16px/20px var(--font-sans)" }, "Result"), this.pairRow, h("span", { class: "grow" }), this.resultMeta, this.outKeys),
      h("div", { class: "rhead" }, opSeg.el, this.opHint),
      h("div", { class: "rbody" }, this.resultPiano.el, resultDisplay), this.resultAxis);
    const resultMod = h("section", { class: "module result", "aria-label": "Result" }, ...screws(), goCol, resultMain);
    this.refreshers.push(opSeg, segA, segB);

    // sampler module
    const keytrack = new Segmented("Keytrack", [
      { id: "tape", label: "Tape", title: HELP.tape },
      { id: "spectral", label: "Spectral", title: HELP.spectral },
    ], () => this.st.keytrack, (id) => { this.st.keytrack = id as "tape" | "spectral"; this.syncKeytrack(); this.pushSampler(); });
    keytrack.el.dataset.tip = HELP.keytrack;
    this.keytrackSeg = keytrack;
    keytrack.el.classList.add("ktrack");
    // Spectral: which window, and how many notes of the octave around the root are ready
    this.prepBar = h("span", { class: "prep", "aria-hidden": "true" });
    keytrack.el.querySelectorAll(".seg-opt")[1].append(this.prepBar);
    this.windowOpts = (["tonal", "mixed", "punchy"] as const).map((w) => {
      const b = h("button", { class: "wopt", type: "button", role: "radio" }, w[0].toUpperCase() + w.slice(1));
      b.addEventListener("click", () => { this.st.spectralWindow = w; this.syncKeytrack(); this.pushSampler(); });
      return b;
    });
    this.tapeNote = h("span", { class: "ro-sm" }, "Higher keys play shorter");
    const windowRow = h("div", { class: "wopts", role: "radiogroup", "aria-label": "Spectral window" }, ...this.windowOpts);
    windowRow.dataset.tip = HELP.spectralWindow;
    this.keytrackSub = h("div", { class: "ktsub" }, this.tapeNote, windowRow);
    keytrack.el.append(this.keytrackSub);
    this.rootStep = new Stepper({
      label: "Root", display: () => noteName(this.st.root), derived: () => `MIDI ${this.st.root} · ${(440 * 2 ** ((this.st.root - 69) / 12)).toFixed(1)} Hz`,
      canStep: (d) => d > 0 ? this.st.root < 127 : this.st.root > 0,
      step: (d, fine) => { this.st.root = Math.max(0, Math.min(127, this.st.root + d * (fine ? 12 : 1))); this.pushSampler(); },
      dragPx: 10, tip: HELP.root,
    });
    this.keysEl = h("span", { class: "ro-sm keys" });
    this.midiKey = key("MIDI", ICONS.midi, { class: "sm", title: "Play from a MIDI keyboard (if the browser allows it)" }, () => void this.enableMidi());
    this.midiKey.hidden = plugin;  // in the plugin, MIDI comes from the host
    const fmtMs = (s: number) => s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`;
    const knob = (k: "a" | "d" | "s" | "r", label: string, fmt: (v: number) => string, reset: number) =>
      new Knob({ label, aria: { a: "Attack", d: "Decay", s: "Sustain", r: "Release" }[k], tip: { a: HELP.attack, d: HELP.decay, s: HELP.sustain, r: HELP.release }[k], get: () => this.st.adsr[k], set: (v) => { this.st.adsr[k] = v; this.pushSampler(); }, format: fmt, reset });
    const kA = knob("a", "Atk", (v) => fmtMs(adsrMap.a(v)), 0.18), kD = knob("d", "Dec", (v) => fmtMs(adsrMap.d(v)), 0.33);
    const kS = knob("s", "Sus", (v) => v < 0.005 ? "−∞ dB" : `${(20 * Math.log10(v)).toFixed(1).replace("-", "−")} dB`, 0.7);
    const kR = knob("r", "Rel", (v) => fmtMs(adsrMap.r(v)), 0.4);
    this.knobs = [kA, kD, kS, kR];
    const samplerMod = h("section", { class: "module sampler fz-l0", "aria-label": "Sampler" }, ...screws(),
      h("div", { class: "row" }, keytrack.el, this.rootStep.el, h("span", { class: "grow" }),
        h("div", { style: "display:grid;gap:6px;justify-items:end" }, this.midiKey, this.keysEl)),
      h("div", { class: "knobs" }, kA.el, kD.el, kS.el, kR.el));
    this.refreshers.push(keytrack, { refresh: () => this.syncKeytrack() });

    // mix
    const faders = [0, 1, 2, 3].map((i) => new Fader(`L${i + 1}`, `fz-l${i + 1}`, () => this.st.layers[i].levelDb, (db) => { this.st.layers[i].levelDb = db; this.scheduleRender(); }, HELP.level));
    this.refreshers.push(...faders);
    const mixMod = h("section", { class: "module mix", "aria-label": "Layer levels" }, ...screws(), ...faders.map((f) => f.el));

    root.append(header, this.layersEl, h("footer", { class: "bottom" }, resultMod, samplerMod, mixMod));
    this.syncOp();
    this.updateKeys();
    this.setResult(null);
    // The plugin's parameters live in the host (saved with the project): the UI reads them in
    // restore() and must not overwrite them with its defaults when the window opens.
    if (!plugin) this.pushSampler();

    new ResizeObserver(() => this.layout(false)).observe(this.layersEl);
    this.layout(false);
    this.host.onPlay = () => this.animatePlayhead();
    this.host.onParams = (p) => this.applySamplerParams(p);
    this.host.onReload = () => void this.restore();
    this.wireKeyboard();
    if (plugin) window.setInterval(() => this.save(), 700);
  }

  private applyTool(): void {
    this.views.forEach((v) => { v.el.className = v.el.className.replace(/\btool-\w+/g, ""); v.el.classList.add(`tool-${this.st.tool}`); v.drawShapes(); });
  }

  private applySamplerParams(p: SamplerParams): void {
    this.st.adsr = { a: p.a, d: p.d, s: p.s, r: p.r };
    this.st.root = p.root;
    if (p.mode) this.st.keytrack = p.mode;
    if (p.window) this.st.spectralWindow = p.window;
    this.syncKeytrack();
    this.refreshPianos();
    this.knobs.forEach((k) => k.refresh());
    this.rootStep.refresh();
  }

  private syncOp(): void {
    const o = OPS.find((x) => x.id === this.st.op) ?? OPS[0];
    this.st.op = o.id;
    this.pairRow.hidden = !o.pair;
    this.opHint.textContent = o.hint;
  }

  private async toSlot(i: number): Promise<void> {
    if (!this.result) return;
    this.slotPick.hidden = true;
    try {
      const info = await this.host.resultToLayer(i, `Result → L${i + 1}`);
      this.applySource(i, info, false);
      this.toast(`The result is now layer ${i + 1}. Select parts of it to iterate.`);
    } catch (e) { this.toast((e as Error).message); }
  }

  private raf = 0;
  private animatePlayhead(): void {
    if (this.raf) return;
    const tick = () => {
      const s = this.host.playState();
      this.showPrep(s);
      if (this.previewShown >= 0 && s.preview !== this.previewShown && this.previewWanted < 0) {
        this.views[this.previewShown].setPreviewing(false);   // the preview ended on its own
        this.previewShown = -1;
      }
      if (s.preview >= 0) this.views[s.preview].setPlayhead(s.previewPos);
      if (s.result < 0) this.playheadEl.style.display = "none";
      else { this.playheadEl.style.display = "block"; this.playheadEl.style.left = `${s.result * 100}%`; }
      const preparing = this.st.keytrack === "spectral" && (s.spectralReady ?? 0) < (s.spectralTotal ?? 0);
      if (s.result < 0 && s.voices === 0 && s.preview < 0 && this.previewWanted < 0 && this.previewShown < 0 && !preparing) { this.raf = 0; return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private updateKeys(): void {
    const midi = this.host.kind !== "plugin" && this.midiInputs ? ` · MIDI ×${this.midiInputs}` : "";
    this.keysEl.textContent = `Keys A–L · ${noteName(this.keyBase)}\nZ X octave${midi}`;
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
    if (type === 0x90 && d[2] > 0) this.host.noteOn(d[1], d[2] / 127);
    else if (type === 0x80 || (type === 0x90 && d[2] === 0)) this.host.noteOff(d[1]);
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
      if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); this.ensureAudio(); this.host.noteOn(this.st.root, 0.9); this.held.set("Space", this.st.root); return; }
      const off = KEYMAP[e.code];
      if (off === undefined) return;
      if (e.target instanceof HTMLElement && e.target.getAttribute("role") === "slider" && /^Arrow/.test(e.key)) return;
      e.preventDefault();
      this.ensureAudio();
      const note = this.keyBase + off;
      this.held.set(e.code, note);
      this.host.noteOn(note, 0.85);
    });
    window.addEventListener("keyup", (e) => {
      const n = this.held.get(e.code);
      if (n !== undefined) { this.held.delete(e.code); this.host.noteOff(n); }
    });
    window.addEventListener("blur", () => { if (this.held.size) { this.held.clear(); this.host.allOff(); } });
  }

  // ------------------------------------------------------------------ project (plugin)
  private serialized(): string { return JSON.stringify({ version: 1, state: this.st }); }

  private save(): void {
    const json = this.serialized();
    if (json === this.savedJson) return;
    this.savedJson = json;
    this.host.saveProject(json);
  }

  /** Load the plugin's saved project into the UI. */
  private async restore(): Promise<void> {
    const r = await this.host.start();
    if (!r) return;
    let next = emptyState();
    if (r.project) {
      try {
        const saved = JSON.parse(r.project).state as State;
        next = { ...next, ...saved, layers: next.layers.map((l, i) => ({ ...l, ...saved.layers?.[i], index: i })) };
        next.layers.forEach((l) => { if (l.levelDb === null) l.levelDb = -Infinity; });
      } catch { /* a damaged project: start empty */ }
    }
    next.layers.forEach((l, i) => {
      const info = r.layers[i];
      l.loaded = !!info;
      if (info) { l.name = info.name; l.samples = info.samples; l.channels = info.channels; }
    });
    if (r.params) {
      next.adsr = { a: r.params.a, d: r.params.d, s: r.params.s, r: r.params.r }; next.root = r.params.root;
      if (r.params.mode) next.keytrack = r.params.mode;
      if (r.params.window) next.spectralWindow = r.params.window;
    }
    next.display = { ...DEFAULT_DISPLAY, ...next.display };
    this.st = next;
    setAxis(axisOf(this.st.display));
    this.original = [false, false, false, false];
    this.displayRefresh.forEach((x) => x.refresh());
    this.savedJson = this.serialized();
    this.pickedShape = null;
    this.undoStack = []; this.redoStack = [];
    this.autoKey.setAttribute("aria-pressed", String(this.st.auto));
    this.syncOp();
    this.applyTool();
    this.refreshers.forEach((x) => x.refresh());
    this.knobs.forEach((k) => k.refresh());
    this.rootStep.refresh();
    this.refreshPianos();
    this.layout(false);
    this.views.forEach((v, i) => { v.clearSpectrogram(); v.refresh(); if (this.st.layers[i].loaded) void this.requestSpectrogram(i); });
    if (r.result && r.result.duration > 0) this.showResult(r.result);
    else if (this.st.layers.some((l) => l.loaded)) await this.renderNow();
    else { this.setResult(null); this.status("Drop sounds on the layers to begin"); }
  }

  // ------------------------------------------------------------------ display (spectrogram look)
  private displayRefresh: { refresh(): void }[] = [];

  private buildDisplayPanel(): HTMLElement {
    const d = () => this.st.display;
    const panel = h("div", { class: "displaypanel fz-l0", hidden: true, role: "dialog", "aria-label": "Spectrogram display" });
    const axisChanged = () => {
      setAxis(axisOf(d()));
      this.views.forEach((v, i) => { v.refresh(); if (this.st.layers[i].loaded) void this.requestSpectrogram(i); });
      if (this.result) this.host.resultImage(getAxis()).then((img) => { if (img && this.result) { this.resultImg = img; paintSpectrogram(this.resultCanvas, img, 0, this.look()); } }).catch(() => { });
      this.displayRefresh.forEach((x) => x.refresh());
      this.refreshPianos();
    };
    const lookChanged = () => {
      this.views.forEach((v) => v.repaint());
      if (this.resultImg) paintSpectrogram(this.resultCanvas, this.resultImg, 0, this.look());
    };
    const scale = new Segmented("Scale", [{ id: "log", label: "Log", title: HELP.scale }, { id: "lin", label: "Lin", title: HELP.scale }],
      () => d().scale, (id) => { d().scale = id as "log" | "lin"; axisChanged(); });
    const labels = new Segmented("Labels", [{ id: "hz", label: "Hz", title: HELP.labels }, { id: "notes", label: "Notes", title: HELP.labels }],
      () => d().labels, (id) => { d().labels = id as "hz" | "notes"; this.refreshPianos(); });
    const hz = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : String(f));
    const listStep = (label: string, list: number[], get: () => number, set: (v: number) => void, ok: (v: number) => boolean, tip: string) => new Stepper({
      label, display: () => hz(get()), derived: () => "Hz", tip,
      canStep: (dir) => { const i = list.indexOf(get()) + dir; return i >= 0 && i < list.length && ok(list[i]); },
      step: (dir) => { const i = Math.max(0, list.indexOf(get())) + dir; if (i >= 0 && i < list.length && ok(list[i])) { set(list[i]); axisChanged(); } },
      dragPx: 16,
    });
    const low = listStep("Low", LOW_HZ, () => d().fmin, (v) => { d().fmin = v; }, (v) => v < d().fmax / 2 && (v > 0 || d().scale === "lin"), HELP.lowHz);
    const high = listStep("High", HIGH_HZ, () => d().fmax, (v) => { d().fmax = v; }, (v) => v > d().fmin * 2, HELP.highHz);
    const range = new MiniKnob({ label: "Range", aria: "Spectrogram dB range", tip: HELP.rangeDb, reset: (58 - 24) / 96,
      get: () => (d().rangeDb - 24) / 96, set: (v) => { d().rangeDb = Math.round(24 + v * 96); lookChanged(); }, format: () => `${d().rangeDb} dB` });
    const gain = new MiniKnob({ label: "Gain", aria: "Spectrogram gain", tip: HELP.gainDb, reset: 0.5,
      get: () => (d().gainDb + 30) / 60, set: (v) => { d().gainDb = Math.round(v * 60 - 30); lookChanged(); }, format: () => `${d().gainDb > 0 ? "+" : d().gainDb < 0 ? "−" : ""}${Math.abs(d().gainDb)} dB` });
    const reset = key("Reset", null, { class: "sm", title: "Back to the default view" }, () => {
      this.st.display = { ...DEFAULT_DISPLAY };
      [range, gain].forEach((k) => k.refresh());
      lookChanged(); axisChanged();
    });
    this.displayRefresh.push(scale, low, high, range, gain, labels);
    panel.append(h("div", { class: "row" }, scale.el, low.el, high.el), h("div", { class: "row" }, labels.el, range.el, gain.el, h("span", { class: "grow" }), reset));
    const button = key("Display", ICONS.display, { class: "sm", "aria-expanded": "false", title: HELP.display }, () => {
      panel.hidden = !panel.hidden;
      button.setAttribute("aria-pressed", String(!panel.hidden));
    });
    document.addEventListener("pointerdown", (e) => {
      if (!panel.hidden && !wrap.contains(e.target as Node)) { panel.hidden = true; button.setAttribute("aria-pressed", "false"); }
    });
    const wrap = h("div", { class: "displaywrap" }, button, panel);
    return wrap;
  }

  async boot(): Promise<void> {
    try {
      if (this.host.kind === "plugin") { await this.restore(); return; }
      const sounds = await this.host.examples(SR);
      sounds.forEach((x, i) => this.applySource(i, this.host.setSourceAudio(i, EXAMPLE_NAMES[i], [x]), true, false));
      await this.renderNow();
    } catch (e) {
      this.status("Engine failed to start");
      this.toast((e as Error).message);
    }
  }
}

/** Below the design size, scale the whole instrument (like resizing the plugin window). */
function fit(app: HTMLElement): void {
  // The plugin scales the whole approved 1440×900 layout, like hardware; the page reflows from 1180.
  const plugin = insidePlugin(), minW = plugin ? 1440 : 1180, minH = plugin ? 900 : 760;
  const z = Math.min(1, window.innerWidth / minW, plugin ? window.innerHeight / minH : 1);
  app.style.zoom = z < 1 ? String(z) : "";
  app.style.height = z < 1 ? `${Math.max(minH, window.innerHeight / z)}px` : "";
}

installTooltips();
setAxis(axisOf(DEFAULT_DISPLAY));
const root = document.getElementById("app")!;
const app = new App();
fit(root);
window.addEventListener("resize", () => fit(root));
app.build(root);
void app.boot();

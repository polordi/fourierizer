// One layer module. The same element is the 2×2 grid cell, the large editor and a rail card:
// only its box and mode class change, so CSS can animate the morph between them.

import { h, icon, s, ICONS, screws } from "./dom.ts";
import { Knob, MiniKnob, Segmented, Stepper, confirmKey, key } from "./controls.ts";
import { HELP, HOW, tip } from "./help.ts";
import { freqToY, yToFreq, getAxis, level, type Look } from "../dsp/spectrogram.ts";
import { Piano, noteFreq, noteOf } from "./piano.ts";
import { makeWindow, WINDOW_NAMES, type WindowName } from "../dsp/windows.ts";
import { F_FLOOR, envelope, harmonicNumbers, rowIntervals, type HarmShape, type Parity, type PolyShape, type RectShape, type Shape } from "../dsp/mask.ts";
import { snapRow, wandRegion } from "./wand.ts";
import { SR, WINDOW_LABELS, fadeLabel, fadeToKnob, featherLabel, knobToFade, pitchedSeconds, type LayerState, type Tool } from "../model.ts";

export type Mode = "grid" | "editor" | "rail";

/** What the layer view needs from the app. */
export interface LayerHost {
  state(i: number): LayerState;
  tool(): Tool;
  focus(i: number): void;            // 0 = grid
  isFocused(i: number): boolean;
  editShapes(i: number, fn: (shapes: Shape[]) => void, opts?: { undo?: boolean; render?: boolean }): void;
  paramsChanged(i: number, what: { spectrogram?: boolean; render?: boolean }): void;
  load(i: number, file: File): void;
  /** Opens the host's file dialog; false means the view should use its own file input. */
  pickFile(i: number): boolean;
  capture(i: number): void;
  toggleMute(i: number): void;
  toggleSolo(i: number): void;
  togglePreview(i: number): void;
  /** A/B: preview the original sound instead of the selection. */
  isOriginal(i: number): boolean;
  setOriginal(i: number, on: boolean): void;
  removeSound(i: number): void;
  look(): Look;
  /** Axis labels in Hz or as notes (C1, C2, …), and the sampler's root note (marked on the piano). */
  labels(): "hz" | "notes";
  root(): number;
  picked(): { layer: number; shape: number } | null;
  setPicked(p: { layer: number; shape: number } | null): void;
  ensureAudio(): void;
  toast(message: string): void;
}

/** Frequency ticks for the current axis: decades on a log axis, round steps on a linear one;
 *  or every C when the labels are notes (dropping the ones that would overlap). */
export function ticks(labels: "hz" | "notes" = "hz"): [string, number, boolean][] {
  const a = getAxis();
  if (labels === "notes") {
    const out: [string, number, boolean][] = [];
    let last = -1;
    for (let oct = 10; oct >= -1; oct--) {
      const f = noteFreq(12 * (oct + 1)), y = freqToY(f);
      if (y < 0.02 || y > 0.98 || (last >= 0 && y - last < 0.06)) continue;
      out.push([`C${oct}`, f, true]);
      last = y;
    }
    return out;
  }
  const lbl = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(1)}k` : String(f));
  if (a.scale === "lin") {
    const span = a.fmax - a.fmin, step = [100, 200, 500, 1000, 2000, 2500, 5000].find((s) => span / s <= 6) ?? 5000;
    const out: [string, number, boolean][] = [];
    for (let f = Math.ceil(a.fmin / step) * step; f <= a.fmax; f += step) out.push([lbl(f), f, true]);
    return out;
  }
  return [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20]
    .filter((f) => f > a.fmin * 1.05 && f < a.fmax * 0.97)
    .map((f) => [lbl(f), f, f === 100 || f === 1000 || f === 10000] as [string, number, boolean]);
}

function windowIcon(name: WindowName): SVGSVGElement {
  const w = makeWindow(name, 40);
  const vals = [...w, w[0]];
  const lo = Math.min(0, ...vals), hi = Math.max(...vals);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${i} ${(15 - ((v - lo) / (hi - lo)) * 13).toFixed(2)}`).join(" ");
  const el = s("svg", { viewBox: "0 0 40 16", "aria-hidden": "true", class: "win" });
  el.append(s("path", { d }));
  return el;
}

function lut(layer: number): Uint8ClampedArray {
  const cs = getComputedStyle(document.documentElement);
  const hex = (n: string) => { const v = cs.getPropertyValue(n).trim(); return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)); };
  const g = [255, 255, 255];
  const mid = layer ? hex(`--layer-${layer}`) : hex("--ink-muted");
  const deep = layer ? hex(`--layer-${layer}-deep`) : hex("--ink");
  const t = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    for (let c = 0; c < 3; c++) t[i * 3 + c] = v < 0.6 ? g[c] + (mid[c] - g[c]) * (v / 0.6) : mid[c] + (deep[c] - mid[c]) * ((v - 0.6) / 0.4);
  }
  return t;
}

/** Paint a spectrogram image (half-dB steps below its peak) with a layer colormap and a look
 *  (dB range and gain), so range and gain changes repaint instantly. */
export function paintSpectrogram(canvas: HTMLCanvasElement, img: { data: Uint8Array; cols: number; rows: number }, layer: number, look: Look): void {
  canvas.width = img.cols; canvas.height = img.rows;
  const ctx = canvas.getContext("2d")!, out = ctx.createImageData(img.cols, img.rows), t = lut(layer);
  const map = new Uint16Array(256);
  for (let v = 0; v < 256; v++) map[v] = Math.round(level(v, look) * 255) * 3;
  for (let i = 0; i < img.data.length; i++) {
    const v = map[img.data[i]];
    out.data[i * 4] = t[v]; out.data[i * 4 + 1] = t[v + 1]; out.data[i * 4 + 2] = t[v + 2]; out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}

/** Ramer–Douglas–Peucker on screen points. */
function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  let idx = 0, dmax = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * ey - (pts[i][1] - ay) * ex) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

function inPoly(x: number, y: number, p: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    if ((p[i][1] > y) !== (p[j][1] > y) && x < p[j][0] + (y - p[j][1]) * (p[i][0] - p[j][0]) / (p[i][1] - p[j][1])) inside = !inside;
  return inside;
}

export class LayerView {
  readonly el: HTMLElement;
  readonly i: number;
  mode: Mode = "grid";
  private host: LayerHost;
  private nameEl: HTMLElement;
  private metaEl: HTMLElement;
  private led: HTMLElement;
  private muteB: HTMLButtonElement;
  private soloB: HTMLButtonElement;
  private playB: HTMLButtonElement;
  private origB: HTMLButtonElement;
  private yax: HTMLElement;
  private img: { data: Uint8Array; cols: number; rows: number } | null = null;
  private playhead: HTMLElement;
  private focusB: HTMLButtonElement;
  private removeB!: HTMLButtonElement;
  private canvas: HTMLCanvasElement;
  private svg: SVGSVGElement;
  private handles: HTMLElement;
  private cursor: HTMLElement;
  private hint: HTMLElement;
  private display: HTMLElement;
  private xax: HTMLElement;
  private chipEls: Record<string, HTMLElement> = {};
  private controls: { refresh(): void }[] = [];
  private fileInput: HTMLInputElement;
  private hasImage = false;

  constructor(i: number, host: LayerHost) {
    this.i = i; this.host = host;
    const n = i + 1, L = () => host.state(i);

    this.nameEl = h("span", { class: "lname" });
    this.metaEl = h("span", { class: "ro-sm full", style: "white-space:nowrap" });
    this.led = h("span", { class: "led full", title: "Loaded" });
    this.muteB = key("M", null, { class: "sm", "aria-label": `Mute layer ${n}`, "aria-pressed": "false", title: HELP.mute }, () => host.toggleMute(i));
    this.soloB = key("S", null, { class: "sm", "aria-label": `Solo layer ${n}`, "aria-pressed": "false", title: HELP.solo }, () => host.toggleSolo(i));
    this.origB = key("Orig", null, { class: "sm orig", "aria-pressed": "false", title: HELP.original }, () => host.setOriginal(i, !host.isOriginal(i)));
    this.playB = key(null, ICONS.play, { class: "sm", "aria-label": `Play the selection of layer ${n}`, "aria-pressed": "false", title: HELP.playLayer }, () => host.togglePreview(i));
    this.focusB = key(null, ICONS.focus, { class: "sm", "aria-label": `Focus layer ${n}`, title: `Focus layer ${n}` }, () => host.focus(this.mode === "editor" ? 0 : n));
    this.fileInput = h("input", { type: "file", accept: "audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg,.m4a", hidden: true, "aria-label": `Audio file for layer ${n}` });
    this.fileInput.addEventListener("change", () => { const f = this.fileInput.files?.[0]; if (f) host.load(i, f); this.fileInput.value = ""; });

    const head = h("div", { class: "head" },
      h("span", { class: "num" }, String(n)), this.nameEl, this.metaEl, h("span", { class: "grow" }),
      h("span", { class: "edit-only" },
        key("All", ICONS.all, { class: "sm", title: "Select the whole sound" }, () => host.editShapes(i, (sh) => { sh.splice(0, sh.length, { kind: "rect", mode: "add", t: [-1, pitchedSeconds(L()) + 1], f: [0, 1e9] }); })),
        key("Clear", ICONS.clear, { class: "sm", title: "Remove every selection on this layer" }, () => host.editShapes(i, (sh) => { sh.length = 0; }))),
      h("span", { class: "full actions" },
        this.led,
        key(null, ICONS.load, { class: "sm", "aria-label": `Load a sound into layer ${n}`, title: "Load a sound (or drop a file here)" }, () => { host.ensureAudio(); if (!host.pickFile(i)) this.fileInput.click(); }),
        // Capture from the mixer returns with the Fourierizer Capture plugin (H8).
        this.removeB = confirmKey(key(null, ICONS.eject, { class: "sm", "aria-label": `Remove the sound from layer ${n}`, title: HELP.remove }), () => host.removeSound(i))),
      this.origB, this.playB, this.muteB, this.soloB, this.focusB, this.fileInput);

    // display
    const yax = this.yax = h("div", { class: "yax", "aria-hidden": "true" });
    this.piano = new Piano();
    this.canvas = h("canvas", { class: "spec" });
    this.svg = s("svg", { class: "ov", viewBox: "0 0 1000 1000", preserveAspectRatio: "none", role: "img", "aria-label": `Layer ${n} spectrogram and selections` });
    this.handles = h("div", { style: "position:absolute;inset:0;pointer-events:none" });
    this.cursor = h("span", { class: "cursor-ro ro-sm ink" });
    this.hint = h("div", { class: "empty-hint silk" });
    this.playhead = h("span", { class: "playhead", "aria-hidden": "true" });
    this.display = h("div", { class: "display" }, this.canvas, this.svg, this.playhead, this.handles, this.hint, this.cursor);
    this.xax = h("div", { class: "xax", "aria-hidden": "true" });
    const body = h("div", { class: "lbody" }, yax, this.display, this.xax);

    // grid-mode chips (click → focus)
    const chip = (k: string, label: string, help: string) => {
      const v = h("span", { class: "ro" });
      this.chipEls[k] = v;
      const c = h("button", { class: "chip", type: "button", "data-tip": tip(help, HOW.chip) }, h("span", { class: "silk sm" }, label), v);
      c.addEventListener("click", () => host.focus(n));
      return c;
    };
    const fthrMini = new MiniKnob({
      label: "Fthr", aria: `Layer ${n} feather`, get: () => L().feather, reset: 0.537, format: featherLabel, tip: HELP.feather,
      set: (v) => { L().feather = v; host.paramsChanged(i, { render: true }); this.refreshParams(); },
    });
    const chips = h("div", { class: "chips" }, chip("win", "Win", HELP.window), chip("n", "N", HELP.fftSize), chip("h", "H", HELP.hop), chip("ofs", "Ofs", HELP.offset), chip("pitch", "Pitch", HELP.pitch), h("span", { class: "grow" }), fthrMini.el);

    // editor-mode parameters
    const winSeg = new Segmented("Window", WINDOW_NAMES.map((w) => ({ id: w, label: WINDOW_LABELS[w], icon: windowIcon(w), title: HELP.windows[w] })), () => L().window,
      (id) => { L().window = id as WindowName; host.paramsChanged(i, { spectrogram: true, render: true }); this.refreshParams(); }, "win");
    const nStep = new Stepper({
      label: "FFT size N", display: () => String(L().N),
      derived: () => `${(L().N / SR * 1000).toFixed(1)} ms · Δf ${(SR / L().N).toFixed(1)} Hz`,
      canStep: (d) => d > 0 ? L().N < 16384 : L().N > 256,
      step: (d) => { const l = L(); const nv = d > 0 ? Math.min(16384, l.N * 2) : Math.max(256, l.N / 2); if (nv !== l.N) { l.N = nv; host.paramsChanged(i, { spectrogram: true, render: true }); this.refreshParams(); } },
      dragPx: 24, tip: HELP.fftSize,
    });
    winSeg.el.dataset.tip = HELP.window;
    const hStep = new Stepper({
      label: "Hop H", display: () => String(L().N / L().hopDiv),
      derived: () => `${(L().N / L().hopDiv / SR * 1000).toFixed(1)} ms · ${Math.round(100 - 100 / L().hopDiv)}% overlap`,
      canStep: (d) => d > 0 ? L().hopDiv > 2 : L().hopDiv < 16,
      step: (d) => { const l = L(); const nv = d > 0 ? Math.max(2, l.hopDiv / 2) : Math.min(16, l.hopDiv * 2); if (nv !== l.hopDiv) { l.hopDiv = nv; host.paramsChanged(i, { spectrogram: true, render: true }); this.refreshParams(); } },
      dragPx: 24, tip: HELP.hop,
    });
    const ofsStep = new Stepper({
      label: "Offset", display: () => `${L().offset >= 0 ? "+" : "−"}${Math.abs(L().offset).toFixed(2)}`,
      derived: () => `s · ${(L().offset / 0.48).toFixed(2).replace("-", "−")} beat @ 125`,
      step: (d, fine) => { const l = L(); l.offset = Math.round((Math.min(10, Math.max(-10, l.offset + d * (fine ? 0.001 : 0.01)))) * 1000) / 1000; host.paramsChanged(i, { render: true }); this.refreshParams(); },
      dragPx: 4, tip: HELP.offset,
    });
    const pitchStep = new Stepper({
      label: "Pitch", display: () => `${L().pitch > 0 ? "+" : L().pitch < 0 ? "−" : ""}${Math.abs(L().pitch)} st`,
      derived: () => `Tape · ×${(2 ** (L().pitch / 12)).toFixed(3)}`,
      canStep: (d) => d > 0 ? L().pitch < 24 : L().pitch > -24,
      step: (d) => { const l = L(); l.pitch = Math.max(-24, Math.min(24, l.pitch + d)); host.paramsChanged(i, { spectrogram: true, render: true }); this.refreshParams(); },
      dragPx: 14, tip: HELP.pitch,
    });
    const fthrKnob = new Knob({
      label: "Fthr", aria: `Layer ${n} feather`, get: () => L().feather, reset: 0.537, format: featherLabel, tip: HELP.feather,
      set: (v) => { L().feather = v; host.paramsChanged(i, { render: true }); fthrMini.refresh(); },
    }, `fz-l${n}`);
    const params = h("div", { class: "params" }, winSeg.el, nStep.el, hStep.el, ofsStep.el, pitchStep.el, h("span", { class: "grow" }), fthrKnob.el);
    this.controls.push(fthrMini, winSeg, nStep, hStep, ofsStep, pitchStep, fthrKnob);

    this.el = h("section", { class: `module lm fz-l${n} mode-grid`, "aria-label": `Layer ${n}` }, ...screws(), head, body, chips, params);
    this.wirePointer();
    this.wireDrop();
    new ResizeObserver(() => this.positionBar()).observe(this.display);
    this.refresh();
  }

  // ---------------------------------------------------------------- placement and mode
  place(box: { x: number; y: number; w: number; h: number }, mode: Mode, delay: number, z: number): void {
    const st = this.el.style;
    st.left = `${box.x}px`; st.top = `${box.y}px`; st.width = `${box.w}px`; st.height = `${box.h}px`;
    st.transitionDelay = `${delay}ms`; st.zIndex = String(z);
    if (mode !== this.mode) {
      this.el.classList.remove(`mode-${this.mode}`); this.el.classList.add(`mode-${mode}`);
      this.mode = mode;
      const n = this.i + 1;
      this.focusB.replaceChildren(icon(mode === "editor" ? ICONS.grid : ICONS.focus));
      const lbl = mode === "editor" ? "Back to the 2×2 grid" : `Focus layer ${n}`;
      this.focusB.setAttribute("aria-label", lbl); this.focusB.title = lbl;
      this.drawShapes();
    }
  }

  // ---------------------------------------------------------------- refresh
  refresh(): void {
    const l = this.host.state(this.i);
    this.nameEl.textContent = l.loaded ? l.name : "Empty slot";
    this.nameEl.title = l.name;
    this.metaEl.textContent = l.loaded ? `${(SR / 1000).toFixed(1)} kHz · ${pitchedSeconds(l).toFixed(2)} s · ${l.channels > 1 ? "stereo" : "mono"}` : "";
    this.led.dataset.on = String(l.loaded);
    this.muteB.setAttribute("aria-pressed", String(l.mute));
    this.soloB.setAttribute("aria-pressed", String(l.solo));
    this.playB.disabled = !l.loaded;
    this.origB.disabled = !l.loaded;
    this.removeB.disabled = !l.loaded;
    this.origB.setAttribute("aria-pressed", String(this.host.isOriginal(this.i)));
    this.hint.textContent = l.loaded ? (l.shapes.length ? "" : "Draw on the spectrogram to select") : "Drop a sound here or press Load";
    this.hint.style.display = this.hint.textContent ? "" : "none";
    this.hint.dataset.kind = l.loaded ? "draw" : "drop";
    this.refreshParams();
    this.drawAxis();
    this.drawYAxis();
    this.drawShapes();
  }

  private yKey = "";
  private piano: Piano;
  private drawYAxis(): void {
    const a = getAxis(), labels = this.host.labels(), k = `${a.scale}:${a.fmin}:${a.fmax}:${labels}`;
    this.piano.setRoot(this.host.root());
    if (k === this.yKey) return;
    this.yKey = k;
    this.yax.replaceChildren(this.piano.el, ...ticks(labels).map(([lbl, f, major]) =>
      h("span", { class: `ro-sm ${major ? "major" : "minor"}`, style: `top:calc(${(freqToY(f) * 100).toFixed(2)}% - 6px)` }, lbl)));
    this.piano.draw();
  }
  /** Redraw the axis labels and the piano (new root, labels or axis). */
  refreshAxis(): void { this.drawYAxis(); }

  refreshParams(): void {
    const l = this.host.state(this.i);
    this.chipEls.win.textContent = WINDOW_LABELS[l.window];
    this.chipEls.n.textContent = String(l.N);
    this.chipEls.h.textContent = String(l.N / l.hopDiv);
    this.chipEls.ofs.textContent = `${l.offset >= 0 ? "+" : "−"}${Math.abs(l.offset).toFixed(2)} s`;
    this.chipEls.pitch.textContent = `${l.pitch > 0 ? "+" : l.pitch < 0 ? "−" : ""}${Math.abs(l.pitch)} st`;
    for (const c of this.controls) c.refresh();
  }

  private drawAxis(): void {
    const dur = this.duration();
    const step = dur > 30 ? 10 : dur > 12 ? 5 : dur > 5 ? 2 : dur > 2 ? 1 : 0.5;
    const spans: HTMLElement[] = [];
    for (let t = 0; t < dur - step * 0.3; t += step) spans.push(h("span", { class: "ro-sm", style: `left:${(t / dur * 100).toFixed(2)}%` }, `${+t.toFixed(1)} s`));
    this.xax.replaceChildren(...spans);
  }

  /** Play button state and the playhead over this layer's spectrogram (pos −1 hides it). */
  setPreviewing(on: boolean): void {
    this.playB.setAttribute("aria-pressed", String(on));
    this.playB.replaceChildren(icon(on ? ICONS.stop : ICONS.play));
    if (!on) this.setPlayhead(-1);
  }
  setPlayhead(pos: number): void {
    this.playhead.style.display = pos < 0 ? "none" : "block";
    if (pos >= 0) this.playhead.style.left = `${pos * 100}%`;
  }

  setSpectrogram(img: { data: Uint8Array; cols: number; rows: number }): void {
    this.img = img;
    paintSpectrogram(this.canvas, img, this.i + 1, this.host.look());
    this.hasImage = true;
  }

  /** Repaint with the current look (dB range and gain), without recomputing. */
  repaint(): void {
    if (this.img && this.hasImage) paintSpectrogram(this.canvas, this.img, this.i + 1, this.host.look());
  }

  clearSpectrogram(): void {
    if (!this.hasImage) return;
    this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.hasImage = false;
    this.img = null;
  }

  private duration(): number { const l = this.host.state(this.i); return l.loaded ? pitchedSeconds(l) : 4; }

  // ---------------------------------------------------------------- shapes
  private toX(t: number): number { return t / this.duration() * 1000; }
  private toY(f: number): number {
    const a = getAxis();
    return Math.min(1010, Math.max(-10, freqToY(a.scale === "log" ? Math.max(f, a.fmin * 0.5) : f) * 1000));
  }

  /** Bounding box of a shape in overlay units (0..1000). */
  private box(sh: Shape): { x0: number; y0: number; x1: number; y1: number } {
    if (sh.kind === "rect") return { x0: Math.max(-10, this.toX(sh.t[0])), x1: Math.min(1010, this.toX(sh.t[1])), y0: this.toY(sh.f[1]), y1: this.toY(sh.f[0]) };
    if (sh.kind === "harm") {
      const ks = harmonicNumbers(sh.f0, sh.count, sh.parity), top = (ks[ks.length - 1] ?? 1) * sh.f0, lo = (ks[0] ?? 1) * sh.f0, half = 2 ** (sh.width / 2);
      return { x0: Math.max(-10, this.toX(sh.t[0])), x1: Math.min(1010, this.toX(sh.t[1])), y0: this.toY(top * half), y1: this.toY(lo / half) };
    }
    const xs = sh.points.map((q) => this.toX(q[0])), ys = sh.points.map((q) => this.toY(q[1]));
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

  private pickedHere(): number {
    const p = this.host.picked();
    return p && p.layer === this.i && this.host.state(this.i).shapes[p.shape] ? p.shape : -1;
  }

  private fadeCache = new Map<string, string>();
  /** Grayscale picture of the fade envelope E over the shape's box (white = full level), exactly as the engine applies it. */
  private fadeImage(sh: Shape, b: { x0: number; y0: number; x1: number; y1: number }): string {
    const dur = this.duration(), k = `${JSON.stringify(sh)}|${dur}|${b.x0},${b.y0},${b.x1},${b.y1}`;
    const hit = this.fadeCache.get(k);
    if (hit) return hit;
    const cols = 192, rows = sh.kind === "poly" ? 72 : 1;
    const c = document.createElement("canvas"); c.width = cols; c.height = rows;
    const ctx = c.getContext("2d")!, img = ctx.createImageData(cols, rows);
    for (let r = 0; r < rows; r++) {
      const y = b.y0 + (r + 0.5) / rows * (b.y1 - b.y0);
      const iv = rowIntervals(sh, Math.log2(Math.max(yToFreq(y / 1000), F_FLOOR)));
      for (let q = 0; q < cols; q++) {
        const t = (b.x0 + (q + 0.5) / cols * (b.x1 - b.x0)) / 1000 * dur;
        const v = Math.round(255 * envelope(t, iv, sh.fadeIn ?? 0, sh.fadeOut ?? 0)), o = (r * cols + q) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const url = c.toDataURL();
    if (this.fadeCache.size > 48) this.fadeCache.clear();
    this.fadeCache.set(k, url);
    return url;
  }

  drawShapes(preview?: SVGElement): void {
    const l = this.host.state(this.i), pk = this.pickedHere();
    this.svg.replaceChildren();
    const defs = s("defs");
    this.svg.append(defs);
    l.shapes.forEach((sh, k) => {
      const cls = `sel${sh.mode === "subtract" ? " sub" : ""}${k === pk ? " picked" : ""}`;
      const geom = (): SVGElement => {
        if (sh.kind === "poly") return s("polygon", { class: cls, points: sh.points.map(([t, f]) => `${this.toX(t)},${this.toY(f)}`).join(" ") });
        if (sh.kind === "harm") return this.combGeom(sh, cls);
        const b = this.box(sh);
        return s("rect", { class: cls, x: b.x0, y: b.y0, width: Math.max(0, b.x1 - b.x0), height: Math.max(0, b.y1 - b.y0) });
      };
      if ((sh.fadeIn ?? 0) > 0 || (sh.fadeOut ?? 0) > 0) {
        // The fill follows the fade envelope; the outline stays solid so the shape is still easy to grab.
        const b = this.box(sh), id = `fz-fade-${this.i}-${k}`;
        const m = s("mask", { id, maskUnits: "userSpaceOnUse", x: -20, y: -20, width: 1040, height: 1040 });
        m.append(s("image", { href: this.fadeImage(sh, b), x: b.x0, y: b.y0, width: Math.max(0, b.x1 - b.x0), height: Math.max(0, b.y1 - b.y0), preserveAspectRatio: "none" }));
        defs.append(m);
        const fill = geom(), line = geom();
        fill.setAttribute("mask", `url(#${id})`); fill.style.stroke = "none";
        line.style.fill = "none"; line.style.pointerEvents = "none";
        this.svg.append(fill, line);
      } else this.svg.append(geom());
    });
    const sh = pk >= 0 ? l.shapes[pk] : undefined;
    if (sh?.kind === "poly" && this.mode !== "rail") {
      const b = this.box(sh);
      this.svg.append(s("rect", { class: "bbox", x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 }));
    }
    if (preview) this.svg.append(preview);
    this.drawHandles();
    this.drawBar();
  }

  /** A harmonic comb: one band per harmonic over its time span (bands thinner than 3 px are drawn 3 px). */
  private combGeom(sh: { t: [number, number]; f0: number; count: number; width: number; parity: Parity }, cls: string): SVGElement {
    const g = s("g", { class: "comb" }), half = 2 ** (sh.width / 2), H = this.display.clientHeight || 300, minH = 3000 / H;
    const x0 = Math.max(-10, this.toX(sh.t[0])), x1 = Math.min(1010, this.toX(sh.t[1]));
    for (const k of harmonicNumbers(sh.f0, sh.count, sh.parity)) {
      const f = k * sh.f0, a = this.toY(f * half), b = this.toY(f / half);
      if (b < -10 || a > 1010) continue;
      const hh = Math.max(minH, b - a), y = (a + b) / 2 - hh / 2;
      g.append(s("rect", { class: cls, x: x0, y, width: Math.max(0, x1 - x0), height: hh }));
    }
    return g;
  }

  /** Handles of the picked shape. A rectangle resizes freely from its 8 handles; a lasso scales
   *  proportionally from the 4 corners of its box, about the opposite corner. */
  private handleSpecs(sh: Shape): { x: number; y: number; cursor: string; round?: boolean; apply: (orig: Shape, p: [number, number]) => Shape }[] {
    const b = this.box(sh), xm = (b.x0 + b.x1) / 2, ym = (b.y0 + b.y1) / 2, dur = this.duration();
    if (sh.kind === "harm") {
      const yf = this.toY(harmonicNumbers(sh.f0, sh.count, sh.parity)[0] * sh.f0 || sh.f0);
      const end = (x: number, i: 0 | 1) => ({
        x, y: yf, cursor: "ew-resize",
        apply: (orig: Shape, p: [number, number]): Shape => {
          const r = JSON.parse(JSON.stringify(orig)) as HarmShape;
          r.t[i] = p[0] * dur;
          r.t.sort((a, c) => a - c);
          return r;
        },
      });
      return [end(b.x0, 0), end(b.x1, 1)];
    }
    if (sh.kind === "rect") {
      const spec = (x: number, y: number, cursor: string, tx: 0 | 1 | null, fy: 0 | 1 | null) => ({
        x, y, cursor,
        apply: (orig: Shape, p: [number, number]): Shape => {
          const r = JSON.parse(JSON.stringify(orig)) as RectShape;
          if (tx !== null) r.t[tx] = p[0] * dur;
          if (fy !== null) r.f[fy] = yToFreq(p[1]);
          r.t.sort((a, c) => a - c); r.f.sort((a, c) => a - c);
          return r;
        },
      });
      return [
        spec(b.x0, b.y0, "nwse-resize", 0, 1), spec(xm, b.y0, "ns-resize", null, 1), spec(b.x1, b.y0, "nesw-resize", 1, 1), spec(b.x1, ym, "ew-resize", 1, null),
        spec(b.x1, b.y1, "nwse-resize", 1, 0), spec(xm, b.y1, "ns-resize", null, 0), spec(b.x0, b.y1, "nesw-resize", 0, 0), spec(b.x0, ym, "ew-resize", 0, null),
      ];
    }
    const corner = (x: number, y: number, cursor: string, cx: 0 | 1, cy: 0 | 1) => ({
      x, y, cursor, round: true,
      apply: (orig: Shape, p: [number, number]): Shape => {
        const o = orig as PolyShape, uv = o.points.map(([t, f]) => [t / dur, freqToY(Math.max(f, 1e-6))]);
        const us = uv.map((q) => q[0]), vs = uv.map((q) => q[1]);
        const U = [Math.min(...us), Math.max(...us)], V = [Math.min(...vs), Math.max(...vs)];
        const a = [U[1 - cx], V[1 - cy]], c = [U[cx], V[cy]];
        const W = this.display.clientWidth || 1, H = this.display.clientHeight || 1;
        const ex = (c[0] - a[0]) * W, ey = (c[1] - a[1]) * H, len = ex * ex + ey * ey;
        const k = len > 0 ? Math.min(20, Math.max(0.05, ((p[0] - a[0]) * W * ex + (p[1] - a[1]) * H * ey) / len)) : 1;
        return { ...o, points: uv.map(([u, v]) => [(a[0] + k * (u - a[0])) * dur, yToFreq(a[1] + k * (v - a[1]))] as [number, number]) };
      },
    });
    return [corner(b.x0, b.y0, "nwse-resize", 0, 0), corner(b.x1, b.y0, "nesw-resize", 1, 0), corner(b.x1, b.y1, "nwse-resize", 1, 1), corner(b.x0, b.y1, "nesw-resize", 0, 1)];
  }

  private handleKey = "";
  private drawHandles(): void {
    const pk = this.pickedHere();
    const sh = pk >= 0 ? this.host.state(this.i).shapes[pk] : undefined;
    const old = () => this.handles.querySelectorAll<HTMLElement>(".hd");
    if (this.mode === "rail" || !sh) { old().forEach((e) => e.remove()); this.handleKey = ""; return; }
    const specs = this.handleSpecs(sh), k0 = `${pk}:${sh.kind}`;
    if (k0 === this.handleKey) {
      // Same handles: move them in place so a handle being dragged keeps its pointer capture.
      const els = old();
      specs.forEach((hp, k) => { els[k].style.left = `${hp.x / 10}%`; els[k].style.top = `${hp.y / 10}%`; });
      return;
    }
    this.handleKey = k0;
    old().forEach((e) => e.remove());
    specs.forEach((hp, k) => {
      const el = h("span", { class: `hd${hp.round ? " rd" : ""}`, style: `left:${hp.x / 10}%;top:${hp.y / 10}%;cursor:${hp.cursor}`, title: sh.kind === "poly" ? "Drag to scale (keeps proportions)" : "Drag to change the time span" });
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.stopPropagation(); e.preventDefault(); el.setPointerCapture(e.pointerId);
        const orig = JSON.parse(JSON.stringify(this.host.state(this.i).shapes[pk])) as Shape;
        let moved = false;
        const move = (ev: PointerEvent) => {
          if (!moved) { moved = true; this.host.editShapes(this.i, () => { }, { undo: true, render: false }); }
          const p = this.rel(ev);
          this.host.editShapes(this.i, (shapes) => { if (shapes[pk]) shapes[pk] = this.handleSpecs(orig)[k].apply(orig, p); }, { undo: false, render: false });
        };
        const up = () => {
          el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
          if (moved) this.host.editShapes(this.i, () => { }, { undo: false, render: true });
        };
        el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
      });
      this.handles.append(el);
    });
  }

  // ---------------------------------------------------------------- floating bar of the picked shape
  private bar: HTMLElement | null = null;
  private barKey = "";
  private barKnobs: MiniKnob[] = [];
  private barRefresh: { refresh(): void }[] = [];
  private combLabel: HTMLElement | null = null;
  private drawBar(): void {
    const pk = this.pickedHere();
    if (this.mode === "rail" || pk < 0) { this.bar?.remove(); this.bar = null; this.barKey = ""; return; }
    const shNow = this.host.state(this.i).shapes[pk];
    const kindKey = `${pk}:${shNow.kind}:${shNow.kind === "poly" && shNow.seed ? "wand" : ""}`;
    if (this.barKey !== kindKey || !this.bar) {
      this.bar?.remove();
      this.barKey = kindKey;
      const cur = () => this.host.state(this.i).shapes[pk];
      let gesture = false;
      const knob = (which: "fadeIn" | "fadeOut", label: string) => new MiniKnob({
        label, aria: `${label} of the selected area`, get: () => fadeToKnob(cur()?.[which] ?? 0), reset: 0, tip: HELP[which],
        format: (v) => fadeLabel(knobToFade(v)),
        set: (v) => {
          this.host.editShapes(this.i, (shapes) => { const t = shapes[pk]; if (t) t[which] = knobToFade(v); }, { undo: !gesture, render: true });
          gesture = true;
        },
      });
      this.barKnobs = [knob("fadeIn", "Fade in"), knob("fadeOut", "Fade out")];
      const extra: HTMLElement[] = [];
      const edit = (fn: (sh: Shape) => void) => {
        this.host.editShapes(this.i, (shapes) => { const t = shapes[pk]; if (t) fn(t); }, { undo: !gesture, render: true });
        gesture = true;
      };
      if (shNow.kind === "harm") {
        const comb = () => cur() as HarmShape;
        this.combLabel = h("span", { class: "ro-sm ink comblabel" });
        const count = new MiniKnob({
          label: "Harm", aria: "Number of harmonics", tip: HELP.harmCount, reset: 15 / 31,
          get: () => ((comb()?.count ?? 16) - 1) / 31, format: () => `${comb()?.count ?? 16}`,
          set: (v) => edit((t) => { (t as HarmShape).count = 1 + Math.round(v * 31); }),
        });
        const width = new MiniKnob({
          label: "Width", aria: "Width of each band", tip: HELP.harmWidth, reset: Math.log(4) / Math.log(24),
          get: () => Math.log((comb()?.width ?? 1 / 12) * 48) / Math.log(24), format: () => `${Math.round((comb()?.width ?? 1 / 12) * 1200)}¢`,
          set: (v) => edit((t) => { (t as HarmShape).width = (24 ** v) / 48; }),
        });
        const parity = new Segmented(null, (["all", "odd", "even"] as const).map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), title: HELP.harmParity })),
          () => comb()?.parity ?? "all", (id) => edit((t) => { (t as HarmShape).parity = id as Parity; }), "parity");
        this.barKnobs.unshift(count, width);
        this.barRefresh = [parity];
        extra.push(h("div", { class: "combinfo" }, this.combLabel, parity.el), count.el, width.el, h("span", { class: "vseam", "aria-hidden": "true" }));
      } else if (shNow.kind === "poly" && shNow.seed) {
        const poly = () => cur() as PolyShape;
        const tol = new MiniKnob({
          label: "Range", aria: "Magic wand tolerance", tip: HELP.wandTol, reset: (15 - 3) / 45,
          get: () => ((poly()?.seed?.tol ?? 15) - 3) / 45, format: () => `${Math.round(poly()?.seed?.tol ?? 15)} dB`,
          set: (v) => {
            const sd = poly()?.seed;
            if (!sd) return;
            const pts = this.wandPoints(sd.t, sd.f, 3 + v * 45);
            if (pts.length >= 3) edit((t) => { const q = t as PolyShape; q.points = pts; q.seed = { ...sd, tol: 3 + v * 45 }; });
          },
        });
        this.barKnobs.unshift(tol);
        this.barRefresh = [];
        extra.push(tol.el, h("span", { class: "vseam", "aria-hidden": "true" }));
      } else this.barRefresh = [];
      const del = key(null, ICONS.clear, { class: "sm", "aria-label": "Delete this selection", title: "Delete this selection (Del)" }, () => {
        this.host.setPicked(null);
        this.host.editShapes(this.i, (shapes) => { shapes.splice(pk, 1); });
      });
      this.bar = h("div", { class: "shapebar", role: "group", "aria-label": "Selected area" },
        ...extra, ...this.barKnobs.slice(-2).map((k) => k.el), h("span", { class: "vseam", "aria-hidden": "true" }), del);
      // One undo step per knob gesture (a drag, or each key press).
      this.bar.addEventListener("pointerdown", () => { gesture = false; }, true);
      this.bar.addEventListener("keydown", () => { gesture = false; }, true);
      this.handles.append(this.bar);
    } else { this.barKnobs.forEach((k) => k.refresh()); this.barRefresh.forEach((r) => r.refresh()); }
    if (shNow.kind === "harm" && this.combLabel) this.combLabel.textContent = `${noteOf(shNow.f0)} · ${shNow.f0 < 1000 ? shNow.f0.toFixed(1) : (shNow.f0 / 1000).toFixed(2) + "k"} Hz`;
    this.positionBar();
  }

  /** Above the box's right end; below it if there is no room; inside the top if neither fits. */
  private positionBar(): void {
    const pk = this.pickedHere();
    if (!this.bar || pk < 0) return;
    const b = this.box(this.host.state(this.i).shapes[pk]);
    const W = this.display.clientWidth, H = this.display.clientHeight, bw = this.bar.offsetWidth, bh = this.bar.offsetHeight;
    const x = Math.min(W - bw - 4, Math.max(4, b.x1 / 1000 * W - bw));
    let y = b.y0 / 1000 * H - bh - 10;
    if (y < 4) y = b.y1 / 1000 * H + 10;
    if (y + bh > H - 4) y = Math.max(4, b.y0 / 1000 * H + 12);
    this.bar.style.left = `${x}px`; this.bar.style.top = `${y}px`;
  }

  /** The fundamental under a click at height v (0..1): the loudest row within a semitone, over the span [a, b] (fractions of the sound). */
  private snapF0(v: number, a: number, b: number): number {
    const f = yToFreq(v), img = this.img;
    if (!img || !this.hasImage) return f;
    const reach = Math.abs(freqToY(f * 2 ** (1 / 12)) - freqToY(f)) * img.rows;
    const row = snapRow(img, v * img.rows, Math.max(1, reach), a * img.cols, b * img.cols);
    return yToFreq(row / img.rows);
  }

  /** The wand's outline around (t, f) as polygon points (seconds, Hz). */
  wandPoints(t: number, f: number, tolDb: number): [number, number][] {
    const img = this.img;
    if (!img || !this.hasImage) return [];
    const dur = this.duration();
    return wandRegion(img, t / dur * img.cols, freqToY(f) * img.rows, tolDb)
      .map(([x, y]) => [x / img.cols * dur, yToFreq(Math.min(1, Math.max(0, y / img.rows)))] as [number, number]);
  }

  private rel(e: PointerEvent): [number, number] {
    const r = this.svg.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  }
  private toTF(e: PointerEvent): [number, number] {
    const [u, v] = this.rel(e);
    return [u * this.duration(), yToFreq(v)];
  }

  private inside(sh: Shape, u: number, v: number): boolean {
    if (sh.kind === "rect") return u * 1000 >= this.toX(sh.t[0]) && u * 1000 <= this.toX(sh.t[1]) && v * 1000 >= this.toY(sh.f[1]) && v * 1000 <= this.toY(sh.f[0]);
    if (sh.kind === "harm") {
      if (u * 1000 < this.toX(sh.t[0]) || u * 1000 > this.toX(sh.t[1])) return false;
      const half = 2 ** (sh.width / 2), tol = 4000 / (this.display.clientHeight || 300);   // at least ±4 px
      return harmonicNumbers(sh.f0, sh.count, sh.parity).some((k) => {
        const a = this.toY(k * sh.f0 * half), b = this.toY(k * sh.f0 / half), m = (a + b) / 2;
        return Math.abs(v * 1000 - m) <= Math.max((b - a) / 2, tol);
      });
    }
    return inPoly(u * 1000, v * 1000, sh.points.map(([t, f]) => [this.toX(t), this.toY(f)]));
  }

  /** Shape under the point: the picked one first, then the topmost. */
  private hit(u: number, v: number): number {
    const shapes = this.host.state(this.i).shapes, pk = this.pickedHere();
    if (pk >= 0 && this.inside(shapes[pk], u, v)) return pk;
    for (let k = shapes.length - 1; k >= 0; k--) if (this.inside(shapes[k], u, v)) return k;
    return -1;
  }

  /** Pointer gestures on the display:
   *  - drag on empty space (or on a shape that is not picked) draws with the current tool;
   *  - click on a shape picks it (handles + fade/delete bar); click on empty space drops it;
   *  - drag on the picked shape moves it (with the Move tool, any shape). */
  private wirePointer(): void {
    let act: "none" | "draw" | "move" = "none", start: [number, number] = [0, 0], last: [number, number] = [0, 0];
    let lasso: [number, number][] = [], subtract = false, target = -1, dragged = false, snapped = false;
    const n = this.i + 1;
    this.svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.host.ensureAudio();
      if (this.mode === "rail") { this.host.focus(n); return; }
      if (!this.host.state(this.i).loaded) { if (!this.host.pickFile(this.i)) this.fileInput.click(); return; }
      this.svg.setPointerCapture(e.pointerId);
      const tool = this.host.tool(), p = this.rel(e), pk = this.pickedHere();
      start = p; last = p; dragged = false; snapped = false;
      target = this.hit(p[0], p[1]);
      if (target >= 0 && (tool === "move" || target === pk)) {
        act = "move";
        if (target !== pk) this.host.setPicked({ layer: this.i, shape: target });
      } else if (tool === "move") {
        act = "none";
        this.host.setPicked(null);
      } else {
        act = "draw";
        subtract = tool === "erase" || e.altKey;
        lasso = tool === "lasso" ? [p] : [];
      }
    });
    this.svg.addEventListener("pointermove", (e) => {
      const [t, f] = this.toTF(e);
      if (this.mode === "editor") this.cursor.textContent = `${t.toFixed(3)} s · ${f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : f.toFixed(0) + " Hz"} · ${noteOf(f)}`;
      if (act === "none" || !this.svg.hasPointerCapture(e.pointerId)) return;
      const p = this.rel(e), r = this.svg.getBoundingClientRect(), tool = this.host.tool();
      if (!dragged && Math.hypot((p[0] - start[0]) * r.width, (p[1] - start[1]) * r.height) < 3) return;
      dragged = true;
      if (act === "move") {
        if (!snapped) { snapped = true; this.host.editShapes(this.i, () => { }, { undo: true, render: false }); }
        const du = p[0] - last[0], dv = p[1] - last[1], dt = du * this.duration();
        const shift = (f: number) => (f <= 0 ? f : Math.max(1, yToFreq(freqToY(f) + dv)));  // follows the display axis
        last = p;
        this.host.editShapes(this.i, (shapes) => {
          const sh = shapes[target];
          if (!sh) return;
          if (sh.kind === "rect") { sh.t = [sh.t[0] + dt, sh.t[1] + dt]; sh.f = [shift(sh.f[0]), shift(sh.f[1])]; }
          else if (sh.kind === "harm") { sh.t = [sh.t[0] + dt, sh.t[1] + dt]; sh.f0 = shift(sh.f0); }
          else { sh.points = sh.points.map(([t0, f0]) => [t0 + dt, shift(f0)]); if (sh.seed) sh.seed = { ...sh.seed, t: sh.seed.t + dt, f: shift(sh.seed.f) }; }
        }, { undo: false, render: false });
      } else if (tool === "rect" || tool === "erase") {
        const x = Math.min(start[0], p[0]) * 1000, y = Math.min(start[1], p[1]) * 1000;
        this.drawShapes(s("rect", { class: "preview", x, y, width: Math.abs(p[0] - start[0]) * 1000, height: Math.abs(p[1] - start[1]) * 1000 }));
      } else if (tool === "harm") {
        const dur = this.duration(), f0 = yToFreq(start[1]);
        const pv = this.combGeom({ t: [Math.min(start[0], p[0]) * dur, Math.max(start[0], p[0]) * dur], f0, count: 16, width: 1 / 12, parity: "all" }, "preview");
        this.drawShapes(pv);
      } else if (tool === "lasso") {
        const prev = lasso[lasso.length - 1];
        if (Math.hypot((p[0] - prev[0]) * r.width, (p[1] - prev[1]) * r.height) > 3) lasso.push(p);
        this.drawShapes(s("polyline", { class: "preview", points: lasso.map(([u, v]) => `${u * 1000},${v * 1000}`).join(" ") }));
      }
    });
    const finish = (e: PointerEvent) => {
      if (act === "none") return;
      const tool = this.host.tool(), p = this.rel(e), r = this.svg.getBoundingClientRect(), dur = this.duration();
      // the wand acts on every click (even over another selection); the comb on a drag, or a click on empty space
      const creates = tool === "wand" ? !dragged : dragged || target < 0;
      if (act === "draw" && (tool === "harm" || tool === "wand") && creates) {
        // harmonic comb: drag = its time span (a click: the whole sound); the fundamental snaps to
        // the loudest partial within a semitone. Wand: a click selects the area around it.
        const mode = subtract ? "subtract" : "add";
        let sh: Shape | null = null;
        if (tool === "harm") {
          const a = dragged ? Math.min(start[0], p[0]) : 0, b = dragged ? Math.max(start[0], p[0]) : 1;
          sh = { kind: "harm", mode, t: [a * dur, b * dur], f0: this.snapF0(start[1], a, b), count: 16, width: 1 / 12, parity: "all" };
        } else {
          const t = start[0] * dur, f = yToFreq(start[1]), pts = this.wandPoints(t, f, 15);
          if (pts.length >= 3) sh = { kind: "poly", mode, points: pts, seed: { t, f, tol: 15 } };
          else this.host.toast("Nothing to select there: click on something you can see in the spectrogram");
        }
        if (sh) {
          const add = sh;
          this.host.editShapes(this.i, (shapes) => { shapes.push(add); });
          this.host.setPicked({ layer: this.i, shape: this.host.state(this.i).shapes.length - 1 });
        }
      } else if (act === "draw") {
        if (!dragged) this.host.setPicked(target >= 0 ? { layer: this.i, shape: target } : null);
        else if ((tool === "rect" || tool === "erase") && Math.abs(p[0] - start[0]) * r.width > 4 && Math.abs(p[1] - start[1]) * r.height > 4) {
          const sh: Shape = { kind: "rect", mode: subtract ? "subtract" : "add", t: [Math.min(start[0], p[0]) * dur, Math.max(start[0], p[0]) * dur], f: [yToFreq(Math.max(start[1], p[1])), yToFreq(Math.min(start[1], p[1]))] };
          this.host.setPicked(null);
          this.host.editShapes(this.i, (shapes) => { shapes.push(sh); });
        } else if (tool === "lasso" && lasso.length >= 3) {
          const px = simplify(lasso.map(([u, v]) => [u * r.width, v * r.height] as [number, number]), 1.5);
          if (px.length >= 3) {
            const sh: Shape = { kind: "poly", mode: subtract ? "subtract" : "add", points: px.map(([x, y]) => [x / r.width * dur, yToFreq(y / r.height)] as [number, number]) };
            this.host.setPicked(null);
            this.host.editShapes(this.i, (shapes) => { shapes.push(sh); });
          }
        }
      } else if (act === "move" && dragged) this.host.editShapes(this.i, () => { }, { undo: false, render: true });
      act = "none"; lasso = [];
      this.drawShapes();
    };
    this.svg.addEventListener("pointerup", finish);
    this.svg.addEventListener("pointercancel", () => { act = "none"; lasso = []; this.drawShapes(); });
    this.svg.addEventListener("pointerleave", () => { this.cursor.textContent = ""; });
  }

  private wireDrop(): void {
    this.el.addEventListener("dragover", (e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); this.el.classList.add("drop"); } });
    this.el.addEventListener("dragleave", () => this.el.classList.remove("drop"));
    this.el.addEventListener("drop", (e) => {
      e.preventDefault(); this.el.classList.remove("drop");
      const f = e.dataTransfer?.files?.[0];
      if (f) { this.host.ensureAudio(); this.host.load(this.i, f); }
    });
  }
}

// One layer module. The same element is the 2×2 grid cell, the large editor and a rail card:
// only its box and mode class change, so CSS can animate the morph between them.

import { h, icon, s, ICONS, screws } from "./dom.ts";
import { Knob, MiniKnob, Segmented, Stepper, key } from "./controls.ts";
import { freqToY, yToFreq, F_MIN, F_MAX } from "../dsp/spectrogram.ts";
import { makeWindow, WINDOW_NAMES, type WindowName } from "../dsp/windows.ts";
import type { Shape } from "../dsp/mask.ts";
import { SR, WINDOW_LABELS, featherLabel, pitchedSeconds, type LayerState, type Tool } from "../model.ts";

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
  pickFile(i: number): void;
  capture(i: number): void;
  toggleMute(i: number): void;
  toggleSolo(i: number): void;
  picked(): { layer: number; shape: number } | null;
  setPicked(p: { layer: number; shape: number } | null): void;
  ensureAudio(): void;
}

const TICKS: [string, number, boolean][] = [
  ["10k", 10000, true], ["5k", 5000, false], ["2k", 2000, false], ["1k", 1000, true],
  ["500", 500, false], ["200", 200, false], ["100", 100, true], ["50", 50, false],
];

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

/** Paint a spectrogram image (0–255 values) into a canvas with a layer colormap. */
export function paintSpectrogram(canvas: HTMLCanvasElement, img: { data: Uint8Array; cols: number; rows: number }, layer: number): void {
  canvas.width = img.cols; canvas.height = img.rows;
  const ctx = canvas.getContext("2d")!, out = ctx.createImageData(img.cols, img.rows), t = lut(layer);
  for (let i = 0; i < img.data.length; i++) {
    const v = img.data[i] * 3;
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
  private focusB: HTMLButtonElement;
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
    this.muteB = key("M", null, { class: "sm", "aria-label": `Mute layer ${n}`, "aria-pressed": "false" }, () => host.toggleMute(i));
    this.soloB = key("S", null, { class: "sm", "aria-label": `Solo layer ${n}`, "aria-pressed": "false" }, () => host.toggleSolo(i));
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
        key(null, ICONS.load, { class: "sm", "aria-label": `Load a sound into layer ${n}`, title: "Load a sound (or drop a file here)" }, () => { host.ensureAudio(); this.fileInput.click(); }),
        key(null, ICONS.rec, { class: "sm", "aria-label": "Capture from the mixer", title: "Capture from the mixer" }, () => host.capture(i))),
      this.muteB, this.soloB, this.focusB, this.fileInput);

    // display
    const yax = h("div", { class: "yax", "aria-hidden": "true" },
      ...TICKS.map(([lbl, f, major]) => h("span", { class: `ro-sm ${major ? "major" : "minor"}`, style: `top:calc(${(freqToY(f) * 100).toFixed(2)}% - 6px)` }, lbl)));
    this.canvas = h("canvas", { class: "spec" });
    this.svg = s("svg", { class: "ov", viewBox: "0 0 1000 1000", preserveAspectRatio: "none", role: "img", "aria-label": `Layer ${n} spectrogram and selections` });
    this.handles = h("div", { style: "position:absolute;inset:0;pointer-events:none" });
    this.cursor = h("span", { class: "cursor-ro ro-sm ink" });
    this.hint = h("div", { class: "empty-hint silk" });
    this.display = h("div", { class: "display" }, this.canvas, this.svg, this.handles, this.hint, this.cursor);
    this.xax = h("div", { class: "xax", "aria-hidden": "true" });
    const body = h("div", { class: "lbody" }, yax, this.display, this.xax);

    // grid-mode chips (click → focus)
    const chip = (k: string, label: string) => {
      const v = h("span", { class: "ro" });
      this.chipEls[k] = v;
      const c = h("button", { class: "chip", type: "button", title: "Edit in the focus view" }, h("span", { class: "silk sm" }, label), v);
      c.addEventListener("click", () => host.focus(n));
      return c;
    };
    const fthrMini = new MiniKnob({
      label: "Fthr", aria: `Layer ${n} feather`, get: () => L().feather, reset: 0.537, format: featherLabel,
      set: (v) => { L().feather = v; host.paramsChanged(i, { render: true }); this.refreshParams(); },
    });
    const chips = h("div", { class: "chips" }, chip("win", "Win"), chip("n", "N"), chip("h", "H"), chip("ofs", "Ofs"), chip("pitch", "Pitch"), h("span", { class: "grow" }), fthrMini.el);

    // editor-mode parameters
    const winSeg = new Segmented("Window", WINDOW_NAMES.map((w) => ({ id: w, label: WINDOW_LABELS[w], icon: windowIcon(w) })), () => L().window,
      (id) => { L().window = id as WindowName; host.paramsChanged(i, { spectrogram: true, render: true }); this.refreshParams(); }, "win");
    const nStep = new Stepper({
      label: "FFT size N", display: () => String(L().N),
      derived: () => `${(L().N / SR * 1000).toFixed(1)} ms · Δf ${(SR / L().N).toFixed(1)} Hz`,
      canStep: (d) => d > 0 ? L().N < 16384 : L().N > 256,
      step: (d) => { const l = L(); const nv = d > 0 ? Math.min(16384, l.N * 2) : Math.max(256, l.N / 2); if (nv !== l.N) { l.N = nv; host.paramsChanged(i, { spectrogram: true, render: true }); this.refreshParams(); } },
      dragPx: 24,
    });
    const hStep = new Stepper({
      label: "Hop H", display: () => String(L().N / L().hopDiv),
      derived: () => `${(L().N / L().hopDiv / SR * 1000).toFixed(1)} ms · ${Math.round(100 - 100 / L().hopDiv)}% overlap`,
      canStep: (d) => d > 0 ? L().hopDiv > 2 : L().hopDiv < 16,
      step: (d) => { const l = L(); const nv = d > 0 ? Math.max(2, l.hopDiv / 2) : Math.min(16, l.hopDiv * 2); if (nv !== l.hopDiv) { l.hopDiv = nv; host.paramsChanged(i, { spectrogram: true, render: true }); this.refreshParams(); } },
      dragPx: 24,
    });
    const ofsStep = new Stepper({
      label: "Offset", display: () => `${L().offset >= 0 ? "+" : "−"}${Math.abs(L().offset).toFixed(2)}`,
      derived: () => `s · ${(L().offset / 0.48).toFixed(2).replace("-", "−")} beat @ 125`,
      step: (d, fine) => { const l = L(); l.offset = Math.round((Math.min(10, Math.max(-10, l.offset + d * (fine ? 0.001 : 0.01)))) * 1000) / 1000; host.paramsChanged(i, { render: true }); this.refreshParams(); },
      dragPx: 4,
    });
    const pitchStep = new Stepper({
      label: "Pitch", display: () => `${L().pitch > 0 ? "+" : L().pitch < 0 ? "−" : ""}${Math.abs(L().pitch)} st`,
      derived: () => `Tape · ×${(2 ** (L().pitch / 12)).toFixed(3)}`,
      canStep: (d) => d > 0 ? L().pitch < 24 : L().pitch > -24,
      step: (d) => { const l = L(); l.pitch = Math.max(-24, Math.min(24, l.pitch + d)); host.paramsChanged(i, { spectrogram: true, render: true }); this.refreshParams(); },
      dragPx: 14,
    });
    const fthrKnob = new Knob({
      label: "Fthr", aria: `Layer ${n} feather`, get: () => L().feather, reset: 0.537, format: featherLabel,
      set: (v) => { L().feather = v; host.paramsChanged(i, { render: true }); fthrMini.refresh(); },
    }, `fz-l${n}`);
    const params = h("div", { class: "params" }, winSeg.el, nStep.el, hStep.el, ofsStep.el, pitchStep.el, h("span", { class: "grow" }), fthrKnob.el);
    this.controls.push(fthrMini, winSeg, nStep, hStep, ofsStep, pitchStep, fthrKnob);

    this.el = h("section", { class: `module lm fz-l${n} mode-grid`, "aria-label": `Layer ${n}` }, ...screws(), head, body, chips, params);
    this.wirePointer();
    this.wireDrop();
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
    this.hint.textContent = l.loaded ? (l.shapes.length ? "" : "Draw on the spectrogram to select") : "Drop a sound here or press Load";
    this.hint.style.display = this.hint.textContent ? "" : "none";
    this.refreshParams();
    this.drawAxis();
    this.drawShapes();
  }

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

  setSpectrogram(img: { data: Uint8Array; cols: number; rows: number }): void {
    paintSpectrogram(this.canvas, img, this.i + 1);
    this.hasImage = true;
  }

  clearSpectrogram(): void {
    if (!this.hasImage) return;
    this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.hasImage = false;
  }

  private duration(): number { const l = this.host.state(this.i); return l.loaded ? pitchedSeconds(l) : 4; }

  // ---------------------------------------------------------------- shapes
  private toX(t: number): number { return t / this.duration() * 1000; }
  private toY(f: number): number { return Math.min(1010, Math.max(-10, freqToY(Math.max(f, F_MIN * 0.5)) * 1000)); }

  drawShapes(preview?: SVGElement): void {
    const l = this.host.state(this.i), picked = this.host.picked();
    this.svg.replaceChildren();
    l.shapes.forEach((sh, k) => {
      const isPicked = !!picked && picked.layer === this.i && picked.shape === k;
      const cls = `sel${sh.mode === "subtract" ? " sub" : ""}${isPicked ? " picked" : ""}`;
      if (sh.kind === "rect") {
        const x0 = Math.max(-10, this.toX(sh.t[0])), x1 = Math.min(1010, this.toX(sh.t[1]));
        const y0 = this.toY(sh.f[1]), y1 = this.toY(sh.f[0]);
        this.svg.append(s("rect", { class: cls, x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }));
      } else {
        this.svg.append(s("polygon", { class: cls, points: sh.points.map(([t, f]) => `${this.toX(t)},${this.toY(f)}`).join(" ") }));
      }
    });
    if (preview) this.svg.append(preview);
    this.drawHandles();
  }

  private handlePoints(sh: Shape): { x: number; y: number; set: (t: number, f: number) => void }[] {
    if (sh.kind === "poly") return sh.points.map((p) => ({ x: this.toX(p[0]) / 10, y: this.toY(p[1]) / 10, set: (t: number, f: number) => { p[0] = t; p[1] = f; } }));
    const r = sh;
    return [
      { x: this.toX(r.t[0]) / 10, y: this.toY(r.f[1]) / 10, set: (t: number, f: number) => { r.t[0] = t; r.f[1] = f; } },
      { x: this.toX(r.t[1]) / 10, y: this.toY(r.f[1]) / 10, set: (t: number, f: number) => { r.t[1] = t; r.f[1] = f; } },
      { x: this.toX(r.t[0]) / 10, y: this.toY(r.f[0]) / 10, set: (t: number, f: number) => { r.t[0] = t; r.f[0] = f; } },
      { x: this.toX(r.t[1]) / 10, y: this.toY(r.f[0]) / 10, set: (t: number, f: number) => { r.t[1] = t; r.f[0] = f; } },
    ];
  }

  private handleKey = "";
  private drawHandles(): void {
    const picked = this.host.picked();
    const sh = picked && picked.layer === this.i ? this.host.state(this.i).shapes[picked.shape] : undefined;
    if (this.mode !== "editor" || !picked || !sh || this.host.tool() !== "move") { this.handles.replaceChildren(); this.handleKey = ""; return; }
    const pts = this.handlePoints(sh), k0 = `${picked.shape}:${pts.length}`;
    if (k0 === this.handleKey) {
      // Same handles: move them in place so a handle being dragged keeps its pointer capture.
      pts.forEach((hp, k) => { const el = this.handles.children[k] as HTMLElement; el.style.left = `${hp.x}%`; el.style.top = `${hp.y}%`; });
      return;
    }
    this.handleKey = k0;
    this.handles.replaceChildren();
    pts.forEach((hp, k) => {
      const el = h("span", { class: "hd", style: `left:${hp.x}%;top:${hp.y}%;pointer-events:auto`, title: "Drag to reshape" });
      el.addEventListener("pointerdown", (e) => {
        e.stopPropagation(); el.setPointerCapture(e.pointerId);
        this.host.editShapes(this.i, () => { }, { undo: true, render: false });
        const move = (ev: PointerEvent) => {
          const [t, f] = this.toTF(ev);
          this.host.editShapes(this.i, (shapes) => {
            const target = shapes[picked.shape];
            if (target) this.handlePoints(target)[k].set(t, f);
          }, { undo: false, render: false });
        };
        const up = () => {
          el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up);
          this.host.editShapes(this.i, (shapes) => {
            const r = shapes[picked.shape];
            if (r && r.kind === "rect") { r.t.sort((a, b) => a - b); r.f.sort((a, b) => a - b); }
          }, { undo: false, render: true });
        };
        el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
      });
      this.handles.append(el);
    });
  }

  private rel(e: PointerEvent): [number, number] {
    const r = this.svg.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  }
  private toTF(e: PointerEvent): [number, number] {
    const [u, v] = this.rel(e);
    return [u * this.duration(), yToFreq(v)];
  }

  private hit(u: number, v: number): number {
    const shapes = this.host.state(this.i).shapes;
    for (let k = shapes.length - 1; k >= 0; k--) {
      const sh = shapes[k];
      if (sh.kind === "rect") {
        if (u * 1000 >= this.toX(sh.t[0]) && u * 1000 <= this.toX(sh.t[1]) && v * 1000 >= this.toY(sh.f[1]) && v * 1000 <= this.toY(sh.f[0])) return k;
      } else if (inPoly(u * 1000, v * 1000, sh.points.map(([t, f]) => [this.toX(t), this.toY(f)]))) return k;
    }
    return -1;
  }

  private wirePointer(): void {
    let start: [number, number] | null = null, lasso: [number, number][] = [], subtract = false, moving = -1, last: [number, number] = [0, 0], dragged = false;
    const n = this.i + 1;
    this.svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.host.ensureAudio();
      if (this.mode === "rail") { this.host.focus(n); return; }
      if (!this.host.state(this.i).loaded) { this.fileInput.click(); return; }
      this.svg.setPointerCapture(e.pointerId);
      const tool = this.host.tool(), p = this.rel(e);
      start = p; last = p; dragged = false;
      subtract = tool === "erase" || e.altKey;
      if (tool === "lasso") lasso = [p];
      if (tool === "move") {
        moving = this.hit(p[0], p[1]);
        this.host.setPicked(moving >= 0 ? { layer: this.i, shape: moving } : null);
        if (moving >= 0) this.host.editShapes(this.i, () => { }, { undo: true, render: false });
      }
    });
    this.svg.addEventListener("pointermove", (e) => {
      const [t, f] = this.toTF(e);
      if (this.mode === "editor") this.cursor.textContent = `${t.toFixed(3)} s · ${f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : f.toFixed(0) + " Hz"}`;
      if (!start || !this.svg.hasPointerCapture(e.pointerId)) return;
      const p = this.rel(e), tool = this.host.tool();
      dragged = true;
      if (tool === "rect" || tool === "erase") {
        const x = Math.min(start[0], p[0]) * 1000, y = Math.min(start[1], p[1]) * 1000;
        this.drawShapes(s("rect", { class: subtract ? "preview" : "preview", x, y, width: Math.abs(p[0] - start[0]) * 1000, height: Math.abs(p[1] - start[1]) * 1000 }));
      } else if (tool === "lasso") {
        const r = this.svg.getBoundingClientRect(), prev = lasso[lasso.length - 1];
        if (Math.hypot((p[0] - prev[0]) * r.width, (p[1] - prev[1]) * r.height) > 3) lasso.push(p);
        this.drawShapes(s("polyline", { class: "preview", points: lasso.map(([u, v]) => `${u * 1000},${v * 1000}`).join(" ") }));
      } else if (tool === "move" && moving >= 0) {
        const du = p[0] - last[0], dv = p[1] - last[1], dt = du * this.duration(), k = (F_MAX / F_MIN) ** (-dv);
        last = p;
        this.host.editShapes(this.i, (shapes) => {
          const sh = shapes[moving];
          if (!sh) return;
          if (sh.kind === "rect") { sh.t = [sh.t[0] + dt, sh.t[1] + dt]; sh.f = [sh.f[0] * k, sh.f[1] * k]; }
          else sh.points = sh.points.map(([t0, f0]) => [t0 + dt, f0 * k]);
        }, { undo: false, render: false });
      }
    });
    const finish = (e: PointerEvent) => {
      if (!start) return;
      const tool = this.host.tool(), p = this.rel(e), r = this.svg.getBoundingClientRect(), dur = this.duration();
      if ((tool === "rect" || tool === "erase") && Math.abs(p[0] - start[0]) * r.width > 4 && Math.abs(p[1] - start[1]) * r.height > 4) {
        const sh: Shape = { kind: "rect", mode: subtract ? "subtract" : "add", t: [Math.min(start[0], p[0]) * dur, Math.max(start[0], p[0]) * dur], f: [yToFreq(Math.max(start[1], p[1])), yToFreq(Math.min(start[1], p[1]))] };
        this.host.editShapes(this.i, (shapes) => { shapes.push(sh); });
      } else if (tool === "lasso" && lasso.length >= 3) {
        const px = simplify(lasso.map(([u, v]) => [u * r.width, v * r.height] as [number, number]), 1.5);
        if (px.length >= 3) {
          const sh: Shape = { kind: "poly", mode: subtract ? "subtract" : "add", points: px.map(([x, y]) => [x / r.width * dur, yToFreq(y / r.height)] as [number, number]) };
          this.host.editShapes(this.i, (shapes) => { shapes.push(sh); });
        }
      } else if (tool === "move" && moving >= 0) {
        this.host.editShapes(this.i, () => { }, { undo: false, render: dragged });
      }
      start = null; lasso = []; moving = -1;
      this.drawShapes();
    };
    this.svg.addEventListener("pointerup", finish);
    this.svg.addEventListener("pointercancel", () => { start = null; lasso = []; moving = -1; this.drawShapes(); });
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

// The result's analysis view: the result spectrogram at screen resolution with a choice of FFT
// size, zoom and pan in time, a piano on the frequency axis, the waveform underneath and a
// spectrum slice on the right (the spectrum under the cursor, or the loudest of the view), with a
// readout of time, frequency, note and level. Nothing here edits the sound.

import { freqToY, yToFreq, getAxis, type Analysis, type AnalysisRequest, type Look } from "../dsp/spectrogram.ts";
import { h, ICONS, screws } from "./dom.ts";
import { Segmented, key } from "./controls.ts";
import { Piano, noteOf } from "./piano.ts";
import { paintSpectrogram, ticks } from "./layer.ts";
import { HELP } from "./help.ts";

export interface AnalysisHost {
  analyze(req: AnalysisRequest): Promise<Analysis | null>;
  duration(): number;          // the result's length in seconds (0 without a result)
  look(): Look;
  labels(): "hz" | "notes";
  root(): number;
  close(): void;
}

const SIZES = [1024, 2048, 4096, 8192];
const MIN_SPAN = 0.02;

export class AnalysisView {
  readonly el: HTMLElement;
  private t0 = 0;
  private t1 = 1;
  private n = 4096;
  private data: Analysis | null = null;
  private painted = document.createElement("canvas");   // the colored image of `data`
  private spec: HTMLCanvasElement;
  private wave: HTMLCanvasElement;
  private slice: HTMLCanvasElement;
  private yax: HTMLElement;
  private xax: HTMLElement;
  private piano = new Piano();
  private readout: HTMLElement;
  private sliceTitle: HTMLElement;
  private playhead: HTMLElement;
  private cross: HTMLElement;
  private empty: HTMLElement;
  private hover: { x: number; y: number } | null = null;   // fractions of the spectrogram area
  private ticket = 0;
  private timer = 0;
  private openState = false;

  private host: AnalysisHost;

  constructor(host: AnalysisHost) {
    this.host = host;
    const res = new Segmented("FFT", SIZES.map((s) => ({ id: String(s), label: String(s), title: HELP.analysisFft })),
      () => String(this.n), (id) => { this.n = +id; this.request(0); });
    res.el.classList.add("ana-fft");
    this.readout = h("span", { class: "ro-sm ink ana-read" });
    const fit = key("Fit", null, { class: "sm", title: "Show the whole result (or double-click the spectrogram)" }, () => this.fit());
    const close = key(null, ICONS.grid, { class: "sm", "aria-label": "Close the analysis", title: "Back to the layers (Esc)" }, () => this.host.close());
    const head = h("div", { class: "ana-head" },
      h("span", { class: "num", style: "background:var(--ink);color:var(--on-ink)" }, "R"),
      h("span", { class: "lname" }, "Result"), h("span", { class: "silk" }, "Analysis"),
      h("span", { class: "grow" }), this.readout, res.el, fit, close);

    this.spec = h("canvas", { class: "ana-spec" });
    this.playhead = h("span", { class: "playhead" });
    this.cross = h("span", { class: "ana-cross" });
    this.empty = h("div", { class: "empty-hint silk" }, "Nothing rendered yet");
    const specBox = h("div", { class: "ana-specbox", title: "Wheel: zoom in time · drag: move · double-click: fit" }, this.spec, this.cross, this.playhead, this.empty);
    this.yax = h("div", { class: "yax ana-yax", "aria-hidden": "true" });
    this.sliceTitle = h("span", { class: "ro-sm" });
    this.slice = h("canvas", { class: "ana-slice" });
    this.wave = h("canvas", { class: "ana-wave" });
    this.xax = h("div", { class: "xax ana-xax", "aria-hidden": "true" });
    const body = h("div", { class: "ana-body" },
      this.yax, specBox, h("div", { class: "ana-slicebox" }, this.slice, this.sliceTitle),
      h("span", { class: "silk ana-wlabel" }, "Wave"), this.wave, h("span"),
      h("span"), this.xax, h("span"));
    this.el = h("section", { class: "module analysis fz-l0", "aria-label": "Result analysis", hidden: true }, ...screws(), head, body);

    // zoom (wheel) and pan (drag) in time, on the spectrogram and the waveform
    for (const area of [specBox, this.wave] as HTMLElement[]) {
      area.addEventListener("wheel", (e) => {
        e.preventDefault();
        const r = area.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, at = this.t0 + fx * (this.t1 - this.t0);
        this.zoom(at, Math.exp(e.deltaY * 0.0015));
      }, { passive: false });
      area.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        area.setPointerCapture(e.pointerId);
        const r = area.getBoundingClientRect(), x0 = e.clientX, a = this.t0, b = this.t1;
        const move = (m: PointerEvent) => this.setView(a - (m.clientX - x0) / r.width * (b - a), b - (m.clientX - x0) / r.width * (b - a));
        const up = () => { area.removeEventListener("pointermove", move); area.removeEventListener("pointerup", up); };
        area.addEventListener("pointermove", move);
        area.addEventListener("pointerup", up);
      });
      area.addEventListener("dblclick", () => this.fit());
    }
    specBox.addEventListener("pointermove", (e) => {
      const r = specBox.getBoundingClientRect();
      this.hover = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      this.drawOverlay();
    });
    specBox.addEventListener("pointerleave", () => { this.hover = null; this.drawOverlay(); });
    new ResizeObserver(() => { if (this.openState) { this.draw(); this.request(); } }).observe(specBox);
  }

  get isOpen(): boolean { return this.openState; }

  open(): void {
    this.openState = true;
    this.el.hidden = false;
    this.fit();
  }

  close(): void { this.openState = false; this.el.hidden = true; }

  /** New result, axis or labels: request again (keeps the zoom when it still fits). */
  refresh(): void {
    if (!this.openState) return;
    const dur = this.host.duration();
    if (this.t1 > dur || this.t1 - this.t0 < MIN_SPAN) { this.t0 = 0; this.t1 = Math.max(dur, MIN_SPAN); }
    this.drawAxes();
    this.request(0);
  }

  /** Labels or root changed: only the axes. */
  refreshAxes(): void { if (this.openState) this.drawAxes(); }

  /** Range and gain changed: only the colors. */
  repaint(): void {
    if (!this.openState || !this.data) return;
    paintSpectrogram(this.painted, this.data.image, 0, this.host.look());
    this.draw();
  }

  setPlayhead(frac: number): void {
    const dur = this.host.duration(), t = frac * dur;
    if (!this.openState || frac < 0 || t < this.t0 || t > this.t1) { this.playhead.style.display = "none"; return; }
    this.playhead.style.display = "block";
    this.playhead.style.left = `${((t - this.t0) / (this.t1 - this.t0)) * 100}%`;
  }

  // ------------------------------------------------------------------ view range
  private fit(): void { this.setView(0, Math.max(this.host.duration(), MIN_SPAN)); }

  private zoom(at: number, factor: number): void {
    const span = Math.max(MIN_SPAN, Math.min(this.host.duration() || 1, (this.t1 - this.t0) * factor));
    const f = (at - this.t0) / (this.t1 - this.t0);
    this.setView(at - f * span, at - f * span + span);
  }

  private setView(a: number, b: number): void {
    const dur = Math.max(this.host.duration(), MIN_SPAN), span = Math.min(b - a, dur);
    a = Math.max(0, Math.min(a, dur - span));
    this.t0 = a; this.t1 = a + span;
    this.draw();
    this.drawAxes();
    this.request();
  }

  // ------------------------------------------------------------------ data
  private request(delay = 120): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.fetch(), delay);
  }

  private async fetch(): Promise<void> {
    const dur = this.host.duration();
    this.empty.style.display = dur > 0 ? "none" : "";
    if (dur <= 0) { this.data = null; this.draw(); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cols = Math.max(64, Math.min(4096, Math.round(this.spec.clientWidth * dpr)));
    const rows = Math.max(64, Math.min(2048, Math.round(this.spec.clientHeight * dpr)));
    const ticket = ++this.ticket, t0 = this.t0, t1 = this.t1;
    try {
      const r = await this.host.analyze({ axis: getAxis(), t0, t1, n: this.n, cols, rows });
      if (ticket !== this.ticket || !r) return;
      this.data = r;
      paintSpectrogram(this.painted, r.image, 0, this.host.look());
      this.draw();
    } catch { /* a newer request replaced this one */ }
  }

  // ------------------------------------------------------------------ drawing
  private fitCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D | null {
    const dpr = window.devicePixelRatio || 1, w = Math.round(c.clientWidth * dpr), hh = Math.round(c.clientHeight * dpr);
    if (!w || !hh) return null;
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    return c.getContext("2d");
  }

  /** x of time t in [0, width] of the current view. */
  private xOf(t: number, width: number): number { return ((t - this.t0) / (this.t1 - this.t0)) * width; }

  private draw(): void {
    const g = this.fitCanvas(this.spec), d = this.data;
    if (g) {
      g.fillStyle = getComputedStyle(this.spec).getPropertyValue("--display") || "#fff";
      g.fillRect(0, 0, this.spec.width, this.spec.height);
      if (d && this.painted.width) {
        // the image covers [d.t0, d.t1]: place it in the current view (so zoom and pan respond at once)
        const x0 = this.xOf(d.t0, this.spec.width), x1 = this.xOf(d.t1, this.spec.width);
        g.imageSmoothingEnabled = true;
        g.drawImage(this.painted, x0, 0, x1 - x0, this.spec.height);
      }
    }
    this.drawWave();
    this.drawOverlay();
  }

  private drawWave(): void {
    const g = this.fitCanvas(this.wave), d = this.data;
    if (!g) return;
    const W = this.wave.width, H = this.wave.height, css = getComputedStyle(this.wave);
    g.fillStyle = css.getPropertyValue("--display") || "#fff";
    g.fillRect(0, 0, W, H);
    g.fillStyle = css.getPropertyValue("--seam") || "#b7bdc3";
    g.fillRect(0, Math.round(H / 2), W, 1);
    if (!d) return;
    const cols = d.wave.length / 2;
    g.fillStyle = css.getPropertyValue("--ink") || "#16181a";
    for (let c = 0; c < cols; c++) {
      const xa = this.xOf(d.t0 + (c / cols) * (d.t1 - d.t0), W), xb = this.xOf(d.t0 + ((c + 1) / cols) * (d.t1 - d.t0), W);
      if (xb < 0 || xa > W) continue;
      const lo = d.wave[2 * c], hi = d.wave[2 * c + 1];
      const ya = H / 2 - hi * (H / 2 - 1), yb = H / 2 - lo * (H / 2 - 1);
      g.fillRect(xa, ya, Math.max(1, xb - xa), Math.max(1, yb - ya));
    }
  }

  /** The image column under time t, or −1. */
  private columnAt(t: number): number {
    const d = this.data;
    if (!d || t < d.t0 || t > d.t1) return -1;
    return Math.min(d.image.cols - 1, Math.floor(((t - d.t0) / (d.t1 - d.t0)) * d.image.cols));
  }

  private drawOverlay(): void {
    const d = this.data, hv = this.hover;
    this.cross.style.display = hv ? "block" : "none";
    if (hv) { this.cross.style.left = `${hv.x * 100}%`; this.cross.style.top = `${hv.y * 100}%`; }
    // readout
    if (hv && d) {
      const t = this.t0 + hv.x * (this.t1 - this.t0), f = yToFreq(hv.y), col = this.columnAt(t);
      const row = Math.min(d.image.rows - 1, Math.max(0, Math.floor(hv.y * d.image.rows)));
      const v = col >= 0 ? d.image.data[row * d.image.cols + col] : 255;
      const level = v >= 255 ? "silence" : `${((d.image.peakDbfs ?? 0) - v / 2).toFixed(1).replace("-", "−")} dBFS`;
      this.readout.textContent = `${t.toFixed(3)} s · ${f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : f.toFixed(0) + " Hz"} · ${noteOf(f)} · ${level}`;
    } else {
      this.readout.textContent = d ? `${this.t0.toFixed(2)}–${this.t1.toFixed(2)} s · peak ${(d.image.peakDbfs ?? 0).toFixed(1).replace("-", "−")} dBFS` : "";
    }
    this.drawSlice(hv && d ? this.columnAt(this.t0 + hv.x * (this.t1 - this.t0)) : -1);
  }

  /** The spectrum of one column (or the loudest value of every row in the view), level to the right. */
  private drawSlice(col: number): void {
    const g = this.fitCanvas(this.slice), d = this.data;
    if (!g) return;
    const W = this.slice.width, H = this.slice.height, css = getComputedStyle(this.slice), range = this.host.look().rangeDb + 12;
    g.fillStyle = css.getPropertyValue("--display") || "#fff";
    g.fillRect(0, 0, W, H);
    g.fillStyle = css.getPropertyValue("--seam") || "#b7bdc3";
    for (let db = 0; db <= range; db += 20) g.fillRect(Math.round(W * (1 - db / range)), 0, 1, H);
    if (!d) { this.sliceTitle.textContent = "Spectrum"; return; }
    const { rows, cols, data } = d.image, vals = new Float64Array(rows);
    for (let r = 0; r < rows; r++) {
      let v = 255;
      if (col >= 0) v = data[r * cols + col];
      else for (let c = 0; c < cols; c++) v = Math.min(v, data[r * cols + c]);
      vals[r] = v;
    }
    let best = 0;
    for (let r = 1; r < rows; r++) if (vals[r] < vals[best]) best = r;
    const xOfV = (v: number) => Math.max(0, W * (1 - v / 2 / range));
    g.beginPath();
    g.moveTo(0, 0);
    for (let r = 0; r < rows; r++) g.lineTo(xOfV(vals[r]), ((r + 0.5) / rows) * H);
    g.lineTo(0, H);
    g.closePath();
    g.fillStyle = css.getPropertyValue("--layer-3") || "#0085ca";
    g.globalAlpha = 0.18;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = css.getPropertyValue("--ink") || "#16181a";
    g.lineWidth = Math.max(1, (window.devicePixelRatio || 1) * 0.8);
    g.beginPath();
    for (let r = 0; r < rows; r++) { const x = xOfV(vals[r]), y = ((r + 0.5) / rows) * H; if (r) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
    // the loudest frequency
    // refine between rows with a parabola through the peak and its neighbours (levels in dB)
    let off = 0;
    if (best > 0 && best < rows - 1) {
      const p = vals[best - 1], q = vals[best], r = vals[best + 1], den = p - 2 * q + r;
      if (den > 0) off = Math.max(-0.5, Math.min(0.5, 0.5 * (p - r) / den));
    }
    const fy = ((best + 0.5) / rows) * H, f = yToFreq((best + 0.5 + off) / rows);
    g.fillStyle = css.getPropertyValue("--layer-3") || "#0085ca";
    g.beginPath();
    g.arc(xOfV(vals[best]), fy, 3 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
    g.fill();
    const where = col >= 0 ? `at ${(d.t0 + ((col + 0.5) / cols) * (d.t1 - d.t0)).toFixed(3)} s` : "loudest in view";
    this.sliceTitle.textContent = vals[best] >= 255 ? `Spectrum ${where}` : `Spectrum ${where} · peak ${f >= 1000 ? (f / 1000).toFixed(2) + "k" : f.toFixed(0)} Hz ${noteOf(f)}`;
  }

  private drawAxes(): void {
    // frequency: labels + piano
    this.piano.setRoot(this.host.root());
    this.yax.replaceChildren(this.piano.el, ...ticks(this.host.labels()).map(([lbl, f]) =>
      h("span", { class: "ro-sm major", style: `top:calc(${(freqToY(f) * 100).toFixed(2)}% - 6px)` }, lbl)));
    this.piano.draw();
    // time
    const span = this.t1 - this.t0;
    const step = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20].find((s) => span / s <= 8) ?? 30;
    const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    const spans: HTMLElement[] = [];
    for (let t = Math.ceil(this.t0 / step) * step; t <= this.t1 + 1e-9; t += step) {
      const x = (t - this.t0) / span;
      if (x > 0.97) break;
      spans.push(h("span", { class: "ro-sm", style: `left:${(x * 100).toFixed(2)}%` }, `${t.toFixed(dec)} s`));
    }
    this.xax.replaceChildren(...spans);
  }
}

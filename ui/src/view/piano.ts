// A vertical piano drawn on the frequency axis of a spectrogram: low notes at the bottom, black
// keys from the outer (left) edge as in a piano roll, a line under every C, and the sampler's
// root key in the accent colour. It follows the display axis (log or linear, any range).

import { freqToY, getAxis } from "../dsp/spectrogram.ts";
import { h } from "./dom.ts";

const BLACK = new Set([1, 3, 6, 8, 10]);
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Frequency of MIDI note n (A4 = 69 = 440 Hz). */
export const noteFreq = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** "A4 +3¢" for a frequency. */
export function noteOf(f: number): string {
  if (!(f > 0)) return "";
  const m = 69 + 12 * Math.log2(f / 440), n = Math.round(m), cents = Math.round((m - n) * 100);
  const name = NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  return cents === 0 ? name : `${name} ${cents > 0 ? "+" : "−"}${Math.abs(cents)}¢`;
}

export class Piano {
  readonly el: HTMLCanvasElement;
  private root: number | null = null;

  constructor(cls = "") {
    this.el = h("canvas", { class: `piano ${cls}`, "aria-hidden": "true" });
    new ResizeObserver(() => this.draw()).observe(this.el);
  }

  setRoot(root: number | null): void { if (root !== this.root) { this.root = root; this.draw(); } }

  draw(): void {
    const c = this.el, W = c.clientWidth, H = c.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext("2d");
    if (!g) return;
    const css = getComputedStyle(c), v = (name: string) => css.getPropertyValue(name).trim();
    const white = v("--display") || "#fff", ink = v("--ink") || "#16181a", seam = v("--seam") || "#b7bdc3", accent = v("--layer-3") || "#0085ca";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = white;
    g.fillRect(0, 0, W, H);

    const a = getAxis(), y = (n: number) => freqToY(noteFreq(n), a) * H;   // n may be fractional
    const lo = Math.max(0, Math.floor(69 + 12 * Math.log2(Math.max(a.fmin, 8) / 440)) - 1);
    const hi = Math.min(135, Math.ceil(69 + 12 * Math.log2(a.fmax / 440)) + 1);
    const blackW = Math.round(W * 0.6);

    // Level of detail: keys fade out as they get thinner than a few pixels, leaving the octave
    // lines (C) and the root, so a small view reads as a ruler instead of a smudge.
    const detail = (n: number) => Math.max(0, Math.min(1, (y(n - 0.5) - y(n + 0.5) - 1.5) / 3));
    // separators between white keys: at the semitone edge for E|F and B|C, under the black key otherwise
    g.fillStyle = seam;
    for (let n = lo; n <= hi; n++) {
      g.globalAlpha = detail(n);
      if (g.globalAlpha === 0) continue;
      if (BLACK.has(n % 12)) g.fillRect(blackW, Math.round(y(n)), W - blackW, 1);
      else if (!BLACK.has((n + 1) % 12)) g.fillRect(0, Math.round(y(n + 0.5)), W, 1);
    }
    // black keys
    g.fillStyle = ink;
    for (let n = lo; n <= hi; n++) {
      if (!BLACK.has(n % 12)) continue;
      g.globalAlpha = 0.85 * detail(n);
      if (g.globalAlpha > 0) g.fillRect(0, y(n + 0.5), blackW, y(n - 0.5) - y(n + 0.5));
    }
    g.globalAlpha = 1;
    // octaves: a line under every C
    for (let n = lo; n <= hi; n++) if (n % 12 === 0) g.fillRect(0, Math.round(y(n - 0.5)), W, 1);
    // the root, always visible (at least 2 px)
    if (this.root !== null) {
      const r = this.root, top = y(r + 0.5), bottom = y(r - 0.5), mid = (top + bottom) / 2, hh = Math.max(2, bottom - top);
      g.fillStyle = accent;
      g.fillRect(0, mid - hh / 2, BLACK.has(r % 12) && detail(r) > 0 ? blackW : W, hh);
    }
    // edge toward the spectrogram
    g.fillStyle = seam;
    g.fillRect(W - 1, 0, 1, H);
  }
}

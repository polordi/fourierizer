// Display spectrogram: STFT magnitude reduced to screen resolution on a frequency axis (log or
// linear, any range). Each pixel holds its level in dB below the image's peak, in half-dB steps
// (0 = peak, 255 = −127.5 dB or quieter), so the view can change range and gain instantly
// without recomputing anything (like Wave Candy). Same algorithm as core/src/spectrogram.cpp.

import { RealFFT } from "./fft.ts";
import { frameCount, gridWindow, type Grid } from "./stft.ts";

export const F_MIN = 30;
export const F_MAX = 20000;
export const GAMMA = 2.4;

export interface SpectrogramImage { data: Uint8Array; cols: number; rows: number; }

/** Frequency axis of every display, top (fmax) to bottom (fmin). */
export interface Axis { fmin: number; fmax: number; scale: "log" | "lin"; }
export const DEFAULT_AXIS: Axis = { fmin: F_MIN, fmax: F_MAX, scale: "log" };

/** The axis the views use now (set from the Display panel). */
let current: Axis = { ...DEFAULT_AXIS };
export function setAxis(a: Axis): void { current = { ...a }; }
export function getAxis(): Axis { return current; }

/** Fraction from the top (0) to the bottom (1) of the display for frequency f. */
export function freqToY(f: number, a: Axis = current): number {
  if (a.scale === "lin") return 1 - (f - a.fmin) / (a.fmax - a.fmin);
  return 1 - Math.log(Math.max(f, 1e-9) / a.fmin) / Math.log(a.fmax / a.fmin);
}
export function yToFreq(y: number, a: Axis = current): number {
  if (a.scale === "lin") return a.fmin + (a.fmax - a.fmin) * (1 - y);
  return a.fmin * (a.fmax / a.fmin) ** (1 - y);
}

/** Display mapping of a pixel value: dB range shown (contrast) and gain (brightness). */
export interface Look { rangeDb: number; gainDb: number; }
export const DEFAULT_LOOK: Look = { rangeDb: 58, gainDb: 0 };

/** 0..255 pixel value → brightness 0..1 for a look. */
export function level(v: number, look: Look): number {
  const db = -v / 2 + look.gainDb;
  const x = (db + look.rangeDb) / look.rangeDb;
  return x <= 0 ? 0 : x >= 1 ? 1 : x ** GAMMA;
}

export function spectrogramImage(x: ArrayLike<number>, sr: number, g: Grid, maxCols = 1400, rows = 360, axis: Axis = DEFAULT_AXIS): SpectrogramImage {
  const n = x.length, M = frameCount(n, g), cols = Math.max(1, Math.min(M, maxCols));
  const a: Axis = { ...axis, fmax: Math.min(axis.fmax, sr / 2) };
  const w = gridWindow(g), fft = new RealFFT(g.N), B = fft.bins;
  const frame = new Float64Array(g.L), re = new Float64Array(B), im = new Float64Array(B), mag = new Float64Array(B);
  const bin0 = new Int32Array(rows), frac = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    const b = Math.max(0, yToFreq((r + 0.5) / rows, a)) * g.N / sr;
    bin0[r] = Math.min(B - 2, Math.floor(b)); frac[r] = Math.min(1, b - bin0[r]);
  }
  const acc = new Float64Array(rows * cols);
  const left = g.L >> 1;
  for (let m = 0; m < M; m++) {
    const start = m * g.H - left;
    for (let j = 0; j < g.L; j++) { const i = start + j; frame[j] = i >= 0 && i < n ? x[i] * w[j] : 0; }
    fft.forward(frame, re, im);
    for (let k = 0; k < B; k++) mag[k] = Math.hypot(re[k], im[k]);
    const col = Math.min(cols - 1, Math.floor(m * cols / M));
    for (let r = 0; r < rows; r++) {
      const v = mag[bin0[r]] * (1 - frac[r]) + mag[bin0[r] + 1] * frac[r], idx = r * cols + col;
      if (v > acc[idx]) acc[idx] = v;
    }
  }
  let peak = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i] > peak) peak = acc[i];
  const data = new Uint8Array(rows * cols).fill(255);
  if (peak > 0) {
    const ref = 20 * Math.log10(peak);
    for (let i = 0; i < acc.length; i++) {
      const db = 20 * Math.log10(acc[i] + 1e-300) - ref;
      data[i] = Math.min(255, Math.max(0, Math.round(-db * 2)));
    }
  }
  return { data, cols, rows };
}

// Display spectrogram: STFT magnitude in dB, reduced to screen resolution on a log-frequency
// axis. Values are 0–255 (0 = silence, 255 = loudest); the view colors them per layer.

import { RealFFT } from "./fft.ts";
import { frameCount, gridWindow, type Grid } from "./stft.ts";

export const F_MIN = 30;
export const F_MAX = 20000;
export const RANGE_DB = 58;
export const GAMMA = 2.4;

export interface SpectrogramImage { data: Uint8Array; cols: number; rows: number; }

/** Fraction from the top (0) to the bottom (1) of the display for frequency f. */
export function freqToY(f: number, fmax = F_MAX): number { return 1 - Math.log(Math.max(f, 1e-9) / F_MIN) / Math.log(fmax / F_MIN); }
export function yToFreq(y: number, fmax = F_MAX): number { return F_MIN * (fmax / F_MIN) ** (1 - y); }

export function spectrogramImage(x: ArrayLike<number>, sr: number, g: Grid, maxCols = 1400, rows = 360): SpectrogramImage {
  const n = x.length, M = frameCount(n, g), cols = Math.max(1, Math.min(M, maxCols));
  const fmax = Math.min(F_MAX, sr / 2);
  const w = gridWindow(g), fft = new RealFFT(g.N), B = fft.bins;
  const frame = new Float64Array(g.L), re = new Float64Array(B), im = new Float64Array(B), mag = new Float64Array(B);
  const bin0 = new Int32Array(rows), frac = new Float64Array(rows);
  for (let r = 0; r < rows; r++) {
    const b = yToFreq((r + 0.5) / rows, fmax) * g.N / sr;
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
  const data = new Uint8Array(rows * cols);
  if (peak > 0) {
    const ref = 20 * Math.log10(peak);
    for (let i = 0; i < acc.length; i++) {
      const db = 20 * Math.log10(acc[i] + 1e-12) - ref;
      const v = Math.min(1, Math.max(0, (db + RANGE_DB) / RANGE_DB)) ** GAMMA;
      data[i] = Math.round(v * 255);
    }
  }
  return { data, cols, rows };
}

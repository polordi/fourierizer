// STFT on a grid (w, L, N ≥ L, H) with centered frames and the least-squares inverse,
// identical to python/fourierizer_ref/stft.py. The workhorse is `maskedResynthesis`, which
// streams frame by frame (STFT → mask → IFFT → overlap-add) with O(N) memory.

import { RealFFT } from "./fft.ts";
import { makeWindow, type WindowName } from "./windows.ts";

export interface Grid { window: WindowName; L: number; N: number; H: number; }

const EPS = 1e-12;

export function gridWindow(g: Grid): Float64Array { return makeWindow(g.window, g.L); }

export function nolaMin(w: Float64Array, H: number): number {
  const acc = new Float64Array(H);
  for (let start = 0; start < w.length; start += H)
    for (let i = 0; i < H && start + i < w.length; i++) acc[i] += w[start + i] ** 2;
  let m = Infinity;
  for (let i = 0; i < H; i++) m = Math.min(m, acc[i]);
  return m;
}

export function validateGrid(g: Grid): void {
  if (g.N < g.L) throw new Error(`FFT size N=${g.N} must be ≥ window length L=${g.L}`);
  if (!(g.H >= 1 && g.H <= g.L)) throw new Error(`hop H=${g.H} must satisfy 1 ≤ H ≤ L=${g.L}`);
  if (nolaMin(gridWindow(g), g.H) <= EPS) throw new Error(`${g.window} window with L=${g.L}, H=${g.H} violates NOLA`);
}

/** Number of frames for a signal of n samples (frames whose center ≤ the end). */
export function frameCount(n: number, g: Grid): number { return 1 + Math.ceil(Math.max(n, 0) / g.H); }

export function binFreqs(g: Grid, sr: number): Float64Array {
  const f = new Float64Array(g.N / 2 + 1);
  for (let k = 0; k < f.length; k++) f[k] = k * sr / g.N;
  return f;
}

/** Fill `frame` (length L) with x[mH − L/2 + j]·w[j], zero outside the signal. */
function readFrame(x: ArrayLike<number>, m: number, g: Grid, w: Float64Array, frame: Float64Array): void {
  const left = g.L >> 1, start = m * g.H - left, n = x.length;
  for (let j = 0; j < g.L; j++) {
    const i = start + j;
    frame[j] = i >= 0 && i < n ? x[i] * w[j] : 0;
  }
}

/** Full STFT (frames × bins) — used for tests and analysis, not for rendering. */
export function stft(x: ArrayLike<number>, g: Grid): { re: Float64Array[]; im: Float64Array[] } {
  validateGrid(g);
  const w = gridWindow(g), M = frameCount(x.length, g), fft = new RealFFT(g.N), frame = new Float64Array(g.L);
  const re: Float64Array[] = [], im: Float64Array[] = [];
  for (let m = 0; m < M; m++) {
    readFrame(x, m, g, w, frame);
    const r = new Float64Array(fft.bins), i = new Float64Array(fft.bins);
    fft.forward(frame, r, i);
    re.push(r); im.push(i);
  }
  return { re, im };
}

/** Called per frame with its center time; writes the mask (length N/2+1) into `out`. */
export type MaskRow = (m: number, t: number, out: Float64Array) => void;

/**
 * y = ISTFT(M ⊙ STFT(x)) for each channel, with the least-squares (Griffin–Lim) normalization
 * x̂ = Σ w·y_m / Σ w². Output has the input's length.
 */
export function maskedResynthesis(channels: ArrayLike<number>[], g: Grid, sr: number, mask: MaskRow): Float64Array[] {
  validateGrid(g);
  const n = channels.length ? channels[0].length : 0;
  const w = gridWindow(g), M = frameCount(n, g), L = g.L, H = g.H, left = L >> 1;
  const total = (M - 1) * H + L;
  const fft = new RealFFT(g.N);
  const frame = new Float64Array(L), time = new Float64Array(g.N);
  const re = new Float64Array(fft.bins), im = new Float64Array(fft.bins), row = new Float64Array(fft.bins);
  const wsum = new Float64Array(total);
  const ys = channels.map(() => new Float64Array(total));
  for (let m = 0; m < M; m++) {
    mask(m, m * H / sr, row);
    let any = false;
    for (let k = 0; k < row.length; k++) if (row[k] !== 0) { any = true; break; }
    const base = m * H;
    for (let j = 0; j < L; j++) wsum[base + j] += w[j] * w[j];
    if (!any) continue;
    for (let c = 0; c < channels.length; c++) {
      readFrame(channels[c], m, g, w, frame);
      fft.forward(frame, re, im);
      for (let k = 0; k < row.length; k++) { re[k] *= row[k]; im[k] *= row[k]; }
      fft.inverse(re, im, time);
      const y = ys[c];
      for (let j = 0; j < L; j++) y[base + j] += time[j] * w[j];
    }
  }
  return ys.map((y) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = left + i, s = wsum[p];
      out[i] = p < total ? y[p] / (s > EPS ? s : 1) : 0;
    }
    return out;
  });
}

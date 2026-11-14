// Spectral pitch shift: changes the pitch and keeps the duration (the sampler's "Spectral" mode).
// Phase-vocoder time stretch by r = 2^(s/12) with identity phase locking and stereo-linked phases,
// then Kaiser-sinc resampling by r. Port of python/fourierizer_ref/spectral.py (matches to 1e-9).

import { RealFFT } from "./fft.ts";
import { makeWindow } from "./windows.ts";
import { resampleByStep } from "./resample.ts";

export type SpectralWindow = "tonal" | "mixed" | "punchy";
export const SPECTRAL_N: Record<SpectralWindow, number> = { tonal: 4096, mixed: 2048, punchy: 1024 };

const PEAK_FLOOR = 1e-6, SILENCE = 1e-9, TAU = 2 * Math.PI;

const princarg = (x: number) => x - TAU * Math.floor((x + Math.PI) / TAU);

/** Shift every channel by `semitones` (same length). `n` is the analysis window (FFT size). */
export function spectralPitch(x: ArrayLike<number>[], semitones: number, n = 4096): Float64Array[] {
  if (semitones === 0) return x.map((c) => Float64Array.from(c));
  const C = x.length, L = x[0].length, hop = n / 8, delta = hop, half = n / 2, B = half + 1;
  const r = 2 ** (semitones / 12), M = Math.ceil(L * r), ha = hop / r;
  const j0 = -Math.floor(half / hop) + 1, j1 = Math.floor((M - 1 + half) / hop);
  const w = makeWindow("hann", n), fft = new RealFFT(n);
  let norm = 0;
  for (let i = 0; i < n; i++) norm += w[i] * w[i];
  norm /= hop;

  let mono: ArrayLike<number> = x[0];
  if (C > 1) {
    const m = new Float64Array(L);
    for (const c of x) for (let i = 0; i < L; i++) m[i] += c[i];
    mono = m;
  }
  const seg = new Float64Array(n);
  const segment = (sig: ArrayLike<number>, centre: number) => {
    seg.fill(0);
    const lo = centre - half, s0 = Math.max(lo, 0), s1 = Math.min(lo + n, sig.length);
    for (let i = s0; i < s1; i++) seg[i - lo] = sig[i] * w[i - lo];
    return seg;
  };

  const re = new Float64Array(B), im = new Float64Array(B), pre = new Float64Array(B), pim = new Float64Array(B);
  const mag = new Float64Array(B), ph = new Float64Array(B), phi = new Float64Array(B), theta = new Float64Array(B);
  const cr = new Float64Array(B), ci = new Float64Array(B), cs = new Float64Array(B), sn = new Float64Array(B), frame = new Float64Array(n);
  const peaks = new Int32Array(B);
  const y = Array.from({ length: C }, () => new Float64Array(M));

  for (let j = j0; j <= j1; j++) {
    const a = Math.floor(j * ha + 0.5);
    fft.forward(segment(mono, a), re, im);
    let peak = 0;
    for (let k = 0; k < B; k++) {
      mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      ph[k] = Math.atan2(im[k], re[k]);
      if (mag[k] > peak) peak = mag[k];
    }
    if (j === j0 || peak < SILENCE) theta.fill(0);
    else {
      fft.forward(segment(mono, a - delta), pre, pim);
      for (let k = 0; k < B; k++) {
        const wk = TAU * k / n;
        const omega = wk + princarg(ph[k] - Math.atan2(pim[k], pre[k]) - wk * delta) / delta;
        theta[k] = princarg(phi[k] + hop * omega) - ph[k];
      }
      // identity phase locking: every bin turns by the angle of its nearest peak
      const floor = PEAK_FLOOR * peak;
      let np = 0;
      for (let k = 0; k < B; k++) {
        const m = mag[k];
        if (m > floor && (k < 1 || m > mag[k - 1]) && (k < 2 || m > mag[k - 2])
          && (k + 1 >= B || m >= mag[k + 1]) && (k + 2 >= B || m >= mag[k + 2])) peaks[np++] = k;
      }
      if (np > 0) {
        let p = 0;
        for (let k = 0; k < B; k++) {
          while (p + 1 < np && k > ((peaks[p] + peaks[p + 1]) >> 1)) p++;
          cr[k] = theta[peaks[p]];
        }
        theta.set(cr);
      }
    }
    for (let k = 0; k < B; k++) phi[k] = princarg(ph[k] + theta[k]);

    const lo = j * hop - half, s0 = Math.max(lo, 0), s1 = Math.min(lo + n, M);
    if (s1 <= s0) continue;
    for (let k = 0; k < B; k++) { cs[k] = Math.cos(theta[k]); sn[k] = Math.sin(theta[k]); }
    for (let c = 0; c < C; c++) {
      if (C > 1) fft.forward(segment(x[c], a), re, im);   // mono: re/im already hold this frame
      for (let k = 0; k < B; k++) {
        cr[k] = re[k] * cs[k] - im[k] * sn[k];
        ci[k] = re[k] * sn[k] + im[k] * cs[k];
      }
      fft.inverse(cr, ci, frame);
      const yc = y[c];
      for (let i = s0; i < s1; i++) yc[i] += frame[i - lo] * w[i - lo];
    }
  }
  return y.map((yc) => {
    for (let i = 0; i < M; i++) yc[i] /= norm;
    const z = resampleByStep(yc, r), out = new Float64Array(L);
    out.set(z.length > L ? z.subarray(0, L) : z);
    return out;
  });
}

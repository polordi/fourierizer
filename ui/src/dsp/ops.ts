// Operations other than the sum (PLAN §3.3, §4.6). They need one common time-frequency grid:
// every layer is analysed again on that grid (after pitch, gain and offset), its mask is
// applied, and the layers are combined cell by cell before a single inverse STFT.

import { RealFFT } from "./fft.ts";
import { binFreqs, frameCount, gridWindow, validateGrid, type Grid } from "./stft.ts";
import { logFreqs, SelectionRaster, type Shape } from "./mask.ts";
import { normalize } from "./render.ts";

export type Op = "sum" | "max" | "cross" | "product" | "subtract";

export const OPS: { id: Op; label: string; pair: boolean; hint: string }[] = [
  { id: "sum", label: "Sum", pair: false, hint: "Σ gᵢ·χᵢ — every selection sounds together" },
  { id: "max", label: "Max", pair: false, hint: "Loudest layer wins each cell — a spectral collage" },
  { id: "cross", label: "Cross", pair: true, hint: "|χA|·e^{i∠χB} — body of A, motion of B" },
  { id: "product", label: "Prod", pair: true, hint: "|χA|·χB — A prints its spectrum on B (convolution)" },
  { id: "subtract", label: "Sub", pair: true, hint: "max(|χA|−|χB|, 0)·e^{i∠χA} — take B out of A" },
];

export interface OpLayer {
  channels: ArrayLike<number>[];   // already transposed (Tape) at the project rate
  shapes: Shape[];
  featherS: number;
  featherOct: number;
  gainDb: number;
  offsetS: number;
}

export const COMMON_GRID: Grid = { window: "hann", L: 4096, N: 4096, H: 512 };

/** Render a non-linear operation. For pair operations only layers a and b (indices) are used. */
export function renderOp(layers: OpLayer[], op: Exclude<Op, "sum">, sr: number, a = 0, b = 1,
  g: Grid = COMMON_GRID, channels = 2, normalizeDbfs = -0.3): Float64Array[] {
  validateGrid(g);
  const pair = op !== "max";
  const used = pair ? [layers[a], layers[b]] : layers;
  if (used.some((l) => !l)) return Array.from({ length: channels }, () => new Float64Array(0));
  const P = logFreqs(binFreqs(g, sr));
  const prep = used.map((l) => ({
    l, sel: new SelectionRaster(l.shapes, l.featherS, l.featherOct),
    gain: 10 ** (l.gainDb / 20), start: Math.round(l.offsetS * sr),
  }));
  let length = 0;
  for (const p of prep) length = Math.max(length, p.start + p.l.channels[0].length);
  const w = gridWindow(g), L = g.L, H = g.H, left = L >> 1, M = frameCount(length, g), total = (M - 1) * H + L;
  const fft = new RealFFT(g.N), B = fft.bins;
  const frame = new Float64Array(L), time = new Float64Array(g.N), mask = new Float64Array(B);
  const re = prep.map(() => new Float64Array(B)), im = prep.map(() => new Float64Array(B));
  const outRe = new Float64Array(B), outIm = new Float64Array(B);
  const wsum = new Float64Array(total);
  const ys = Array.from({ length: channels }, () => new Float64Array(total));

  for (let m = 0; m < M; m++) {
    const base = m * H;
    for (let j = 0; j < L; j++) wsum[base + j] += w[j] * w[j];
    for (let c = 0; c < channels; c++) {
      prep.forEach((p, i) => {
        const src = p.l.channels[Math.min(c, p.l.channels.length - 1)], from = base - left - p.start;
        let any = false;
        for (let j = 0; j < L; j++) {
          const k = from + j, v = k >= 0 && k < src.length ? src[k] * w[j] * p.gain : 0;
          frame[j] = v; if (v !== 0) any = true;
        }
        if (!any) { re[i].fill(0); im[i].fill(0); return; }
        fft.forward(frame, re[i], im[i]);
        p.sel.row(m * H / sr - p.l.offsetS, P, mask);
        for (let k = 0; k < B; k++) { re[i][k] *= mask[k]; im[i][k] *= mask[k]; }
      });
      combine(op, re, im, outRe, outIm);
      fft.inverse(outRe, outIm, time);
      const y = ys[c];
      for (let j = 0; j < L; j++) y[base + j] += time[j] * w[j];
    }
  }
  const out = ys.map((y) => {
    const o = new Float64Array(length);
    for (let i = 0; i < length; i++) { const p = left + i, s = wsum[p]; o[i] = p < total ? y[p] / (s > 1e-12 ? s : 1) : 0; }
    return o;
  });
  normalize(out, normalizeDbfs);
  return out;
}

function combine(op: Exclude<Op, "sum">, re: Float64Array[], im: Float64Array[], oRe: Float64Array, oIm: Float64Array): void {
  const B = oRe.length;
  for (let k = 0; k < B; k++) {
    if (op === "max") {
      let best = -1, bm = -1;
      for (let i = 0; i < re.length; i++) { const m = re[i][k] ** 2 + im[i][k] ** 2; if (m > bm) { bm = m; best = i; } }
      oRe[k] = re[best][k]; oIm[k] = im[best][k];
      continue;
    }
    const aRe = re[0][k], aIm = im[0][k], bRe = re[1][k], bIm = im[1][k];
    const aMag = Math.hypot(aRe, aIm), bMag = Math.hypot(bRe, bIm);
    if (op === "cross") {
      const s = bMag > 1e-12 ? aMag / bMag : 0; oRe[k] = bRe * s; oIm[k] = bIm * s;
    } else if (op === "product") {
      oRe[k] = bRe * aMag; oIm[k] = bIm * aMag;
    } else {
      const s = aMag > 1e-12 ? Math.max(aMag - bMag, 0) / aMag : 0; oRe[k] = aRe * s; oIm[k] = aIm * s;
    }
  }
}

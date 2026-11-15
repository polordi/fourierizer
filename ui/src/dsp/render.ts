// Layer synthesis and mixing (PLAN §4.2), identical to python/fourierizer_ref/render.py:
//   y[n] = Σᵢ gᵢ · ISTFTᵢ( Mᵢ ⊙ STFTᵢ( Tᵢ xᵢ ) )[n − τᵢ F_s]
// Each layer is reconstructed on its own grid; no matrix is ever resampled.

import { binFreqs, maskedResynthesis, type Grid } from "./stft.ts";
import { F_FLOOR, logFreqs, SelectionRaster, type Shape } from "./mask.ts";
import { tapePitch } from "./resample.ts";

export interface LayerInput {
  channels: ArrayLike<number>[];   // (channels, samples) at the project rate
  grid: Grid;
  shapes: Shape[];
  featherS?: number;
  featherOct?: number;
  gainDb?: number;
  offsetS?: number;
  pitchSt?: number;                // Tape transposition, applied before the STFT
  multires?: boolean;              // lows / mids / highs on three grids (Python: Layer.multires)
}

// ---- Multiresolution (Python: render.py band_weights / band_grid)
export const MULTIRES_SPLITS = [300, 3000];
export const MULTIRES_WIDTH = 1;
export const MULTIRES_FACTORS = [4, 1, 0.25];
const MIN_N = 128, MAX_N = 32768;

/** w_low, w_mid, w_high at frequency f (they sum to 1). */
export function bandWeights(f: number): [number, number, number] {
  const P = Math.log2(Math.max(f, F_FLOOR));
  const rise = (fc: number) => { const u = Math.min(1, Math.max(0, (P - Math.log2(fc)) / MULTIRES_WIDTH + 0.5)); return 0.5 - 0.5 * Math.cos(Math.PI * u); };
  const r1 = rise(MULTIRES_SPLITS[0]), r2 = rise(MULTIRES_SPLITS[1]);
  return [1 - r1, r1 - r2, r2];
}

/** The layer's grid scaled by `factor` (same window, zero-padding ratio and overlap). */
export function bandGrid(g: Grid, factor: number): Grid {
  const rnd = (v: number) => Math.floor(v + 0.5);
  const N = Math.min(MAX_N, Math.max(MIN_N, rnd(g.N * factor))), scale = N / g.N;
  return { window: g.window, L: Math.max(2, rnd(g.L * scale)), N, H: Math.max(1, rnd(g.H * scale)) };
}

/** Masked resynthesis of one layer, before gain and offset (Python: Layer.synthesize). */
export function synthesizeLayer(layer: LayerInput, sr: number): Float64Array[] {
  const x = layer.pitchSt ? layer.channels.map((c) => tapePitch(c, layer.pitchSt!)) : layer.channels;
  const sel = new SelectionRaster(layer.shapes, layer.featherS, layer.featherOct);
  if (sel.empty) return x.map((c) => new Float64Array(c.length));
  if (!layer.multires) {
    const P = logFreqs(binFreqs(layer.grid, sr));
    return maskedResynthesis(x, layer.grid, sr, (_m, t, out) => sel.row(t, P, out));
  }
  let y: Float64Array[] | null = null;
  MULTIRES_FACTORS.forEach((factor, b) => {
    const g = bandGrid(layer.grid, factor), freqs = binFreqs(g, sr), P = logFreqs(freqs);
    const w = Float64Array.from(freqs, (f) => bandWeights(f)[b]);
    const band = maskedResynthesis(x, g, sr, (_m, t, out) => { sel.row(t, P, out); for (let k = 0; k < out.length; k++) out[k] *= w[k]; });
    if (!y) y = band;
    else for (let c = 0; c < y.length; c++) for (let i = 0; i < y[c].length; i++) y[c][i] += band[c][i];
  });
  return y!;
}

export interface Part { y: Float64Array[]; gainDb?: number; offsetS?: number; }

/** Gain, offset and sum to `channels` outputs; optional peak normalization (Python: render). */
export function mix(parts: Part[], sr: number, channels = 2, normalizeDbfs: number | null = -0.3): Float64Array[] {
  const placed = parts.map((p) => {
    let y = p.y;
    if (y.length !== channels) y = y.length === 1 ? Array.from({ length: channels }, () => p.y[0]) : foldMono(y, channels);
    const g = 10 ** ((p.gainDb ?? 0) / 20);
    const off = Math.round((p.offsetS ?? 0) * sr);
    return { y, g, start: Math.max(off, 0), trim: Math.max(-off, 0) };
  });
  let length = 0;
  for (const p of placed) length = Math.max(length, p.start + Math.max(p.y[0].length - p.trim, 0));
  const out = Array.from({ length: channels }, () => new Float64Array(length));
  for (const p of placed)
    for (let c = 0; c < channels; c++) {
      const src = p.y[c], dst = out[c];
      for (let i = p.trim; i < src.length; i++) dst[p.start + i - p.trim] += p.g * src[i];
    }
  if (normalizeDbfs !== null) normalize(out, normalizeDbfs);
  return out;
}

function foldMono(y: Float64Array[], channels: number): Float64Array[] {
  const m = new Float64Array(y[0].length);
  for (const c of y) for (let i = 0; i < m.length; i++) m[i] += c[i] / y.length;
  return Array.from({ length: channels }, () => m);
}

export function peakOf(chs: ArrayLike<number>[]): number {
  let peak = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
  return peak;
}

export function normalize(chs: Float64Array[], dbfs: number): void {
  const peak = peakOf(chs);
  if (peak <= 0) return;
  const s = 10 ** (dbfs / 20) / peak;
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= s;
}

export function render(layers: LayerInput[], sr: number, channels = 2, normalizeDbfs: number | null = -0.3): Float64Array[] {
  return mix(layers.map((l) => ({ y: synthesizeLayer(l, sr), gainDb: l.gainDb, offsetS: l.offsetS })), sr, channels, normalizeDbfs);
}

// Layer synthesis and mixing (PLAN §4.2), identical to python/fourierizer_ref/render.py:
//   y[n] = Σᵢ gᵢ · ISTFTᵢ( Mᵢ ⊙ STFTᵢ( Tᵢ xᵢ ) )[n − τᵢ F_s]
// Each layer is reconstructed on its own grid; no matrix is ever resampled.

import { binFreqs, maskedResynthesis, type Grid } from "./stft.ts";
import { logFreqs, SelectionRaster, type Shape } from "./mask.ts";
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
}

/** Masked resynthesis of one layer, before gain and offset (Python: Layer.synthesize). */
export function synthesizeLayer(layer: LayerInput, sr: number): Float64Array[] {
  const x = layer.pitchSt ? layer.channels.map((c) => tapePitch(c, layer.pitchSt!)) : layer.channels;
  const sel = new SelectionRaster(layer.shapes, layer.featherS, layer.featherOct);
  if (sel.empty) return x.map((c) => new Float64Array(c.length));
  const P = logFreqs(binFreqs(layer.grid, sr));
  return maskedResynthesis(x, layer.grid, sr, (_m, t, out) => sel.row(t, P, out));
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

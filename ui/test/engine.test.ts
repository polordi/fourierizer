// The TypeScript engine must reproduce the Python reference (python/golden/data) to 1e-9.
// Run: npm test   (Node runs TypeScript directly by stripping the types)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeWindow, type WindowName } from "../src/dsp/windows.ts";
import { RealFFT } from "../src/dsp/fft.ts";
import { synthesizeLayer, render } from "../src/dsp/render.ts";
import { renderOp } from "../src/dsp/ops.ts";
import { resampleByStep, tapePitch } from "../src/dsp/resample.ts";
import { spectrogramImage } from "../src/dsp/spectrogram.ts";
import { SelectionRaster, logFreqs, type Shape } from "../src/dsp/mask.ts";
import type { Grid } from "../src/dsp/stft.ts";

const GOLDEN = fileURLToPath(new URL("../../python/golden/data/", import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(GOLDEN + name, "utf8"));

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  assert.equal(a.length, b.length, "length mismatch");
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

test("windows match the reference", () => {
  const g = load("windows.json");
  for (const [name, ref] of Object.entries(g.windows as Record<string, number[]>)) {
    assert.ok(maxAbsDiff(makeWindow(name as WindowName, g.L), ref) < 1e-12, name);
  }
});

test("real FFT round trip", () => {
  const n = 1024, f = new RealFFT(n), x = new Float64Array(n).map((_, i) => Math.sin(i * 0.37) + (i % 7) / 7);
  const re = new Float64Array(f.bins), im = new Float64Array(f.bins), y = new Float64Array(n);
  f.forward(x, re, im); f.inverse(re, im, y);
  assert.ok(maxAbsDiff(x, y) < 1e-12);
});

test("masked resynthesis matches Layer.synthesize on five grids", () => {
  const g = load("layers.json");
  for (const c of g.cases) {
    const y = synthesizeLayer({ channels: g.x, grid: c.grid as Grid, shapes: g.shapes as Shape[] }, g.sr);
    for (let ch = 0; ch < y.length; ch++) {
      const d = maxAbsDiff(y[ch], c.y[ch]);
      assert.ok(d < 1e-9, `${c.grid.window} L=${c.grid.L} N=${c.grid.N} H=${c.grid.H}: max diff ${d}`);
    }
  }
});

test("selection masks with time fades match Selection.rasterize", () => {
  const g = load("masks.json");
  const raster = new SelectionRaster(g.shapes as Shape[]);
  const P = logFreqs(new Float64Array(g.freqs)), row = new Float64Array(P.length);
  let worst = 0;
  g.times.forEach((t: number, m: number) => { raster.row(t, P, row); worst = Math.max(worst, maxAbsDiff(row, g.M[m])); });
  assert.ok(worst < 1e-9, `max diff ${worst}`);
});

test("resampler (Tape pitch and sample-rate conversion) matches resample_by_step", () => {
  const g = load("resample.json");
  for (const c of g.cases) {
    const y = resampleByStep(g.x, c.step);
    assert.equal(y.length, c.y.length, `step ${c.step}: length`);
    const d = maxAbsDiff(y, c.y);
    assert.ok(d < 1e-9, `step ${c.step}: max diff ${d}`);
  }
});

test("render (gain, offset, monoâ†’stereo, normalization) matches", () => {
  const g = load("render.json");
  const y = render(g.layers.map((l: { x: number[][]; grid: Grid; shapes: Shape[]; gainDb: number; offsetS: number }) => ({
    channels: l.x, grid: l.grid, shapes: l.shapes, gainDb: l.gainDb, offsetS: l.offsetS,
  })), g.sr, 2, -0.3);
  for (let ch = 0; ch < 2; ch++) {
    const d = maxAbsDiff(y[ch], g.y[ch]);
    assert.ok(d < 1e-9, `channel ${ch}: max diff ${d}`);
  }
});

function peakHz(x: Float64Array, sr: number): number {
  const N = 8192, f = new RealFFT(N), re = new Float64Array(f.bins), im = new Float64Array(f.bins);
  f.forward(x.subarray(0, N), re, im);
  let best = 0;
  for (let k = 1; k < f.bins; k++) if (re[k] ** 2 + im[k] ** 2 > re[best] ** 2 + im[best] ** 2) best = k;
  return best * sr / N;
}

test("Tape pitch: +12 st doubles the frequency and halves the length", () => {
  const sr = 48000, n = 24000, x = new Float64Array(n).map((_, i) => Math.sin(2 * Math.PI * 1000 * i / sr));
  const up = tapePitch(x, 12), down = tapePitch(x, -7);
  assert.equal(up.length, n / 2);
  assert.ok(Math.abs(peakHz(up, sr) - 2000) < 10);
  assert.ok(Math.abs(peakHz(down, sr) - 1000 * 2 ** (-7 / 12)) < 10);
});

test("operations (max, cross, product) match render_op", () => {
  const g = load("ops.json");
  const layers = g.layers.map((l: { x: number[][]; shapes: Shape[]; gainDb: number; offsetS: number }) => ({
    channels: l.x, shapes: l.shapes, featherS: 0.01, featherOct: 1 / 12, gainDb: l.gainDb, offsetS: l.offsetS,
  }));
  for (const c of g.cases) {
    const y = renderOp(layers, c.op, g.sr, c.a, c.b, g.grid as Grid);
    for (let ch = 0; ch < 2; ch++) {
      const d = maxAbsDiff(y[ch], c.y[ch]);
      assert.ok(d < 1e-9, `${c.op} (${c.a}, ${c.b}) channel ${ch}: max diff ${d}`);
    }
  }
});

test("spectrogram puts a 1 kHz tone on the right row", () => {
  const sr = 48000, x = Float64Array.from({ length: sr }, (_, i) => Math.sin(2 * Math.PI * 1000 * i / sr));
  const img = spectrogramImage(x, sr, { window: "hann", L: 4096, N: 4096, H: 1024 }, 50, 360);
  let bestRow = 0, best = -1;
  for (let r = 0; r < img.rows; r++) if (best < 0 || img.data[r * img.cols + 25] < best) { best = img.data[r * img.cols + 25]; bestRow = r; }  // 0 = loudest
  const y = (bestRow + 0.5) / img.rows, f = 30 * (20000 / 30) ** (1 - y);
  assert.ok(Math.abs(Math.log2(f / 1000)) < 0.03, `peak at ${f} Hz`);
});

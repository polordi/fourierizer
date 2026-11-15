// The display of a multiresolution layer: each row of the spectrogram comes from the grid of the
// band that dominates its frequency (lows from the long window, highs from the short one), so you
// see what each band hears. Levels are compared in dBFS, which does not depend on the window size.
// Same algorithm as core/src/spectrogram.cpp: multiresImage.

import { spectrogramImage, yToFreq, DEFAULT_AXIS, type Axis, type SpectrogramImage } from "./spectrogram.ts";
import { bandGrid, bandWeights, MULTIRES_FACTORS } from "./render.ts";
import type { Grid } from "./stft.ts";

export function multiresImage(x: ArrayLike<number>, sr: number, g: Grid, maxCols = 1400, rows = 360, axis: Axis = DEFAULT_AXIS,
  start = 0, end = -1, hopFor?: (band: Grid) => number): SpectrogramImage {
  const imgs = MULTIRES_FACTORS.map((f) => {
    const bg = bandGrid(g, f);
    return spectrogramImage(x, sr, hopFor ? { ...bg, H: hopFor(bg) } : bg, maxCols, rows, axis, start, end);
  });
  const cols = Math.max(...imgs.map((m) => m.cols));
  const ref = Math.max(...imgs.map((m) => m.peakDbfs ?? -1000));
  const a: Axis = { ...axis, fmax: Math.min(axis.fmax, sr / 2) };
  const data = new Uint8Array(rows * cols).fill(255);
  for (let r = 0; r < rows; r++) {
    const w = bandWeights(Math.max(0, yToFreq((r + 0.5) / rows, a)));
    const b = w[0] >= w[1] && w[0] >= w[2] ? 0 : w[1] >= w[2] ? 1 : 2, m = imgs[b], pk = m.peakDbfs ?? -1000;
    for (let c = 0; c < cols; c++) {
      const v = m.data[r * m.cols + Math.min(m.cols - 1, Math.floor(c * m.cols / cols))];
      if (v >= 255) continue;
      data[r * cols + c] = Math.min(255, Math.max(0, Math.round(2 * (ref - (pk - v / 2)))));
    }
  }
  return { data, cols, rows, peakDbfs: ref };
}

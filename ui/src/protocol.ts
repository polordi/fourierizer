// Messages between the UI and the engine. The browser demo answers them with a Web Worker;
// the plugin will answer the same requests from the C++ core through the JUCE bridge.

import type { Grid } from "./dsp/stft.ts";
import type { Shape } from "./dsp/mask.ts";
import type { Op } from "./dsp/ops.ts";
import type { SpectrogramImage } from "./dsp/spectrogram.ts";

export interface LayerJob {
  id: number; pitch: number; grid: Grid; shapes: Shape[];
  featherS: number; featherOct: number; gainDb: number; offsetS: number;
}

export type WorkerRequest =
  | { type: "examples"; req: number; sr: number }
  | { type: "source"; id: number; channels: Float32Array[] }
  | { type: "spectrogram"; req: number; id: number; pitch: number; grid: Grid; sr: number }
  | { type: "render"; req: number; sr: number; op: Op; a: number; b: number; layers: LayerJob[]; all: (LayerJob | null)[] };

export interface SpectrogramReply extends SpectrogramImage { type: "spectrogram"; req: number; id: number; duration: number; }
export interface RenderReply { type: "render"; req: number; channels: Float32Array[]; peak: number; ms: number; image: SpectrogramImage | null; }
export type WorkerReply =
  | { type: "examples"; req: number; sounds: Float32Array[] }
  | SpectrogramReply
  | RenderReply
  | { type: "error"; req?: number; message: string };

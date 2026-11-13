// The UI talks to an engine through this interface only, so it does not know whether it runs
// in a browser (Web Worker engine) or inside the plugin (C++ core over the JUCE bridge).

import type { Grid } from "./dsp/stft.ts";
import type { Op } from "./dsp/ops.ts";
import type { LayerJob, LayerReply, RenderReply, SpectrogramReply, WorkerReply, WorkerRequest } from "./protocol.ts";

export interface Host {
  readonly name: string;
  examples(sr: number): Promise<Float32Array[]>;
  setSource(id: number, channels: Float32Array[]): void;
  spectrogram(id: number, pitch: number, grid: Grid, sr: number): Promise<SpectrogramReply>;
  render(job: { sr: number; op: Op; a: number; b: number; layers: LayerJob[]; all: (LayerJob | null)[] }): Promise<RenderReply>;
  layer(job: LayerJob, sr: number): Promise<LayerReply>;
}

declare const __WORKER_SOURCE__: string;

type Pending = { resolve: (v: never) => void; reject: (e: Error) => void };

export class BrowserHost implements Host {
  readonly name = "browser";
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    const url = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: "text/javascript" }));
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data, p = m.req !== undefined ? this.pending.get(m.req) : undefined;
      if (!p) { if (m.type === "error") console.error(m.message); return; }
      this.pending.delete(m.req!);
      if (m.type === "error") p.reject(new Error(m.message)); else p.resolve(m as never);
    };
  }

  private call<T>(msg: WorkerRequest, transfer: Transferable[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set((msg as { req: number }).req, { resolve: resolve as (v: never) => void, reject });
      this.worker.postMessage(msg, transfer);
    });
  }

  async examples(sr: number): Promise<Float32Array[]> {
    const r = await this.call<{ sounds: Float32Array[] }>({ type: "examples", req: this.next++, sr });
    return r.sounds;
  }
  setSource(id: number, channels: Float32Array[]): void {
    this.worker.postMessage({ type: "source", id, channels } satisfies WorkerRequest, channels.map((c) => c.buffer));
  }
  spectrogram(id: number, pitch: number, grid: Grid, sr: number): Promise<SpectrogramReply> {
    return this.call({ type: "spectrogram", req: this.next++, id, pitch, grid, sr });
  }
  render(job: { sr: number; op: Op; a: number; b: number; layers: LayerJob[]; all: (LayerJob | null)[] }): Promise<RenderReply> {
    return this.call({ type: "render", req: this.next++, ...job });
  }
  layer(job: LayerJob, sr: number): Promise<LayerReply> {
    return this.call({ type: "layer", req: this.next++, sr, job });
  }
}

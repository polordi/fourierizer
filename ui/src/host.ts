// The UI talks to its environment only through `Host`: loading sounds, the engine (spectrograms,
// renders, previews), playing notes and saving the project. Two implementations:
//   BrowserHost (here)            the demo: engine in a Web Worker, sampler in Web Audio
//   PluginHost (plugin-host.ts)   inside the plugin: everything in C++ through the JUCE bridge

import type { Grid } from "./dsp/stft.ts";
import type { Op } from "./dsp/ops.ts";
import type { SpectrogramImage } from "./dsp/spectrogram.ts";
import type { LayerJob, WorkerReply, WorkerRequest } from "./protocol.ts";
import { Sampler } from "./audio/sampler.ts";
import { MAX_SECONDS, SR, adsrMap } from "./model.ts";

export interface SourceInfo { name: string; samples: number; channels: number; trimmed?: boolean; }
export interface ResultInfo { image: SpectrogramImage | null; peak: number; ms: number; duration: number; }
export interface PlayState { result: number; preview: number; previewPos: number; voices: number; }
export interface SamplerParams { a: number; d: number; s: number; r: number; root: number; }
export interface Restored { project: string | null; layers: (SourceInfo | null)[]; result: ResultInfo | null; params: SamplerParams | null; }
export interface RenderJob { sr: number; op: Op; a: number; b: number; layers: LayerJob[]; all: (LayerJob | null)[]; }

export interface Host {
  readonly kind: "browser" | "plugin";
  /** Plugin: the saved project (if any). Browser: null (the demo loads examples). */
  start(): Promise<Restored | null>;
  examples(sr: number): Promise<Float32Array[]>;
  setSourceAudio(i: number, name: string, channels: Float32Array[]): SourceInfo;
  loadFile(i: number, file: File): Promise<SourceInfo>;
  /** Native file dialog (plugin), or null when the UI should use its own <input type=file>. */
  pickFile(i: number): Promise<SourceInfo | null> | null;
  spectrogram(i: number, pitch: number, grid: Grid, sr: number): Promise<SpectrogramImage>;
  render(job: RenderJob): Promise<ResultInfo>;
  resultToLayer(i: number, name: string): Promise<SourceInfo>;
  preview(i: number, job: LayerJob): Promise<{ peak: number }>;
  stopPreview(): void;

  ensureAudio(): void;
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  allOff(): void;
  setSampler(p: SamplerParams): void;
  playState(): PlayState;
  onPlay: (() => void) | null;
  onParams: ((p: SamplerParams) => void) | null;
  onReload: (() => void) | null;

  saveProject(json: string): void;
  exportResult: (() => Promise<string | null>) | null;
  dragResult: (() => void) | null;
}

declare const __WORKER_SOURCE__: string;

type Pending = { resolve: (v: never) => void; reject: (e: Error) => void };

export class BrowserHost implements Host {
  readonly kind = "browser" as const;
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, Pending>();
  private sampler = new Sampler();
  private result: Float32Array[] | null = null;
  onPlay: (() => void) | null = null;
  onParams = null;
  onReload = null;
  exportResult = null;
  dragResult = null;

  constructor() {
    const url = URL.createObjectURL(new Blob([__WORKER_SOURCE__], { type: "text/javascript" }));
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data, p = m.req !== undefined ? this.pending.get(m.req) : undefined;
      if (!p) { if (m.type === "error") console.error(m.message); return; }
      this.pending.delete(m.req!);
      if (m.type === "error") p.reject(new Error(m.message)); else p.resolve(m as never);
    };
    this.sampler.onActivity = () => this.onPlay?.();
  }

  private call<T>(msg: WorkerRequest, transfer: Transferable[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.set((msg as { req: number }).req, { resolve: resolve as (v: never) => void, reject });
      this.worker.postMessage(msg, transfer);
    });
  }

  async start(): Promise<Restored | null> { return null; }

  async examples(sr: number): Promise<Float32Array[]> {
    const r = await this.call<{ sounds: Float32Array[] }>({ type: "examples", req: this.next++, sr });
    return r.sounds;
  }

  setSourceAudio(i: number, name: string, channels: Float32Array[]): SourceInfo {
    const info = { name, samples: channels[0].length, channels: channels.length };
    if (this.sampler.previewLayer === i) this.sampler.stopPreview();
    this.worker.postMessage({ type: "source", id: i, channels } satisfies WorkerRequest, channels.map((c) => c.buffer));
    return info;
  }

  async loadFile(i: number, file: File): Promise<SourceInfo> {
    const audio = await new OfflineAudioContext(2, 1, SR).decodeAudioData(await file.arrayBuffer());
    const n = Math.min(audio.length, MAX_SECONDS * SR), chs = Math.min(2, audio.numberOfChannels);
    const channels = Array.from({ length: chs }, (_, c) => audio.getChannelData(c).slice(0, n));
    return { ...this.setSourceAudio(i, file.name.replace(/\.[^.]+$/, ""), channels), trimmed: audio.duration > MAX_SECONDS };
  }

  pickFile(): null { return null; }

  spectrogram(i: number, pitch: number, grid: Grid, sr: number): Promise<SpectrogramImage> {
    return this.call({ type: "spectrogram", req: this.next++, id: i, pitch, grid, sr });
  }

  async render(job: RenderJob): Promise<ResultInfo> {
    const r = await this.call<{ channels: Float32Array[]; peak: number; ms: number; image: SpectrogramImage | null }>({ type: "render", req: this.next++, ...job });
    const n = r.channels[0]?.length ?? 0;
    this.result = n ? r.channels : null;
    this.sampler.setResult(this.result ?? [], SR);
    return { image: n ? r.image : null, peak: r.peak, ms: r.ms, duration: n / SR };
  }

  async resultToLayer(i: number, name: string): Promise<SourceInfo> {
    if (!this.result) throw new Error("Render something first");
    return this.setSourceAudio(i, name, this.result.map((c) => c.slice()));
  }

  async preview(i: number, job: LayerJob): Promise<{ peak: number }> {
    this.sampler.stopPreview();
    const r = await this.call<{ channels: Float32Array[]; peak: number }>({ type: "layer", req: this.next++, sr: SR, job });
    if (r.peak > 0) this.sampler.playPreview(i, r.channels, SR, r.peak);
    return { peak: r.peak };
  }
  stopPreview(): void { this.sampler.stopPreview(); }

  ensureAudio(): void { this.sampler.ensure(); }
  noteOn(note: number, velocity: number): void { this.sampler.noteOn(note, velocity); }
  noteOff(note: number): void { this.sampler.noteOff(note); }
  allOff(): void { this.sampler.allOff(); }
  setSampler(p: SamplerParams): void {
    this.sampler.root = p.root;
    this.sampler.env = { a: adsrMap.a(p.a), d: adsrMap.d(p.d), s: adsrMap.s(p.s), r: adsrMap.r(p.r) };
  }
  playState(): PlayState {
    const s = this.sampler;
    return { result: s.playhead(), preview: s.previewLayer, previewPos: s.previewPos(), voices: s.active };
  }

  saveProject(): void { /* the demo does not persist */ }
}

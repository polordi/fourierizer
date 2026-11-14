// The UI talks to its environment only through `Host`: loading sounds, the engine (spectrograms,
// renders, previews), playing notes and saving the project. Two implementations:
//   BrowserHost (here)            the demo: engine in a Web Worker, sampler in Web Audio
//   PluginHost (plugin-host.ts)   inside the plugin: everything in C++ through the JUCE bridge

import type { Grid } from "./dsp/stft.ts";
import type { Op } from "./dsp/ops.ts";
import type { Axis, SpectrogramImage } from "./dsp/spectrogram.ts";
import { SPECTRAL_N, type SpectralWindow } from "./dsp/spectral.ts";
import type { LayerJob, WorkerReply, WorkerRequest } from "./protocol.ts";
import { Sampler } from "./audio/sampler.ts";
import { MAX_SECONDS, SR, adsrMap } from "./model.ts";

export interface SourceInfo { name: string; samples: number; channels: number; trimmed?: boolean; }
export interface ResultInfo { image: SpectrogramImage | null; peak: number; ms: number; duration: number; }
/** spectralReady / spectralTotal: Spectral copies already computed among the ±12 st computed ahead. */
export interface PlayState { result: number; preview: number; previewPos: number; voices: number; spectralReady?: number; spectralTotal?: number; }
export interface SamplerParams {
  a: number; d: number; s: number; r: number; root: number;
  mode?: "tape" | "spectral"; window?: SpectralWindow;
}
export interface Restored { project: string | null; layers: (SourceInfo | null)[]; result: ResultInfo | null; params: SamplerParams | null; }
export interface RenderJob { sr: number; op: Op; a: number; b: number; layers: LayerJob[]; all: (LayerJob | null)[]; axis: Axis; }

export interface Host {
  readonly kind: "browser" | "plugin";
  /** Plugin: the saved project (if any). Browser: null (the demo loads examples). */
  start(): Promise<Restored | null>;
  examples(sr: number): Promise<Float32Array[]>;
  setSourceAudio(i: number, name: string, channels: Float32Array[]): SourceInfo;
  loadFile(i: number, file: File): Promise<SourceInfo>;
  /** Native file dialog (plugin), or null when the UI should use its own <input type=file>. */
  pickFile(i: number): Promise<SourceInfo | null> | null;
  clearSource(i: number): void;
  spectrogram(i: number, pitch: number, grid: Grid, sr: number, axis: Axis): Promise<SpectrogramImage>;
  render(job: RenderJob): Promise<ResultInfo>;
  /** The current result's display image on another axis (null without a result). */
  resultImage(axis: Axis): Promise<SpectrogramImage | null>;
  clearResult(): void;
  resultToLayer(i: number, name: string): Promise<SourceInfo>;
  /** Play a layer once: its selection, and in sync its original sound for A/B (`original`). */
  preview(i: number, job: LayerJob, original: boolean): Promise<{ peak: number }>;
  setPreviewOriginal(on: boolean): void;
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
    this.sampler.shifted = (shift) => this.shiftedBuffer(shift);
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

  clearSource(i: number): void {
    if (this.sampler.previewLayer === i) this.sampler.stopPreview();
    this.worker.postMessage({ type: "clear", id: i } satisfies WorkerRequest);
  }

  spectrogram(i: number, pitch: number, grid: Grid, sr: number, axis: Axis): Promise<SpectrogramImage> {
    return this.call({ type: "spectrogram", req: this.next++, id: i, pitch, grid, sr, axis });
  }

  async resultImage(axis: Axis): Promise<SpectrogramImage | null> {
    if (!this.result) return null;
    const copies = this.result.map((c) => c.slice());
    const r = await this.call<{ image: SpectrogramImage | null }>({ type: "image", req: this.next++, sr: SR, channels: copies, axis }, copies.map((c) => c.buffer));
    return r.image;
  }

  clearResult(): void { this.result = null; this.sampler.setResult([], SR); this.resetBank(); }

  async render(job: RenderJob): Promise<ResultInfo> {
    const r = await this.call<{ channels: Float32Array[]; peak: number; ms: number; image: SpectrogramImage | null }>({ type: "render", req: this.next++, ...job });
    const n = r.channels[0]?.length ?? 0;
    this.result = n ? r.channels : null;
    this.sampler.setResult(this.result ?? [], SR);
    this.resetBank();
    return { image: n ? r.image : null, peak: r.peak, ms: r.ms, duration: n / SR };
  }

  async resultToLayer(i: number, name: string): Promise<SourceInfo> {
    if (!this.result) throw new Error("Render something first");
    return this.setSourceAudio(i, name, this.result.map((c) => c.slice()));
  }

  async preview(i: number, job: LayerJob, original: boolean): Promise<{ peak: number }> {
    this.sampler.stopPreview();
    const r = await this.call<{ channels: Float32Array[]; peak: number; original: Float32Array[]; peakOriginal: number }>({ type: "layer", req: this.next++, sr: SR, job });
    const peak = Math.max(r.peak, r.peakOriginal);   // one gain for both, so A/B compares fairly
    if (peak > 0) this.sampler.playPreview(i, r.channels, r.original, SR, peak > 0.977 ? 0.977 / peak : 1, original);
    return { peak: original ? r.peakOriginal : r.peak };
  }
  setPreviewOriginal(on: boolean): void { this.sampler.setPreviewOriginal(on); }
  stopPreview(): void { this.sampler.stopPreview(); }

  ensureAudio(): void { this.sampler.ensure(); }
  noteOn(note: number, velocity: number): void { this.sampler.noteOn(note, velocity); }
  noteOff(note: number): void { this.sampler.noteOff(note); }
  allOff(): void { this.sampler.allOff(); }
  setSampler(p: SamplerParams): void {
    this.sampler.root = p.root;
    if (p.window && p.window !== this.window) { this.window = p.window; this.resetBank(); }
    if (p.mode && p.mode !== this.sampler.mode) { this.sampler.mode = p.mode; this.pump(); this.onPlay?.(); }
    this.sampler.env = { a: adsrMap.a(p.a), d: adsrMap.d(p.d), s: adsrMap.s(p.s), r: adsrMap.r(p.r) };
  }
  playState(): PlayState {
    const s = this.sampler;
    let ready = 0;
    for (const k of this.shifted.keys()) if (Math.abs(k) <= 12) ready++;
    const total = this.sampler.mode === "spectral" && this.result ? 24 : 0;
    return { result: s.playhead(), preview: s.previewLayer, previewPos: s.previewPos(), voices: s.active, spectralReady: ready, spectralTotal: total };
  }

  // ---- Spectral mode: copies of the result shifted by whole semitones, computed by the worker
  // one at a time: first the notes that were played, then ±12 st around the root.
  private window: SpectralWindow = "tonal";
  private bankGen = 0;
  private shifted = new Map<number, { channels: Float32Array[]; buffer: AudioBuffer | null }>();
  private wanted: number[] = [];
  private waiters = new Map<number, ((ok: boolean) => void)[]>();
  private computing = false;

  /** A new result or window: every copy is stale. */
  private resetBank(): void {
    this.bankGen++;
    this.shifted.clear();
    this.wanted = [];
    for (const ws of this.waiters.values()) ws.forEach((w) => w(false));
    this.waiters.clear();
    this.pump();
    this.onPlay?.();
  }

  private shiftedBuffer(shift: number): AudioBuffer | Promise<AudioBuffer | null> {
    const e = this.shifted.get(shift);
    if (e) return (e.buffer ??= this.sampler.makeBuffer(e.channels, SR));
    return new Promise((resolve) => {
      const list = this.waiters.get(shift) ?? [];
      list.push((ok) => resolve(ok ? this.shiftedBuffer(shift) as AudioBuffer : null));
      this.waiters.set(shift, list);
      this.wanted = [shift, ...this.wanted.filter((x) => x !== shift)];
      this.pump();
    });
  }

  private nextShift(): number | null {
    while (this.wanted.length) { const s = this.wanted.shift()!; if (!this.shifted.has(s)) return s; }
    if (this.sampler.mode !== "spectral") return null;
    for (let d = 1; d <= 12; d++) for (const s of [d, -d]) if (!this.shifted.has(s)) return s;
    return null;
  }

  private pump(): void {
    if (this.computing || !this.result) return;
    const shift = this.nextShift();
    if (shift === null) return;
    this.computing = true;
    const gen = this.bankGen;
    this.call<{ channels: Float32Array[] }>({ type: "shift", req: this.next++, semitones: shift, n: SPECTRAL_N[this.window] })
      .then((r) => {
        if (gen !== this.bankGen || !r.channels.length) return;
        this.shifted.set(shift, { channels: r.channels, buffer: null });
        const ws = this.waiters.get(shift);
        this.waiters.delete(shift);
        ws?.forEach((w) => w(true));
        this.onPlay?.();
      })
      .catch((e: Error) => console.error(e))
      .finally(() => { this.computing = false; this.pump(); });
  }

  saveProject(): void { /* the demo does not persist */ }
}

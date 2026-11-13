// Host inside the plugin: every request goes to C++ (plugin/source/PluginEditor.cpp) through the
// JUCE WebView bridge. Calls are "native functions": the page emits `__juce__invoke` and C++
// answers with `__juce__complete`. Binary data (spectrogram images) is fetched from /data/<key>,
// served by the plugin's resource provider; audio files go up in base64 chunks.

import type { Grid } from "./dsp/stft.ts";
import type { Axis, SpectrogramImage } from "./dsp/spectrogram.ts";
import type { LayerJob } from "./protocol.ts";
import type { Host, PlayState, RenderJob, Restored, ResultInfo, SamplerParams, SourceInfo } from "./host.ts";

interface JuceBackend {
  emitEvent(id: string, payload: unknown): void;
  addEventListener(id: string, fn: (payload: never) => void): unknown;
}
declare global { interface Window { __JUCE__?: { backend: JuceBackend; initialisationData: Record<string, unknown> } } }

export const insidePlugin = (): boolean => typeof window !== "undefined" && !!window.__JUCE__?.backend;

interface ImageRef { key: string; cols: number; rows: number; }
type Maybe<T> = T | { error: string };

const CHUNK = 1536 * 1024; // raw bytes per upload call (2 MB of base64)

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export class PluginHost implements Host {
  readonly kind = "plugin" as const;
  private backend: JuceBackend;
  private nextId = 0;
  private waiting = new Map<number, (v: unknown) => void>();
  private play: PlayState = { result: -1, preview: -1, previewPos: -1, voices: 0 };
  onPlay: (() => void) | null = null;
  onParams: ((p: SamplerParams) => void) | null = null;
  onReload: (() => void) | null = null;

  constructor() {
    this.backend = window.__JUCE__!.backend;
    this.backend.addEventListener("__juce__complete", ({ promiseId, result }: { promiseId: number; result: unknown }) => {
      const r = this.waiting.get(promiseId);
      if (r) { this.waiting.delete(promiseId); r(result); }
    });
    this.backend.addEventListener("play", (p: PlayState) => { this.play = p; this.onPlay?.(); });
    this.backend.addEventListener("params", (p: SamplerParams) => this.onParams?.(p));
    this.backend.addEventListener("projectLoaded", () => this.onReload?.());
  }

  private call<T>(name: string, ...params: unknown[]): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      this.waiting.set(id, resolve as (v: unknown) => void);
      this.backend.emitEvent("__juce__invoke", { name, params, resultId: id });
    });
  }

  private async checked<T>(name: string, ...params: unknown[]): Promise<T> {
    const r = await this.call<Maybe<T>>(name, ...params);
    if (r && typeof r === "object" && "error" in r) throw new Error(r.error === "unsupported" ? "Could not read this file. Try WAV, AIFF, FLAC, MP3 or OGG." : r.error);
    return r as T;
  }

  private async image(ref: ImageRef | null | undefined): Promise<SpectrogramImage | null> {
    if (!ref) return null;
    const res = await fetch(`/data/${ref.key}`);
    if (!res.ok) throw new Error(`could not fetch ${ref.key}`);
    return { data: new Uint8Array(await res.arrayBuffer()), cols: ref.cols, rows: ref.rows };
  }

  private async resultInfo(r: { peak: number; ms: number; duration: number; image: ImageRef | null } | null): Promise<ResultInfo | null> {
    if (!r || typeof r !== "object") return null;
    return { peak: r.peak, ms: r.ms, duration: r.duration, image: await this.image(r.image) };
  }

  async start(): Promise<Restored | null> {
    const r = await this.call<{ project: string | null; layers: (SourceInfo | null)[]; result: Parameters<PluginHost["resultInfo"]>[0]; params: SamplerParams }>("loadProject");
    return { project: r.project ?? null, layers: r.layers.map((l) => (l && typeof l === "object" ? l : null)), result: await this.resultInfo(r.result), params: r.params };
  }

  async examples(): Promise<Float32Array[]> { return []; }
  setSourceAudio(): SourceInfo { throw new Error("not available in the plugin"); }

  async loadFile(i: number, file: File): Promise<SourceInfo> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = await this.call<number>("uploadBegin");
    for (let at = 0; at < bytes.length; at += CHUNK) await this.call("uploadChunk", id, toBase64(bytes.subarray(at, at + CHUNK)));
    return this.checked<SourceInfo>("uploadEnd", id, i, file.name.replace(/\.[^.]+$/, ""));
  }

  pickFile(i: number): Promise<SourceInfo | null> {
    return this.call<Maybe<SourceInfo> | null>("pickFile", i).then((r) => {
      if (r && typeof r === "object" && "error" in r) throw new Error("Could not read this file. Try WAV, AIFF, FLAC, MP3 or OGG.");
      return (r && typeof r === "object" ? r : null) as SourceInfo | null;
    });
  }

  clearSource(i: number): void { void this.call("clearLayer", i); }

  async spectrogram(i: number, pitch: number, grid: Grid, _sr: number, axis: Axis): Promise<SpectrogramImage> {
    const r = await this.checked<ImageRef & { duration: number }>("spectrogram", i, pitch, grid, axis);
    return (await this.image(r))!;
  }

  async resultImage(axis: Axis): Promise<SpectrogramImage | null> {
    const r = await this.call<ImageRef | null>("resultImage", axis);
    return r && typeof r === "object" && "key" in r ? this.image(r) : null;
  }

  clearResult(): void { void this.call("clearResult"); }

  async render(job: RenderJob): Promise<ResultInfo> {
    const r = await this.checked<{ peak: number; ms: number; duration: number; image: ImageRef | null }>("render", job);
    return (await this.resultInfo(r))!;
  }

  resultToLayer(i: number, name: string): Promise<SourceInfo> { return this.checked<SourceInfo>("resultToLayer", i, name); }
  preview(_i: number, job: LayerJob, original: boolean): Promise<{ peak: number }> { return this.checked<{ peak: number }>("preview", job, original); }
  setPreviewOriginal(on: boolean): void { void this.call("setPreviewOriginal", on); }
  stopPreview(): void { void this.call("stopPreview"); }

  ensureAudio(): void { /* the host owns the audio device */ }
  noteOn(note: number, velocity: number): void { void this.call("noteOn", note, velocity); }
  noteOff(note: number): void { void this.call("noteOff", note); }
  allOff(): void { void this.call("allOff"); }
  setSampler(p: SamplerParams): void { void this.call("setParams", p); }
  playState(): PlayState { return this.play; }

  saveProject(json: string): void { void this.call("saveProject", json); }
  exportResult = (): Promise<string | null> => this.checked<string | null>("exportResult").then((r) => (typeof r === "string" ? r : null));
  dragResult = (): void => { void this.call("dragResult"); };
}

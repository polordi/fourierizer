// Browser sampler for the demo: plays the rendered result polyphonically in Tape mode
// (playback rate 2^((note − root)/12)) with an ADSR per voice. In the plugin this is the C++
// sampler on the audio thread; the UI only sends notes and parameters.

interface Voice { src: AudioBufferSourceNode; gain: GainNode; start: number; rate: number; note: number; }

export interface Envelope { a: number; d: number; s: number; r: number; }

export class Sampler {
  ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private pending: { channels: Float32Array[]; sr: number } | null = null;
  private master: GainNode | null = null;
  private voices: Voice[] = [];
  root = 48;
  env: Envelope = { a: 0.06, d: 0.45, s: 0.7, r: 0.8 };
  onActivity: (() => void) | null = null;

  /** Create or resume the AudioContext; must be called from a user gesture. */
  ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
      if (this.pending) { this.setResult(this.pending.channels, this.pending.sr); this.pending = null; }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  get ready(): boolean { return !!this.ctx && !!this.buffer; }
  get duration(): number { return this.buffer?.duration ?? 0; }

  setResult(channels: Float32Array[], sr: number): void {
    if (!this.ctx) { this.pending = { channels, sr }; return; }
    if (!channels.length || !channels[0].length) { this.buffer = null; return; }
    const b = this.ctx.createBuffer(channels.length, channels[0].length, sr);
    channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    this.buffer = b;
  }

  noteOn(note: number, velocity = 0.9): void {
    const ctx = this.ensure();
    if (!this.buffer || !this.master) return;
    if (this.voices.length >= 24) this.release(this.voices[0], ctx.currentTime);
    const now = ctx.currentTime, rate = 2 ** ((note - this.root) / 12);
    const src = ctx.createBufferSource(), gain = ctx.createGain();
    src.buffer = this.buffer; src.playbackRate.value = rate;
    const { a, d, s } = this.env, peak = velocity;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + a);
    gain.gain.setTargetAtTime(peak * s, now + a, Math.max(0.001, d / 3));
    src.connect(gain).connect(this.master);
    src.start(now);
    const v: Voice = { src, gain, start: now, rate, note };
    src.onended = () => { this.voices = this.voices.filter((x) => x !== v); this.onActivity?.(); };
    this.voices.push(v);
    this.onActivity?.();
  }

  noteOff(note: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const v of this.voices) if (v.note === note && !(v as Voice & { off?: boolean }).off) this.release(v, now);
  }

  allOff(): void { if (this.ctx) for (const v of this.voices) this.release(v, this.ctx.currentTime); }

  private release(v: Voice, now: number): void {
    (v as Voice & { off?: boolean }).off = true;
    const g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + this.env.r);
    try { v.src.stop(now + this.env.r + 0.02); } catch { /* already stopped */ }
  }

  // ---- layer preview: one-shot playback of a single layer's selection, outside the keyboard voices
  private preview: { src: AudioBufferSourceNode; gain: GainNode; start: number; dur: number; layer: number } | null = null;
  onPreviewEnd: ((layer: number) => void) | null = null;

  /** Play `channels` once (peaks above −0.2 dBFS are scaled down, never up). */
  playPreview(layer: number, channels: Float32Array[], sr: number, peak: number): void {
    const ctx = this.ensure();
    this.stopPreview();
    if (!this.master || !channels.length || !channels[0].length) return;
    const b = ctx.createBuffer(channels.length, channels[0].length, sr);
    channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    const src = ctx.createBufferSource(), gain = ctx.createGain(), now = ctx.currentTime;
    src.buffer = b;
    gain.gain.value = peak > 0.977 ? 0.977 / peak : 1;
    src.connect(gain).connect(this.master);
    src.start(now);
    this.preview = { src, gain, start: now, dur: b.duration, layer };
    src.onended = () => { if (this.preview?.src === src) { this.preview = null; this.onPreviewEnd?.(layer); } };
    this.onActivity?.();
  }

  stopPreview(): void {
    const p = this.preview;
    if (!p || !this.ctx) return;
    this.preview = null;
    const now = this.ctx.currentTime, g = p.gain.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.015);
    try { p.src.stop(now + 0.02); } catch { /* already stopped */ }
    this.onPreviewEnd?.(p.layer);
  }

  /** Layer being previewed (−1 if none) and the position (0..1) in its selection. */
  get previewLayer(): number { return this.preview?.layer ?? -1; }
  previewPos(): number {
    if (!this.ctx || !this.preview) return -1;
    const pos = (this.ctx.currentTime - this.preview.start) / this.preview.dur;
    return pos >= 0 && pos <= 1 ? pos : -1;
  }

  /** Position (0..1) in the buffer of the most recent sounding voice, or −1. */
  playhead(): number {
    if (!this.ctx || !this.buffer || !this.voices.length) return -1;
    const v = this.voices[this.voices.length - 1];
    const pos = (this.ctx.currentTime - v.start) * v.rate / this.buffer.duration;
    return pos >= 0 && pos <= 1 ? pos : -1;
  }

  get active(): number { return this.voices.length; }
}

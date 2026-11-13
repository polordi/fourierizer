// Engine worker: holds the source audio and does every heavy computation off the UI thread.
// In the plugin this role moves to the C++ core behind the same messages (see host.ts).

import { makeExamples } from "./dsp/examples.ts";
import { tapePitch } from "./dsp/resample.ts";
import { synthesizeLayer, mix, peakOf } from "./dsp/render.ts";
import { renderOp, type Op } from "./dsp/ops.ts";
import { spectrogramImage } from "./dsp/spectrogram.ts";
import type { Shape } from "./dsp/mask.ts";
import type { Grid } from "./dsp/stft.ts";
import type { WorkerRequest } from "./protocol.ts";

const ctx = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

const sources = new Map<number, Float32Array[]>();
const pitched = new Map<string, Float64Array[]>();

function pitchedSource(id: number, st: number): Float64Array[] {
  const key = `${id}:${st}`;
  let p = pitched.get(key);
  if (!p) {
    const src = sources.get(id);
    if (!src) throw new Error(`no audio in layer ${id + 1}`);
    p = src.map((c) => tapePitch(c, st));
    for (const k of pitched.keys()) if (k.startsWith(`${id}:`)) pitched.delete(k);
    pitched.set(key, p);
  }
  return p;
}

function mid(chs: ArrayLike<number>[]): Float64Array {
  const n = chs[0].length, m = new Float64Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) m[i] += c[i] / chs.length;
  return m;
}

const RESULT_GRID: Grid = { window: "hann", L: 2048, N: 2048, H: 256 };

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "examples": {
        const xs = makeExamples(msg.sr);
        ctx.postMessage({ type: "examples", req: msg.req, sounds: xs }, xs.map((x) => x.buffer));
        break;
      }
      case "source":
        sources.set(msg.id, msg.channels);
        for (const k of pitched.keys()) if (k.startsWith(`${msg.id}:`)) pitched.delete(k);
        break;
      case "clear":
        sources.delete(msg.id);
        for (const k of pitched.keys()) if (k.startsWith(`${msg.id}:`)) pitched.delete(k);
        break;
      case "image": {
        const img = msg.channels.length && msg.channels[0].length ? spectrogramImage(mid(msg.channels), msg.sr, RESULT_GRID, 1400, 300, msg.axis) : null;
        ctx.postMessage({ type: "image", req: msg.req, image: img }, img ? [img.data.buffer] : []);
        break;
      }
      case "spectrogram": {
        const x = mid(pitchedSource(msg.id, msg.pitch));
        const img = spectrogramImage(x, msg.sr, msg.grid, 1400, 360, msg.axis);
        ctx.postMessage({ type: "spectrogram", req: msg.req, id: msg.id, ...img, duration: x.length / msg.sr }, [img.data.buffer]);
        break;
      }
      case "render": {
        const t0 = performance.now();
        const active = msg.layers;
        let out: Float64Array[];
        if (msg.op === "sum") {
          out = mix(active.map((l) => ({
            y: synthesizeLayer({ channels: pitchedSource(l.id, l.pitch), grid: l.grid, shapes: l.shapes as Shape[], featherS: l.featherS, featherOct: l.featherOct }, msg.sr),
            gainDb: l.gainDb, offsetS: l.offsetS,
          })), msg.sr, 2, -0.3);
        } else {
          const all = msg.all.map((l) => l && ({
            channels: pitchedSource(l.id, l.pitch), shapes: l.shapes as Shape[], featherS: l.featherS, featherOct: l.featherOct, gainDb: l.gainDb, offsetS: l.offsetS,
          }));
          const list = msg.op === "max" ? all.filter((l) => l) : all;
          out = renderOp(list as never, msg.op as Exclude<Op, "sum">, msg.sr, msg.a, msg.b);
        }
        const peakLin = peakOf(out);
        const chans = out.map((c) => Float32Array.from(c));
        const img = chans.length && chans[0].length ? spectrogramImage(mid(chans), msg.sr, RESULT_GRID, 1400, 300, msg.axis) : null;
        const transfer: Transferable[] = chans.map((c) => c.buffer);
        if (img) transfer.push(img.data.buffer);
        ctx.postMessage({ type: "render", req: msg.req, channels: chans, peak: peakLin, ms: performance.now() - t0, image: img }, transfer);
        break;
      }
      case "layer": {
        const l = msg.job;
        const y = synthesizeLayer({ channels: pitchedSource(l.id, l.pitch), grid: l.grid, shapes: l.shapes as Shape[], featherS: l.featherS, featherOct: l.featherOct }, msg.sr);
        const chans = y.map((c) => Float32Array.from(c));
        const src = pitchedSource(l.id, l.pitch), orig = src.map((c) => Float32Array.from(c));
        ctx.postMessage({ type: "layer", req: msg.req, channels: chans, peak: peakOf(y), original: orig, peakOriginal: peakOf(src) },
          [...chans.map((c) => c.buffer), ...orig.map((c) => c.buffer)]);
        break;
      }
    }
  } catch (err) {
    ctx.postMessage({ type: "error", req: (msg as { req?: number }).req, message: (err as Error).message });
  }
};

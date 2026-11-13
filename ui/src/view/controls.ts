// Controls, one per parameter type (design system): Knob, MiniKnob, Stepper, Segmented, Fader.
// Each reads its value through get() and writes through set(), and refresh() repaints it.

import { h, icon, s } from "./dom.ts";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Vertical drag on `el` changes a 0..1 position; Shift for fine control. */
function dragVertical(el: HTMLElement, get: () => number, set: (v: number) => void, pxPerUnit = 150): void {
  let y0 = 0, v0 = 0;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = get(); e.preventDefault();
  });
  el.addEventListener("pointermove", (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    set(clamp(v0 + (y0 - e.clientY) / (e.shiftKey ? pxPerUnit * 4 : pxPerUnit), 0, 1));
  });
}

export interface KnobOpts {
  label: string;
  get: () => number;            // 0..1
  set: (v: number) => void;
  format: (v: number) => string;
  reset: number;
  aria?: string;
}

export class Knob {
  readonly el: HTMLElement;
  private cap: HTMLElement;
  private lines: SVGLineElement[] = [];
  private out: HTMLElement;
  private dial: HTMLElement;
  private o: KnobOpts;
  constructor(o: KnobOpts, layerClass = "fz-l0") {
    this.o = o;
    const svg = s("svg", { viewBox: "0 0 72 72", "aria-hidden": "true" });
    for (let i = 0; i < 11; i++) {
      const a = (-135 + i * 27 - 90) * Math.PI / 180;
      const l = s("line", { x1: 36 + 31 * Math.cos(a), y1: 36 + 31 * Math.sin(a), x2: 36 + 35 * Math.cos(a), y2: 36 + 35 * Math.sin(a), "stroke-width": 1.5 });
      svg.append(l); this.lines.push(l);
    }
    this.cap = h("div", { class: "cap" });
    this.dial = h("div", { class: "dial focusable", tabindex: 0, role: "slider", "aria-label": o.aria ?? o.label, "aria-valuemin": 0, "aria-valuemax": 1 }, svg, this.cap);
    this.out = h("span", { class: "ro" });
    this.el = h("div", { class: `knob ${layerClass}` }, this.dial, this.out, h("span", { class: "silk" }, o.label));
    dragVertical(this.dial, o.get, (v) => { o.set(v); this.refresh(false); });
    this.dial.addEventListener("dblclick", () => { o.set(o.reset); this.refresh(true); });
    this.dial.addEventListener("keydown", (e) => {
      const d = ({ ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02 } as Record<string, number>)[e.key];
      if (d) { e.preventDefault(); o.set(clamp(o.get() + d, 0, 1)); this.refresh(true); }
    });
    this.refresh(false);
  }
  refresh(spring = false): void {
    const v = this.o.get();
    this.cap.classList.toggle("spring", spring);
    this.cap.style.transform = `rotate(${-135 + 270 * v}deg)`;
    const on = Math.round(v * 10);
    this.lines.forEach((l, i) => l.setAttribute("stroke", i <= on ? "#16181A" : "#B7BDC3"));
    const txt = this.o.format(v);
    this.out.textContent = txt;
    this.dial.setAttribute("aria-valuenow", v.toFixed(2)); this.dial.setAttribute("aria-valuetext", txt);
  }
}

export class MiniKnob {
  readonly el: HTMLElement;
  private ind: HTMLElement;
  private out: HTMLElement;
  private mk: HTMLElement;
  private o: KnobOpts;
  constructor(o: KnobOpts) {
    this.o = o;
    this.ind = h("i");
    this.mk = h("span", { class: "mk focusable", tabindex: 0, role: "slider", "aria-label": o.aria ?? o.label }, this.ind);
    this.out = h("span", { class: "ro-sm ink" });
    this.el = h("span", { class: "mini" }, this.mk, h("span", { class: "lbl" }, h("span", { class: "silk sm" }, o.label), this.out));
    dragVertical(this.mk, o.get, (v) => { o.set(v); this.refresh(); });
    this.mk.addEventListener("dblclick", () => { o.set(o.reset); this.refresh(true); });
    this.mk.addEventListener("keydown", (e) => {
      const d = ({ ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02 } as Record<string, number>)[e.key];
      if (d) { e.preventDefault(); o.set(clamp(o.get() + d, 0, 1)); this.refresh(true); }
    });
    this.refresh();
  }
  refresh(spring = false): void {
    const v = this.o.get();
    this.ind.classList.toggle("spring", spring);
    this.ind.style.transform = `rotate(${-135 + 270 * v}deg)`;
    this.out.textContent = this.o.format(v);
    this.mk.setAttribute("aria-valuetext", this.o.format(v));
  }
}

export interface StepperOpts {
  label: string;
  display: () => string;
  derived?: () => string;
  step: (dir: 1 | -1, fine: boolean) => void;
  canStep?: (dir: 1 | -1) => boolean;
  dragPx?: number;
}

export class Stepper {
  readonly el: HTMLElement;
  private val: HTMLElement;
  private der: HTMLElement;
  private dec: HTMLButtonElement;
  private inc: HTMLButtonElement;
  private o: StepperOpts;
  constructor(o: StepperOpts) {
    this.o = o;
    this.dec = h("button", { class: "btn", type: "button", "aria-label": `Decrease ${o.label}` }, "−");
    this.inc = h("button", { class: "btn", type: "button", "aria-label": `Increase ${o.label}` }, "+");
    this.val = h("div", { class: "val ro-lg", "aria-live": "polite", title: "Drag up or down, or scroll" });
    this.der = h("span", { class: "ro-sm" });
    this.el = h("div", { class: "stepper" }, h("span", { class: "silk" }, o.label), h("div", { class: "body" }, this.dec, this.val, this.inc), this.der);
    this.dec.addEventListener("click", (e) => { o.step(-1, e.shiftKey); this.refresh(); });
    this.inc.addEventListener("click", (e) => { o.step(1, e.shiftKey); this.refresh(); });
    let y0 = 0, acc = 0;
    const px = o.dragPx ?? 8;
    this.val.addEventListener("pointerdown", (e) => { this.val.setPointerCapture(e.pointerId); y0 = e.clientY; acc = 0; e.preventDefault(); });
    this.val.addEventListener("pointermove", (e) => {
      if (!this.val.hasPointerCapture(e.pointerId)) return;
      acc += y0 - e.clientY; y0 = e.clientY;
      while (Math.abs(acc) >= px) { const d = acc > 0 ? 1 : -1; o.step(d, e.shiftKey); acc -= d * px; }
      this.refresh();
    });
    this.val.addEventListener("wheel", (e) => { e.preventDefault(); o.step(e.deltaY < 0 ? 1 : -1, e.shiftKey); this.refresh(); }, { passive: false });
    this.refresh();
  }
  refresh(): void {
    this.val.textContent = this.o.display();
    this.der.textContent = this.o.derived ? this.o.derived() : "";
    if (this.o.canStep) { this.dec.disabled = !this.o.canStep(-1); this.inc.disabled = !this.o.canStep(1); }
  }
}

export interface SegOption { id: string; label: string; icon?: SVGElement; disabled?: boolean; title?: string; cls?: string; aria?: string; }

export class Segmented {
  readonly el: HTMLElement;
  private opts: { id: string; b: HTMLButtonElement }[];
  private get: () => string;
  constructor(label: string | null, options: SegOption[], get: () => string, set: (id: string) => void, extra = "") {
    this.get = get;
    const group = h("div", { class: `seg ${extra}`, role: "radiogroup", "aria-label": label ?? undefined });
    this.opts = options.map((o) => {
      const b = h("button", { class: `seg-opt ${o.cls ?? ""}`, type: "button", role: "radio", disabled: o.disabled, title: o.title, "aria-label": o.aria }, o.icon ?? null, h("span", {}, o.label));
      b.addEventListener("click", () => { if (!o.disabled) { set(o.id); this.refresh(); } });
      group.append(b);
      return { id: o.id, b };
    });
    this.el = label ? h("div", { style: "display:grid;gap:6px" }, h("span", { class: "silk" }, label), group) : group;
    this.refresh();
  }
  refresh(): void { const v = this.get(); for (const o of this.opts) o.b.setAttribute("aria-checked", String(o.id === v)); }
}

/** Fader position v ↔ gain: dB = 20·log10(2v²) (0.707 = 0 dB, 1 = +6 dB). */
export const faderToDb = (v: number) => v < 0.005 ? -Infinity : 20 * Math.log10(2 * v * v);
export const dbToFader = (db: number) => db === -Infinity ? 0 : Math.sqrt(10 ** (db / 20) / 2);
export const fmtDb = (db: number) => db === -Infinity ? "−∞" : (Math.abs(db) < 0.05 ? "0.0" : db.toFixed(1).replace("-", "−"));

export class Fader {
  readonly el: HTMLElement;
  private fill: HTMLElement;
  private cap: HTMLElement;
  private out: HTMLElement;
  private slot: HTMLElement;
  private get: () => number;
  constructor(label: string, layerClass: string, get: () => number, set: (db: number) => void) {
    this.get = get;
    this.fill = h("div", { class: "fill" });
    this.cap = h("div", { class: "fcap" });
    this.out = h("span", { class: "ro", style: "font-size:12px" });
    this.slot = h("div", { class: "slot focusable", tabindex: 0, role: "slider", "aria-label": `${label} level` }, h("div", { class: "track" }, this.fill), this.cap);
    this.el = h("div", { class: `fader ${layerClass}` }, this.out, this.slot, h("span", { class: "silk" }, label));
    const H = 150, C = 16;
    const move = (e: PointerEvent) => {
      const r = this.slot.getBoundingClientRect();
      set(faderToDb(clamp(1 - (e.clientY - r.top - C / 2) / (H - C), 0, 1))); this.refresh();
    };
    this.slot.addEventListener("pointerdown", (e) => { this.slot.setPointerCapture(e.pointerId); move(e); });
    this.slot.addEventListener("pointermove", (e) => { if (this.slot.hasPointerCapture(e.pointerId)) move(e); });
    this.slot.addEventListener("dblclick", () => { set(0); this.refresh(); });
    this.slot.addEventListener("keydown", (e) => {
      const d = ({ ArrowUp: 0.02, ArrowDown: -0.02 } as Record<string, number>)[e.key];
      if (d) { e.preventDefault(); set(faderToDb(clamp(dbToFader(get()) + d, 0, 1))); this.refresh(); }
    });
    this.refresh();
  }
  refresh(): void {
    const H = 150, C = 16, v = dbToFader(this.get()), y = (1 - v) * (H - C);
    this.cap.style.top = `${y}px`;
    this.fill.style.height = `${Math.max(0, H - y - C / 2 - 3)}px`;
    this.out.textContent = fmtDb(this.get());
    this.slot.setAttribute("aria-valuetext", `${fmtDb(this.get())} dB`);
  }
}

export function key(label: string | null, iconPaths: string | null, attrs: Record<string, string | boolean | undefined> = {}, onClick?: (e: MouseEvent) => void): HTMLButtonElement {
  const b = h("button", { class: `key ${attrs.class ?? ""}`, type: "button", ...Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== "class")) },
    iconPaths ? icon(iconPaths) : null, label ? h("span", {}, label) : null);
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

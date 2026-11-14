// Takes: the iteration history. Every kept result (Keep, or Send to layer) is listed with a small
// spectrogram, its recipe (which sound was in each layer, and from which take it came) and
// actions: listen, restore the whole project as it was, send it to a layer, rename, delete.

import type { TakeInfo } from "../host.ts";
import type { Look } from "../dsp/spectrogram.ts";
import { OPS } from "../dsp/ops.ts";
import { h, ICONS } from "./dom.ts";
import { confirmKey, key } from "./controls.ts";
import { paintSpectrogram } from "./layer.ts";
import { HELP } from "./help.ts";

export interface TakesHost {
  takes(): TakeInfo[];
  look(): Look;
  current(): number | null;          // the take the result is (if it was kept)
  playing(): number | null;          // the take being previewed
  preview(id: number): void;         // toggles
  restore(id: number): void;
  toLayer(id: number, layer: number): void;
  remove(id: number): void;
  rename(id: number, name: string): void;
}

export class TakesPanel {
  readonly el: HTMLElement;
  private button: HTMLButtonElement;
  private panel: HTMLElement;
  private list: HTMLElement;
  private host: TakesHost;

  constructor(host: TakesHost) {
    this.host = host;
    this.list = h("div", { class: "takelist" });
    this.panel = h("div", { class: "takespanel fz-l0", hidden: true, role: "dialog", "aria-label": "Takes" },
      h("div", { class: "row" }, h("span", { class: "silk" }, "Takes"), h("span", { class: "grow" }), h("span", { class: "ro-sm" }, "Keep a result to add it here")),
      this.list);
    this.button = key("Takes", ICONS.takes, { class: "sm", "aria-expanded": "false", title: HELP.takes }, () => this.toggle());
    this.el = h("div", { class: "displaywrap" }, this.button, this.panel);
    document.addEventListener("pointerdown", (e) => {
      if (!this.panel.hidden && !this.el.contains(e.target as Node)) this.toggle(false);
    });
    this.refresh();
  }

  toggle(open = this.panel.hidden): void {
    this.panel.hidden = !open;
    this.button.setAttribute("aria-pressed", String(open));
    this.button.setAttribute("aria-expanded", String(open));
    if (open) this.refresh();
  }

  refresh(): void {
    const takes = this.host.takes();
    const label = this.button.querySelector("span:last-child");
    if (label) label.textContent = takes.length ? `Takes ${takes.length}` : "Takes";
    if (this.panel.hidden) return;
    if (!takes.length) {
      this.list.replaceChildren(h("div", { class: "takeempty ro-sm" },
        "No takes yet. Press Keep on the result, or Send to layer: each result is saved here with its recipe, so you can hear it, restore it or iterate from it."));
      return;
    }
    const nameOf = (id: number) => takes.find((t) => t.id === id)?.name ?? `Take ${id}`;
    this.list.replaceChildren(...[...takes].reverse().map((t) => this.row(t, nameOf)));
  }

  private row(t: TakeInfo, nameOf: (id: number) => string): HTMLElement {
    const thumb = h("canvas", { class: "tthumb", "aria-hidden": "true" });
    if (t.thumb) paintSpectrogram(thumb, t.thumb, 0, this.host.look());
    const name = h("span", { class: "tname", title: "Double-click to rename" }, t.name);
    name.addEventListener("dblclick", () => {
      name.contentEditable = "true";
      name.focus();
      document.getSelection()?.selectAllChildren(name);
    });
    const commit = () => {
      if (name.contentEditable !== "true") return;
      name.contentEditable = "false";
      const v = (name.textContent ?? "").trim();
      if (v && v !== t.name) this.host.rename(t.id, v); else name.textContent = t.name;
    };
    name.addEventListener("blur", commit);
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); name.blur(); }
      if (e.key === "Escape") { name.textContent = t.name; name.blur(); }
      e.stopPropagation();   // typing a name must not play notes
    });
    const op = OPS.find((o) => o.id === t.op)?.label ?? "Sum";
    const when = new Date(t.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const recipe = t.layers.map((l, i) => (l ? `${i + 1} ${l.origin ? `← ${nameOf(l.origin)}` : l.name}` : null)).filter(Boolean).join(" · ");
    const playing = this.host.playing() === t.id;
    const play = key(null, playing ? ICONS.stop : ICONS.play, { class: "sm", "aria-label": `${playing ? "Stop" : "Play"} ${t.name}`, title: "Listen to this take" }, () => this.host.preview(t.id));
    const restore = confirmKey(key("Restore", null, { class: "sm", title: HELP.restoreTake }), () => this.host.restore(t.id));
    const send = h("span", { class: "tsend" }, h("span", { class: "silk sm" }, "To"),
      ...[1, 2, 3, 4].map((n) => key(String(n), null, { class: `sm fz-l${n}`, "aria-label": `Send ${t.name} to layer ${n}`, title: `Replace layer ${n} with this take (iterate from it)` }, () => this.host.toLayer(t.id, n - 1))));
    const del = confirmKey(key(null, ICONS.clear, { class: "sm", "aria-label": `Delete ${t.name}`, title: "Delete this take" }), () => this.host.remove(t.id));
    const current = this.host.current() === t.id;
    return h("div", { class: `take${current ? " current" : ""}` },
      thumb,
      h("div", { class: "tmain" },
        h("div", { class: "trow" }, name, current ? h("span", { class: "ro-sm ink" }, "· current") : null),
        h("span", { class: "ro-sm" }, `${op} · ${t.duration.toFixed(2)} s · ${when}`),
        h("span", { class: "ro-sm tline", title: recipe }, recipe)),
      h("div", { class: "tactions" }, h("div", { class: "trow" }, play, restore, del), send));
  }
}

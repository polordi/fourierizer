// H0 spike UI. Talks to C++ through JUCE's JavaScript bridge (juce/index.js):
//  - getSliderState("gain") mirrors the host parameter "gain" (both directions),
//  - getNativeFunction("getHostInfo") calls a C++ function and awaits its result,
//  - the "meters" event is pushed from C++ about 30 times per second.
import { getSliderState, getNativeFunction } from "./juce/index.js";

const $ = (id) => document.getElementById(id);
const fmtDb = (db) => (db <= -59.9 ? "−∞" : db.toFixed(1).replace("-", "−"));

// ---- Test 2: knob bound to the "gain" parameter -----------------------------------------
const gain = getSliderState("gain");
const ticks = $("ticks");
ticks.innerHTML = Array.from({ length: 11 }, (_, i) => {
  const a = ((-135 + i * 27 - 90) * Math.PI) / 180;
  return `<line data-i="${i}" x1="${36 + 31 * Math.cos(a)}" y1="${36 + 31 * Math.sin(a)}" x2="${36 + 35 * Math.cos(a)}" y2="${36 + 35 * Math.sin(a)}" stroke-width="1.5"/>`;
}).join("");

function paintGain() {
  const v = gain.getNormalisedValue();
  $("cap").style.transform = `rotate(${-135 + 270 * v}deg)`;
  $("gainText").textContent = `${fmtDb(gain.getScaledValue())} dB`;
  ticks.querySelectorAll("line").forEach((l) => l.setAttribute("stroke", +l.dataset.i <= Math.round(v * 10) ? "#16181A" : "#B7BDC3"));
}
let paramSeen = false;
gain.valueChangedEvent.addListener(() => {
  paintGain();
  if (!paramSeen) { paramSeen = true; $("paramLed").classList.add("on"); $("paramText").textContent = "Parameter linked ✓"; }
});
gain.propertiesChangedEvent.addListener(paintGain);
paintGain();

const dial = $("dial");
let y0 = 0, v0 = 0;
dial.addEventListener("pointerdown", (e) => { dial.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = gain.getNormalisedValue(); gain.sliderDragStarted(); });
dial.addEventListener("pointermove", (e) => {
  if (!dial.hasPointerCapture(e.pointerId)) return;
  gain.setNormalisedValue(Math.min(1, Math.max(0, v0 + (y0 - e.clientY) / (e.shiftKey ? 600 : 150))));
});
dial.addEventListener("pointerup", () => gain.sliderDragEnded());
dial.addEventListener("keydown", (e) => {
  const d = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02 }[e.key];
  if (!d) return;
  e.preventDefault();
  gain.sliderDragStarted();
  gain.setNormalisedValue(Math.min(1, Math.max(0, gain.getNormalisedValue() + d)));
  gain.sliderDragEnded();
});

// ---- Tests 1 and 3: meters pushed from C++ ----------------------------------------------
let midiSeen = false, scSeen = false;
window.__JUCE__.backend.addEventListener("meters", ({ rms, channels, voices }) => {
  $("voices").textContent = voices;
  if (voices > 0 && !midiSeen) { midiSeen = true; $("midiLed").classList.add("on"); $("midiText").textContent = "MIDI received, sound playing ✓"; }

  const db = rms > 1e-6 ? Math.max(-60, 20 * Math.log10(rms)) : -60;
  $("scDb").textContent = fmtDb(db);
  $("meterBar").style.width = `${((db + 60) / 60) * 100}%`;
  if (channels === 0) $("scText").textContent = "Sidechain bus is disabled by the host";
  else if (db > -50 && !scSeen) { scSeen = true; $("scLed").classList.add("on"); $("scText").textContent = `Receiving audio on ${channels} ch ✓`; }
});

// ---- Footer: host info from a native function -------------------------------------------
getNativeFunction("getHostInfo")()
  .then((i) => {
    $("info").innerHTML = [`host ${i.host}`, `${i.format}`, `${i.sampleRate} Hz`, `block ${i.blockSize}`, `spike v${i.version}`, `${i.juce}`]
      .map((s) => `<span>${s}</span>`).join("");
  })
  .catch((e) => { $("info").innerHTML = `<span class="err">Bridge error: ${e}</span>`; });

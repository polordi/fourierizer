# Knob

A rotary control for continuous values that you tune by ear and that have a bounded range: envelope times, feather, gain, mix amounts.

- **Consumer provides:** layer class (`.fz-l1`…`.fz-l4`) on the wrapper, an icon, a silkscreen abbreviation (`silk` style), a value formatter that always includes the unit, and a default value.
- **Anatomy:** 11-tick scale (active ticks in `ink`, inactive in `seam`), cap in `--layer` with `ink` outline and `shadow-key`, indicator in `--on-layer`, icon + `readout` value, `silk` label.
- **Behavior:** vertical drag (Shift = fine), arrow keys, double-click resets to default. Direct manipulation is immediate; jumps (reset, keys) animate with a springy overshoot (~420 ms).
- **Use when** the exact number matters less than the sound. **Don't use** for discrete or exact values (FFT size, semitones): use Stepper. **Don't use** for comparing several levels side by side: use Fader.

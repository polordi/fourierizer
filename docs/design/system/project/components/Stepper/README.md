# Stepper

An exact or discrete value with − / + buttons and, underneath, what that number means physically. This is the "laboratory instrument" control.

- **Consumer provides:** a `silk` label, the value domain (index or integer range), a display formatter, and a derived-value formatter (e.g. FFT size → window length in ms and bin spacing Δf in Hz at the project sample rate).
- **Anatomy:** label, a `display`-ground body with an `ink` outline, a `readout-lg` value, and a `readout-sm` derived line in `ink-muted`.
- **Behavior:** click − / +; buttons disable at the range ends. Values that are powers of two step by one octave of size.
- **Use for** FFT size N, hop H, window length L, semitones, cents, root note, voice count. **Don't use** for values tuned by ear: use Knob.

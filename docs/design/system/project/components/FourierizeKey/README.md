# FourierizeKey

The single primary action: render the synthesis from the current selections. There is exactly one on screen.

- **Consumer provides:** the click handler, the number of active layers, and the render progress (per layer) and result (duration, peak level).
- **Anatomy:** an oversized `fz-key` (64px tall, wide letter-spacing) with a wave glyph; four LEDs, one per layer in its color, plus a `readout-sm` status line.
- **Behavior:** pressing sinks the key by the `shadow-key` depth; while rendering, the key stays down and the LEDs light in layer order. When done, the status reports time and peak in dBFS. This is the playful moment of the interface.
- **Don't** use layer colors on the key itself: it belongs to all layers.

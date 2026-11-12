# LayerSlot

The module for one of the four source slots: who it is (number + color), what is loaded, its state, and quick actions.

- **Consumer provides:** layer number (sets `.fz-lN`), file name, metadata line (sample rate · duration · channels), loaded state, waveform peaks, and handlers for load, capture, mute and solo.
- **Anatomy:** `fz-module` with four screws; a number chip in `--layer` with an `ink` outline; `title` name with ellipsis; `readout-sm` metadata; an LED (lit in `--layer` when loaded); a waveform display in `--layer-deep`; icon keys.
- **Empty state:** "Empty slot" plus the instruction "Drop a sound or capture from the mixer", and the display reads DROP AUDIO HERE.
- **Rec** uses the word plus the icon; when armed, its LED and outline switch to `signal-rec`.
- **Don't** fill the module with the layer color: color stays on the chip, LED, waveform and the layer's knobs.

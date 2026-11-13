// Display spectrogram (ui/src/dsp/spectrogram.ts): STFT magnitude in dB on a log-frequency axis,
// reduced to screen resolution (max over the frames of each column). Values 0–255, row 0 at
// the top (F_MAX), so the UI colors it exactly like its own.
#pragma once

#include <cstdint>
#include <vector>

#include "fourierizer/stft.h"

namespace fz {

inline constexpr double kSpecFMin = 30.0, kSpecFMax = 20000.0, kSpecRangeDb = 58.0, kSpecGamma = 2.4;

struct SpectrogramImage {
    std::vector<uint8_t> data;  // rows × cols, row-major
    int cols = 0, rows = 0;
};

SpectrogramImage spectrogramImage(const Signal& x, double sr, const Grid& g, int maxCols = 1400, int rows = 360);

/// Mid (average of the channels).
Signal midOf(const Channels& x);

} // namespace fz

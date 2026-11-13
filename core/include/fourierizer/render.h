// Layer synthesis and mixing (python/fourierizer_ref/render.py, PLAN §4.2):
//   y[n] = Σᵢ gᵢ · ISTFTᵢ( Mᵢ ⊙ STFTᵢ( Tᵢ xᵢ ) )[n − τᵢ·sr]
// Each layer is reconstructed on its own grid; no coefficient matrix is ever resampled.
#pragma once

#include <atomic>
#include <optional>
#include <vector>

#include "fourierizer/mask.h"
#include "fourierizer/stft.h"

namespace fz {

struct LayerInput {
    Channels channels;          // (channels, samples) at the project rate
    Grid grid;
    std::vector<Shape> shapes;
    double featherS = 0.01;     // defaults for shapes without their own feather
    double featherOct = 1.0 / 12.0;
    double gainDb = 0.0;
    double offsetS = 0.0;       // positive = later; negative trims the start
    double pitchSt = 0.0;       // Tape transposition, applied before the STFT
};

/// Masked resynthesis of one layer, before gain and offset.
Channels synthesizeLayer(const LayerInput& layer, double sr, const std::atomic<bool>* cancel = nullptr);

struct Part {
    Channels y;
    double gainDb = 0.0;
    double offsetS = 0.0;
};

/// Gain, offset and sum into `channels` outputs (mono is repeated, more channels are folded),
/// then optional peak normalization to `normalizeDbfs`.
Channels mix(const std::vector<Part>& parts, double sr, int channels = 2,
             std::optional<double> normalizeDbfs = -0.3);

struct RenderOptions {
    int channels = 2;
    std::optional<double> normalizeDbfs = -0.3;
    int threads = 1;                            // layers rendered in parallel (results identical)
    const std::atomic<bool>* cancel = nullptr;  // raise to abort: throws fz::Cancelled
};

Channels render(const std::vector<LayerInput>& layers, double sr, const RenderOptions& opts = {});

double peakOf(const Channels& x);

} // namespace fz

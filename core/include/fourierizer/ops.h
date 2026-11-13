// Operations other than the sum (python/fourierizer_ref/ops.py, PLAN §3.3, §4.6). The layers
// are placed on the timeline (gain, offset), analysed on ONE common grid, masked and combined
// cell by cell before a single inverse STFT:
//   max:     Y = χ_{i*},  i* = argmax |χ_i|      (every layer)
//   cross:   Y = |χ_A| · e^{i∠χ_B}               (layers a and b)
//   product: Y = |χ_A| · χ_B                     (layers a and b)
#pragma once

#include <atomic>
#include <optional>
#include <string_view>
#include <vector>

#include "fourierizer/mask.h"
#include "fourierizer/stft.h"

namespace fz {

enum class Op { Sum, Max, Cross, Product };

Op opFromName(std::string_view name);  // "sum", "max", "cross", "product"
bool isPairOp(Op op);

inline constexpr Grid kCommonGrid{Window::Hann, 4096, 4096, 512};

struct OpLayer {
    Channels channels;           // already transposed (Tape), project rate
    std::vector<Shape> shapes;
    double featherS = 0.01, featherOct = 1.0 / 12.0;
    double gainDb = 0.0, offsetS = 0.0;
};

/// `layers` for Max; for Cross and Product only layers[a] and layers[b] are used.
Channels renderOp(const std::vector<OpLayer>& layers, Op op, double sr, int a = 0, int b = 1,
                  const Grid& g = kCommonGrid, int channels = 2, std::optional<double> normalizeDbfs = -0.3,
                  const std::atomic<bool>* cancel = nullptr);

} // namespace fz

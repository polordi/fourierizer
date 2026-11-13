#include "fourierizer/resample.h"

#include <algorithm>
#include <cmath>
#include <numbers>

#include "fourierizer/windows.h"

namespace fz {

namespace {
constexpr int kZeroCrossings = 24;
constexpr int kSteps = 512;  // table points per zero crossing
constexpr double kBeta = 8.0;

const std::vector<double>& kernelTable() {
    static const std::vector<double> table = [] {
        const int n = kZeroCrossings * kSteps + 2;
        std::vector<double> t(n);
        const double d = besselI0(kBeta), pi = std::numbers::pi;
        for (int i = 0; i < n; ++i) {
            const double v = static_cast<double>(i) / kSteps;
            const double sinc = v == 0 ? 1.0 : std::sin(pi * v) / (pi * v);
            const double r = v / kZeroCrossings;
            t[i] = r >= 1 ? 0.0 : sinc * besselI0(kBeta * std::sqrt(1 - r * r)) / d;
        }
        return t;
    }();
    return table;
}
} // namespace

std::vector<double> resampleByStep(const std::vector<double>& x, double step) {
    const auto& t = kernelTable();
    const long long n = static_cast<long long>(x.size());
    const double fc = std::min(1.0, 1.0 / step);
    const double reach = kZeroCrossings / fc;
    const long long outLen = static_cast<long long>(std::ceil(n / step));
    const long long tableLast = static_cast<long long>(t.size()) - 1;
    std::vector<double> y(std::max(outLen, 0LL), 0.0);
    for (long long j = 0; j < outLen; ++j) {
        const double pos = j * step;
        const long long k0 = std::max(0LL, static_cast<long long>(std::ceil(pos - reach)));
        const long long k1 = std::min(n - 1, static_cast<long long>(std::floor(pos + reach)));
        double acc = 0;
        for (long long k = k0; k <= k1; ++k) {
            const double v = std::abs(pos - k) * fc * kSteps;
            const long long i = static_cast<long long>(v);
            if (i >= tableLast) continue;
            const double f = v - i;
            acc += x[k] * (t[i] + (t[i + 1] - t[i]) * f);
        }
        y[j] = acc * fc;
    }
    return y;
}

std::vector<double> tapePitch(const std::vector<double>& x, double semitones) {
    if (semitones == 0) return x;
    return resampleByStep(x, std::pow(2.0, semitones / 12.0));
}

std::vector<double> resampleRate(const std::vector<double>& x, double srIn, double srOut) {
    if (srIn == srOut) return x;
    return resampleByStep(x, srIn / srOut);
}

} // namespace fz

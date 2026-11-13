#include "fourierizer/spectrogram.h"

#include <algorithm>
#include <cmath>

#include "fourierizer/fft.h"

namespace fz {

Signal midOf(const Channels& x) {
    if (x.empty()) return {};
    Signal m(x[0].size(), 0.0);
    for (const Signal& c : x)
        for (size_t i = 0; i < m.size(); ++i) m[i] += c[i] / static_cast<double>(x.size());
    return m;
}

SpectrogramImage spectrogramImage(const Signal& x, double sr, const Grid& g, int maxCols, int rows) {
    const long long n = static_cast<long long>(x.size());
    const int M = frameCount(n, g), cols = std::max(1, std::min(M, maxCols));
    const double fmax = std::min(kSpecFMax, sr / 2);
    const auto w = makeWindow(g.window, g.L);
    RealFFT fft(g.N);
    const int B = fft.bins();
    std::vector<double> frame(g.L), re(B), im(B), mag(B), frac(rows);
    std::vector<int> bin0(rows);
    for (int r = 0; r < rows; ++r) {
        const double y = (r + 0.5) / rows;
        const double b = kSpecFMin * std::pow(fmax / kSpecFMin, 1 - y) * g.N / sr;
        bin0[r] = std::min(B - 2, static_cast<int>(std::floor(b)));
        frac[r] = std::min(1.0, b - bin0[r]);
    }
    std::vector<double> acc(static_cast<size_t>(rows) * cols, 0.0);
    const int left = g.L / 2;
    for (int m = 0; m < M; ++m) {
        const long long start = static_cast<long long>(m) * g.H - left;
        for (int j = 0; j < g.L; ++j) {
            const long long i = start + j;
            frame[j] = (i >= 0 && i < n) ? x[i] * w[j] : 0.0;
        }
        fft.forward(frame.data(), g.L, re.data(), im.data());
        for (int k = 0; k < B; ++k) mag[k] = std::hypot(re[k], im[k]);
        const int col = std::min(cols - 1, static_cast<int>(static_cast<long long>(m) * cols / M));
        for (int r = 0; r < rows; ++r) {
            const double v = mag[bin0[r]] * (1 - frac[r]) + mag[bin0[r] + 1] * frac[r];
            double& a = acc[static_cast<size_t>(r) * cols + col];
            if (v > a) a = v;
        }
    }
    SpectrogramImage img{std::vector<uint8_t>(acc.size(), 0), cols, rows};
    const double peak = acc.empty() ? 0 : *std::max_element(acc.begin(), acc.end());
    if (peak > 0) {
        const double ref = 20 * std::log10(peak);
        for (size_t i = 0; i < acc.size(); ++i) {
            const double db = 20 * std::log10(acc[i] + 1e-12) - ref;
            const double v = std::pow(std::clamp((db + kSpecRangeDb) / kSpecRangeDb, 0.0, 1.0), kSpecGamma);
            img.data[i] = static_cast<uint8_t>(std::lround(v * 255));
        }
    }
    return img;
}

} // namespace fz

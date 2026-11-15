#include "fourierizer/spectrogram.h"

#include <algorithm>
#include <cmath>

#include "fourierizer/fft.h"
#include "fourierizer/render.h"

namespace fz {

Signal midOf(const Channels& x) {
    if (x.empty()) return {};
    Signal m(x[0].size(), 0.0);
    for (const Signal& c : x)
        for (size_t i = 0; i < m.size(); ++i) m[i] += c[i] / static_cast<double>(x.size());
    return m;
}

SpectrogramImage spectrogramImage(const Signal& x, double sr, const Grid& g, int maxCols, int rows, Axis axis,
                                  long long start0, long long end) {
    const long long n = static_cast<long long>(x.size());
    if (end < 0) end = n;
    const int M = frameCount(std::max(0LL, end - start0), g), cols = std::max(1, std::min(M, maxCols));
    const double fmin = axis.fmin, fmax = std::min(axis.fmax, sr / 2);
    const auto w = makeWindow(g.window, g.L);
    RealFFT fft(g.N);
    const int B = fft.bins();
    std::vector<double> frame(g.L), re(B), im(B), mag(B), frac(rows);
    std::vector<int> bin0(rows);
    for (int r = 0; r < rows; ++r) {
        const double y = (r + 0.5) / rows;
        const double f = axis.log ? fmin * std::pow(fmax / fmin, 1 - y) : fmin + (fmax - fmin) * (1 - y);
        const double b = std::max(0.0, f) * g.N / sr;
        bin0[r] = std::min(B - 2, static_cast<int>(std::floor(b)));
        frac[r] = std::min(1.0, b - bin0[r]);
    }
    std::vector<double> acc(static_cast<size_t>(rows) * cols, 0.0);
    const int left = g.L / 2;
    for (int m = 0; m < M; ++m) {
        const long long start = start0 + static_cast<long long>(m) * g.H - left;
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
    SpectrogramImage img{std::vector<uint8_t>(acc.size(), 255), cols, rows};
    const double peak = acc.empty() ? 0 : *std::max_element(acc.begin(), acc.end());
    if (peak > 0) {
        const double ref = 20 * std::log10(peak);
        double wsum = 0;
        for (double v : w) wsum += v;
        img.peakDbfs = 20 * std::log10(peak * 2 / wsum);
        for (size_t i = 0; i < acc.size(); ++i) {
            const double db = 20 * std::log10(acc[i] + 1e-300) - ref;
            img.data[i] = static_cast<uint8_t>(std::clamp<long>(std::lround(-db * 2), 0, 255));
        }
    }
    return img;
}

SpectrogramImage multiresImage(const Signal& x, double sr, const Grid& g, int maxCols, int rows, Axis axis,
                               long long start, long long end, int maxHop) {
    std::array<SpectrogramImage, 3> imgs;
    for (int b = 0; b < 3; ++b) {
        Grid bg = bandGrid(g, kMultiresFactors[b]);
        if (maxHop > 0) bg.H = std::max(16, std::min(bg.H, maxHop));
        imgs[(size_t) b] = spectrogramImage(x, sr, bg, maxCols, rows, axis, start, end);
    }
    int cols = 0;
    double ref = -1000;
    for (const auto& m : imgs) { cols = std::max(cols, m.cols); ref = std::max(ref, m.peakDbfs); }
    const double fmin = axis.fmin, fmax = std::min(axis.fmax, sr / 2);
    SpectrogramImage out{std::vector<uint8_t>(static_cast<size_t>(rows) * cols, 255), cols, rows, ref};
    for (int r = 0; r < rows; ++r) {
        const double y = (r + 0.5) / rows;
        const double f = axis.log ? fmin * std::pow(fmax / fmin, 1 - y) : fmin + (fmax - fmin) * (1 - y);
        const auto w = bandWeights(std::max(0.0, f));
        const int b = w[0] >= w[1] && w[0] >= w[2] ? 0 : w[1] >= w[2] ? 1 : 2;
        const auto& m = imgs[(size_t) b];
        for (int c = 0; c < cols; ++c) {
            const int v = m.data[static_cast<size_t>(r) * m.cols + std::min(m.cols - 1, static_cast<int>(static_cast<long long>(c) * m.cols / cols))];
            if (v >= 255) continue;
            out.data[static_cast<size_t>(r) * cols + c] = static_cast<uint8_t>(std::clamp<long>(std::lround(2 * (ref - (m.peakDbfs - v / 2.0))), 0, 255));
        }
    }
    return out;
}

std::vector<float> waveformPeaks(const Signal& x, long long start, long long end, int cols) {
    std::vector<float> out(2 * static_cast<size_t>(std::max(cols, 0)), 0.0f);
    const long long n = static_cast<long long>(x.size());
    for (int c = 0; c < cols; ++c) {
        const long long a = start + (end - start) * c / cols, b = std::max(a + 1, start + (end - start) * (c + 1) / cols);
        float lo = 0, hi = 0;
        for (long long i = std::max(0LL, a); i < std::min(n, b); ++i) { lo = std::min(lo, (float) x[i]); hi = std::max(hi, (float) x[i]); }
        out[2 * c] = lo; out[2 * c + 1] = hi;
    }
    return out;
}

} // namespace fz

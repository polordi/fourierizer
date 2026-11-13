#include "fourierizer/ops.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>

#include "fourierizer/fft.h"
#include "fourierizer/render.h"

namespace fz {

Op opFromName(std::string_view name) {
    if (name == "sum") return Op::Sum;
    if (name == "max") return Op::Max;
    if (name == "cross") return Op::Cross;
    if (name == "product") return Op::Product;
    throw std::invalid_argument("unknown operation " + std::string(name));
}

bool isPairOp(Op op) { return op == Op::Cross || op == Op::Product; }

Channels renderOp(const std::vector<OpLayer>& layers, Op op, double sr, int a, int b, const Grid& g,
                  int channels, std::optional<double> normalizeDbfs, const std::atomic<bool>* cancel) {
    if (op == Op::Sum) throw std::invalid_argument("renderOp does not do the sum; use render()");
    validateGrid(g);
    std::vector<const OpLayer*> used;
    if (isPairOp(op)) {
        if (a < 0 || b < 0 || a >= static_cast<int>(layers.size()) || b >= static_cast<int>(layers.size()))
            return Channels(channels);
        used = {&layers[a], &layers[b]};
    } else {
        for (auto& l : layers) used.push_back(&l);
    }
    if (used.empty()) return Channels(channels);

    const auto P = logFreqs(binFreqs(g, sr));
    struct Prep { const OpLayer* l; SelectionRaster sel; double gain; long long start; };
    std::vector<Prep> prep;
    long long length = 0;
    for (const OpLayer* l : used) {
        if (l->channels.empty()) return Channels(channels);
        const long long start = static_cast<long long>(std::floor(l->offsetS * sr + 0.5));  // round half up
        prep.push_back({l, SelectionRaster(l->shapes, P, l->featherS, l->featherOct), std::pow(10.0, l->gainDb / 20.0), start});
        length = std::max(length, start + static_cast<long long>(l->channels[0].size()));
    }
    length = std::max(length, 0LL);

    const auto w = makeWindow(g.window, g.L);
    const int L = g.L, H = g.H, left = L / 2, M = frameCount(length, g);
    const long long total = static_cast<long long>(M - 1) * H + L;
    RealFFT fft(g.N);
    const int B = fft.bins();
    const size_t nl = prep.size();
    std::vector<double> frame(L), time(g.N), mask(B), outRe(B), outIm(B), wsum(total, 0.0);
    std::vector<std::vector<double>> re(nl, std::vector<double>(B)), im(nl, std::vector<double>(B));
    Channels ys(channels, Signal(total, 0.0));

    for (int m = 0; m < M; ++m) {
        if (cancel && cancel->load(std::memory_order_relaxed)) throw Cancelled();
        const long long base = static_cast<long long>(m) * H;
        for (int j = 0; j < L; ++j) wsum[base + j] += w[j] * w[j];
        for (int c = 0; c < channels; ++c) {
            for (size_t i = 0; i < nl; ++i) {
                const Prep& p = prep[i];
                const Signal& src = p.l->channels[std::min<size_t>(c, p.l->channels.size() - 1)];
                const long long from = base - left - p.start, n = static_cast<long long>(src.size());
                bool any = false;
                for (int j = 0; j < L; ++j) {
                    const long long k = from + j;
                    const double v = (k >= 0 && k < n) ? src[k] * w[j] * p.gain : 0.0;
                    frame[j] = v;
                    any = any || v != 0;
                }
                if (!any) { std::fill(re[i].begin(), re[i].end(), 0.0); std::fill(im[i].begin(), im[i].end(), 0.0); continue; }
                fft.forward(frame.data(), L, re[i].data(), im[i].data());
                p.sel.row(static_cast<double>(m) * H / sr - p.l->offsetS, mask.data());
                for (int k = 0; k < B; ++k) { re[i][k] *= mask[k]; im[i][k] *= mask[k]; }
            }
            for (int k = 0; k < B; ++k) {
                if (op == Op::Max) {
                    int best = -1;
                    double bm = -1;
                    for (size_t i = 0; i < nl; ++i) {
                        const double mm = re[i][k] * re[i][k] + im[i][k] * im[i][k];
                        if (mm > bm) { bm = mm; best = static_cast<int>(i); }
                    }
                    outRe[k] = re[best][k];
                    outIm[k] = im[best][k];
                    continue;
                }
                const double aMag = std::hypot(re[0][k], im[0][k]), bMag = std::hypot(re[1][k], im[1][k]);
                const double s = op == Op::Cross ? (bMag > 1e-12 ? aMag / bMag : 0.0) : aMag;
                outRe[k] = re[1][k] * s;
                outIm[k] = im[1][k] * s;
            }
            fft.inverse(outRe.data(), outIm.data(), time.data());
            double* y = ys[c].data() + base;
            for (int j = 0; j < L; ++j) y[j] += time[j] * w[j];
        }
    }

    Channels out(channels, Signal(length, 0.0));
    for (int c = 0; c < channels; ++c)
        for (long long i = 0; i < length; ++i) {
            const long long p = left + i;
            if (p >= total) break;
            out[c][i] = ys[c][p] / (wsum[p] > 1e-12 ? wsum[p] : 1.0);
        }
    if (normalizeDbfs) {
        const double peak = peakOf(out);
        if (peak > 0) {
            const double s = std::pow(10.0, *normalizeDbfs / 20.0) / peak;
            for (auto& c : out)
                for (double& v : c) v *= s;
        }
    }
    return out;
}

} // namespace fz

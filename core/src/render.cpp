#include "fourierizer/render.h"

#include <algorithm>
#include <cmath>
#include <exception>
#include <thread>

#include "fourierizer/resample.h"

namespace fz {

Channels synthesizeLayer(const LayerInput& layer, double sr, const std::atomic<bool>* cancel) {
    Channels pitched;
    const Channels* x = &layer.channels;
    if (layer.pitchSt != 0) {
        for (const Signal& c : layer.channels) pitched.push_back(tapePitch(c, layer.pitchSt));
        x = &pitched;
    }
    SelectionRaster sel(layer.shapes, logFreqs(binFreqs(layer.grid, sr)), layer.featherS, layer.featherOct);
    if (sel.empty()) {
        Channels zero;
        for (const Signal& c : *x) zero.emplace_back(c.size(), 0.0);
        return zero;
    }
    return maskedResynthesis(*x, layer.grid, sr, [&](int, double t, double* out) { sel.row(t, out); }, cancel);
}

double peakOf(const Channels& x) {
    double peak = 0;
    for (const Signal& c : x)
        for (double v : c) peak = std::max(peak, std::abs(v));
    return peak;
}

Channels mix(const std::vector<Part>& parts, double sr, int channels, std::optional<double> normalizeDbfs) {
    struct Placed { const Part* p; Signal folded; double g; long long start, trim; };
    std::vector<Placed> placed;
    long long length = 0;
    for (const Part& p : parts) {
        if (p.y.empty()) continue;
        Placed q{&p, {}, std::pow(10.0, p.gainDb / 20.0), 0, 0};
        const int ch = static_cast<int>(p.y.size());
        if (ch != channels && ch != 1) {  // fold to mono, then repeat
            q.folded.assign(p.y[0].size(), 0.0);
            for (const Signal& c : p.y)
                for (size_t i = 0; i < c.size(); ++i) q.folded[i] += c[i] / ch;
        }
        const long long off = std::llround(p.offsetS * sr);
        q.start = std::max(off, 0LL);
        q.trim = std::max(-off, 0LL);
        const long long len = static_cast<long long>(p.y[0].size());
        length = std::max(length, q.start + std::max(len - q.trim, 0LL));
        placed.push_back(std::move(q));
    }
    Channels out(channels, Signal(length, 0.0));
    for (const Placed& q : placed) {
        const int ch = static_cast<int>(q.p->y.size());
        for (int c = 0; c < channels; ++c) {
            const Signal& src = !q.folded.empty() ? q.folded : (ch == channels ? q.p->y[c] : q.p->y[0]);
            Signal& dst = out[c];
            for (long long i = q.trim; i < static_cast<long long>(src.size()); ++i) dst[q.start + i - q.trim] += q.g * src[i];
        }
    }
    if (normalizeDbfs) {
        const double peak = peakOf(out);
        if (peak > 0) {
            const double s = std::pow(10.0, *normalizeDbfs / 20.0) / peak;
            for (Signal& c : out)
                for (double& v : c) v *= s;
        }
    }
    return out;
}

Channels render(const std::vector<LayerInput>& layers, double sr, const RenderOptions& opts) {
    std::vector<Part> parts(layers.size());
    std::vector<std::exception_ptr> errors(layers.size());
    auto work = [&](size_t i) {
        try {
            parts[i] = {synthesizeLayer(layers[i], sr, opts.cancel), layers[i].gainDb, layers[i].offsetS};
        } catch (...) {
            errors[i] = std::current_exception();
        }
    };
    const size_t threads = std::clamp<size_t>(opts.threads, 1, std::max<size_t>(layers.size(), 1));
    if (threads <= 1) {
        for (size_t i = 0; i < layers.size(); ++i) work(i);
    } else {
        std::atomic<size_t> next{0};
        std::vector<std::thread> pool;
        for (size_t t = 0; t < threads; ++t)
            pool.emplace_back([&] { for (size_t i; (i = next.fetch_add(1)) < layers.size();) work(i); });
        for (auto& th : pool) th.join();
    }
    for (auto& e : errors)
        if (e) std::rethrow_exception(e);
    return mix(parts, sr, opts.channels, opts.normalizeDbfs);
}

} // namespace fz

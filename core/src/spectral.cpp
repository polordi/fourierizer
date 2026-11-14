#include "fourierizer/spectral.h"

#include <algorithm>
#include <cmath>
#include <numbers>
#include <stdexcept>

#include "fourierizer/resample.h"
#include "fourierizer/windows.h"

namespace fz {

namespace {
constexpr double kPeakFloor = 1e-6;   // peaks within −120 dB of the frame's loudest bin
constexpr double kSilence = 1e-9;     // quieter frames restart from the analysis phases
constexpr double kTau = 2 * std::numbers::pi;

inline double princarg(double x) { return x - kTau * std::floor((x + std::numbers::pi) / kTau); }
} // namespace

SpectralShifter::SpectralShifter(std::shared_ptr<const Channels> x, double semitones, int n)
    : x_(std::move(x)), n_(n), hop_(n / 8), half_(n / 2), B_(n / 2 + 1), fft_(n) {
    if (n < 64 || (n & (n - 1)) != 0) throw std::invalid_argument("spectral window must be a power of two ≥ 64");
    C_ = x_ ? static_cast<int>(x_->size()) : 0;
    L_ = C_ > 0 ? static_cast<std::int64_t>((*x_)[0].size()) : 0;
    r_ = std::pow(2.0, semitones / 12.0);
    M_ = static_cast<std::int64_t>(std::ceil(L_ * r_));
    ha_ = hop_ / r_;
    fc_ = std::min(1.0, 1.0 / r_);
    reach_ = resampleReach(fc_);
    j0_ = -(half_ / hop_) + 1;
    j1_ = (M_ - 1 + half_) / hop_;
    next_ = j0_;

    w_ = makeWindow(Window::Hann, n);
    double s = 0;
    for (double v : w_) s += v * v;
    norm_ = s / hop_;

    if (C_ > 1) {
        mono_.assign(static_cast<size_t>(L_), 0.0);
        for (const auto& c : *x_)
            for (std::int64_t i = 0; i < L_; ++i) mono_[i] += c[i];
    }
    for (Signal* v : {&seg_, &out_}) v->assign(n, 0.0);
    for (Signal* v : {&re_, &im_, &pre_, &pim_, &mag_, &ph_, &phi_, &theta_, &cr_, &ci_, &cos_, &sin_}) v->assign(B_, 0.0);
    peaks_.reserve(B_);
    y_.assign(C_, {});
    if (semitones == 0) M_ = -1;   // identity: process() copies
}

void SpectralShifter::segment(const double* sig, std::int64_t centre) {
    std::fill(seg_.begin(), seg_.end(), 0.0);
    const std::int64_t lo = centre - half_, s0 = std::max<std::int64_t>(lo, 0), s1 = std::min<std::int64_t>(lo + n_, L_);
    for (std::int64_t i = s0; i < s1; ++i) seg_[i - lo] = sig[i] * w_[i - lo];
}

std::int64_t SpectralShifter::finalUpTo() const {
    if (next_ > j1_) return M_;
    return std::clamp<std::int64_t>(next_ * hop_ - half_, 0, M_);
}

void SpectralShifter::frame() {
    const std::int64_t j = next_++;
    const std::int64_t a = static_cast<std::int64_t>(std::floor(j * ha_ + 0.5));
    const double* mono = C_ > 1 ? mono_.data() : (*x_)[0].data();

    segment(mono, a);
    fft_.forward(seg_.data(), n_, re_.data(), im_.data());
    double peak = 0;
    for (int k = 0; k < B_; ++k) {
        mag_[k] = std::sqrt(re_[k] * re_[k] + im_[k] * im_[k]);
        ph_[k] = std::atan2(im_[k], re_[k]);
        peak = std::max(peak, mag_[k]);
    }
    if (j == j0_ || peak < kSilence) {
        std::fill(theta_.begin(), theta_.end(), 0.0);
    } else {
        const int delta = hop_;
        segment(mono, a - delta);
        fft_.forward(seg_.data(), n_, pre_.data(), pim_.data());
        for (int k = 0; k < B_; ++k) {
            const double wk = kTau * k / n_;
            const double omega = wk + princarg(ph_[k] - std::atan2(pim_[k], pre_[k]) - wk * delta) / delta;
            theta_[k] = princarg(phi_[k] + hop_ * omega) - ph_[k];
        }
        // identity phase locking: every bin turns by the angle of its nearest peak
        const double floor = kPeakFloor * peak;
        peaks_.clear();
        for (int k = 0; k < B_; ++k) {
            const double m = mag_[k];
            if (m > floor && (k < 1 || m > mag_[k - 1]) && (k < 2 || m > mag_[k - 2]) &&
                (k + 1 >= B_ || m >= mag_[k + 1]) && (k + 2 >= B_ || m >= mag_[k + 2]))
                peaks_.push_back(k);
        }
        if (!peaks_.empty()) {
            size_t p = 0;
            for (int k = 0; k < B_; ++k) {
                while (p + 1 < peaks_.size() && k > (peaks_[p] + peaks_[p + 1]) / 2) ++p;
                cr_[k] = theta_[peaks_[p]];
            }
            theta_.swap(cr_);
        }
    }
    for (int k = 0; k < B_; ++k) phi_[k] = princarg(ph_[k] + theta_[k]);

    const std::int64_t lo = j * hop_ - half_, s0 = std::max<std::int64_t>(lo, 0), s1 = std::min<std::int64_t>(lo + n_, M_);
    if (s1 <= s0) return;
    for (int k = 0; k < B_; ++k) { cos_[k] = std::cos(theta_[k]); sin_[k] = std::sin(theta_[k]); }
    for (int c = 0; c < C_; ++c) {
        if (C_ > 1) {   // mono: re/im already hold this frame
            segment((*x_)[c].data(), a);
            fft_.forward(seg_.data(), n_, re_.data(), im_.data());
        }
        for (int k = 0; k < B_; ++k) {
            cr_[k] = re_[k] * cos_[k] - im_[k] * sin_[k];
            ci_[k] = re_[k] * sin_[k] + im_[k] * cos_[k];
        }
        fft_.inverse(cr_.data(), ci_.data(), out_.data());
        auto& y = y_[c];
        if (static_cast<std::int64_t>(y.size()) < s1 - yBase_) y.resize(static_cast<size_t>(s1 - yBase_), 0.0);
        for (std::int64_t i = s0; i < s1; ++i) y[i - yBase_] += out_[i - lo] * w_[i - lo];
    }
}

std::int64_t SpectralShifter::process(std::int64_t count, Channels& out) {
    const std::int64_t from = produced_, to = std::min(L_, produced_ + std::max<std::int64_t>(count, 0));
    out.resize(C_);
    for (auto& c : out) c.resize(static_cast<size_t>(to - from));
    if (M_ < 0) {   // 0 semitones
        for (int c = 0; c < C_; ++c) std::copy((*x_)[c].begin() + from, (*x_)[c].begin() + to, out[c].begin());
        produced_ = to;
        return to - from;
    }
    for (std::int64_t i = from; i < to; ++i) {
        const double pos = i * r_;
        const std::int64_t need = std::min<std::int64_t>(M_ - 1, static_cast<std::int64_t>(std::floor(pos + reach_)));
        while (finalUpTo() <= need) frame();
        for (int c = 0; c < C_; ++c) out[c][i - from] = resampleAt(y_[c].data(), yBase_, 0, M_ - 1, pos, fc_, norm_);
    }
    produced_ = to;
    // drop the stretched samples no later output can reach
    const std::int64_t keep = static_cast<std::int64_t>(std::ceil(to * r_ - reach_)) - 1;
    if (keep - yBase_ > (1 << 16)) {
        for (auto& y : y_) y.erase(y.begin(), y.begin() + std::min<std::int64_t>(keep - yBase_, static_cast<std::int64_t>(y.size())));
        yBase_ = keep;
    }
    return to - from;
}

Channels spectralPitch(const Channels& x, double semitones, int n) {
    SpectralShifter s(std::make_shared<const Channels>(x), semitones, n);
    Channels out;
    s.process(s.length(), out);
    return out;
}

} // namespace fz

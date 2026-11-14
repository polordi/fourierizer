// Spectral pitch shift: change the pitch, keep the duration (python/fourierizer_ref/spectral.py).
// Phase-vocoder time stretch by r = 2^(s/12) (instantaneous frequency from a second frame δ
// earlier, identity phase locking, phases computed on the mid signal and shared by every
// channel), then Kaiser-sinc resampling by r.
//
// SpectralShifter produces the output progressively, so the sampler can start a note after the
// first chunk while the rest is computed. The output is identical however it is chunked.
#pragma once

#include <cstdint>
#include <memory>
#include <vector>

#include "fourierizer/fft.h"
#include "fourierizer/stft.h"

namespace fz {

/// Analysis windows the user can choose: smooth pads, a middle ground, tight attacks.
enum class SpectralWindow { Tonal = 4096, Mixed = 2048, Punchy = 1024 };

class SpectralShifter {
public:
    /// `x` is shared, not copied. n = FFT size (power of two ≥ 64); hop and δ are n/8.
    SpectralShifter(std::shared_ptr<const Channels> x, double semitones, int n = 4096);

    std::int64_t length() const { return L_; }       // output length = input length
    int channels() const { return C_; }
    std::int64_t produced() const { return produced_; }
    bool done() const { return produced_ >= L_; }

    /// Computes up to `count` more output samples into out[c][0..k) (resized) and returns k.
    std::int64_t process(std::int64_t count, Channels& out);

private:
    void frame();                                   // analyse + synthesise frame next_
    std::int64_t finalUpTo() const;                 // stretched samples < this are complete
    void segment(const double* sig, std::int64_t centre);

    std::shared_ptr<const Channels> x_;
    int C_, n_, hop_, half_, B_;
    std::int64_t L_, M_;
    double r_, ha_, norm_, fc_, reach_;
    std::int64_t j0_, j1_, next_, produced_ = 0;
    Signal mono_, w_, seg_, re_, im_, pre_, pim_, mag_, ph_, phi_, theta_, cr_, ci_, cos_, sin_, out_;
    std::vector<int> peaks_;
    RealFFT fft_;
    Channels y_;                                    // stretched signal from index yBase_ on
    std::int64_t yBase_ = 0;
};

/// The whole signal at once (same numbers as SpectralShifter).
Channels spectralPitch(const Channels& x, double semitones, int n = 4096);

} // namespace fz

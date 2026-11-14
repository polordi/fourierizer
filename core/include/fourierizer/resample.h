// Band-limited resampling with a Kaiser-windowed sinc read from a table
// (python/fourierizer_ref/audio.py: resample_by_step). Used for Tape transposition and for
// converting imported files to the project sample rate.
#pragma once

#include <vector>

namespace fz {

/// One output sample: x read at position `pos` through the Kaiser sinc low-passed at `fc`
/// (= min(1, 1/step)). x[k] for k in [first, last] is at data[k − base]; outside it is zero.
/// Every input sample is divided by `divisor` before the kernel is applied.
double resampleAt(const double* data, long long base, long long first, long long last, double pos, double fc,
                  double divisor = 1.0);

/// Half-width of the kernel in input samples: output at `pos` reads [pos − reach, pos + reach].
double resampleReach(double fc);

/// Output sample j reads input position j·step (step > 1 shortens and low-passes).
std::vector<double> resampleByStep(const std::vector<double>& x, double step);

/// Tape transposition: +12 st plays twice as fast (half the samples).
std::vector<double> tapePitch(const std::vector<double>& x, double semitones);

/// Sample-rate conversion from srIn to srOut.
std::vector<double> resampleRate(const std::vector<double>& x, double srIn, double srOut);

} // namespace fz

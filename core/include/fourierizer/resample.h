// Band-limited resampling with a Kaiser-windowed sinc read from a table
// (python/fourierizer_ref/audio.py: resample_by_step). Used for Tape transposition and for
// converting imported files to the project sample rate.
#pragma once

#include <vector>

namespace fz {

/// Output sample j reads input position j·step (step > 1 shortens and low-passes).
std::vector<double> resampleByStep(const std::vector<double>& x, double step);

/// Tape transposition: +12 st plays twice as fast (half the samples).
std::vector<double> tapePitch(const std::vector<double>& x, double semitones);

/// Sample-rate conversion from srIn to srOut.
std::vector<double> resampleRate(const std::vector<double>& x, double srIn, double srOut);

} // namespace fz

// Shared by Fourierizer (the instrument) and Fourierizer Capture (the mixer effect): the folder
// where captures are written and read. No inter-process communication is needed: Capture writes
// WAV files there and the instrument lists them.
#pragma once

#include <juce_core/juce_core.h>

namespace fzshared {

/// Documents/Fourierizer/Captures (created on demand).
inline juce::File capturesFolder() {
    return juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("Fourierizer").getChildFile("Captures");
}

/// Longest capture, in seconds (the instrument's limit per source).
inline constexpr double kMaxCaptureSeconds = 60.0;

} // namespace fzshared

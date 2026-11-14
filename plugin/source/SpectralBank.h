// Spectral mode's sounds: one pitch-shifted copy of the result per semitone offset from the root
// (same length, new pitch), computed by fourierizer-core's SpectralShifter on two worker threads.
//
// Copies are made on demand (a played note that is not ready yet goes first) and ahead of time
// (±12 st around the root while Spectral mode is on), within a memory budget; the least recently
// played copy is dropped when the budget is full. A copy is computed in chunks and can be played
// while it grows: SampleBuffer::ready says how many samples are already final.
//
// Real-time rules as in Sampler: the audio thread only try-locks to read a slot and pushes
// requests into a lock-free FIFO; buffers are freed on the message thread (collectGarbage).
#pragma once

#include <juce_core/juce_core.h>

#include <fourierizer/spectral.h>

#include <array>
#include <atomic>
#include <memory>
#include <mutex>
#include <vector>

#include "Sampler.h"

namespace fzp {

class SpectralBank {
public:
    static constexpr int kMaxShift = 48;           // ±4 octaves
    static constexpr int kAheadRange = 12;         // computed ahead of time: ±1 octave
    static constexpr std::int64_t kBudgetBytes = 1024LL * 1024 * 1024;

    SpectralBank();
    ~SpectralBank();

    // ---- any non-audio thread
    /// New result (audio at 48 kHz, and the same audio as the buffer that plays at 0 st).
    void setSource(std::shared_ptr<const fz::Channels> audio, SampleBuffer::Ptr unshifted);
    void collectGarbage();                          // message thread, a few times per second
    /// Copies finished among the ±12 computed ahead (for the UI), and how many there are.
    int readyAhead() const { return readyAhead_.load(); }
    int totalAhead() const { return totalAhead_.load(); }

    // ---- audio thread (never blocks)
    /// Spectral mode on/off (computes ahead only when on) and the analysis window (FFT size).
    void configure(bool active, int window) { active_.store(active); window_.store(window); }
    /// The copy for `shift` semitones (it may still be growing). Returns false when the bank is
    /// busy (try again later); true with `out` = nullptr when the copy was requested but does
    /// not exist yet.
    bool lookup(int shift, SampleBuffer::Ptr& out);

private:
    struct Job {
        int shift = 0;
        bool demanded = false;
        juce::uint64 order = 0;                     // demanded jobs: first come, first served
        bool busy = false;
        std::unique_ptr<fz::SpectralShifter> shifter;
        SampleBuffer::Ptr buffer;
    };
    class Worker;

    bool step();                                    // one chunk of the best job; false if idle
    std::shared_ptr<Job> pickJob();
    std::shared_ptr<Job> startJob(int shift, bool demanded);   // jobsMutex_ held
    void drainRequests();
    void invalidate();                              // jobsMutex_ held
    bool makeRoom(std::int64_t bytes, bool evict);  // jobsMutex_ held
    void updateReadyCount();

    static int slotOf(int shift) { return shift + kMaxShift; }

    // slots: read by the audio thread under a try-lock
    juce::SpinLock slotLock_;
    std::array<SampleBuffer::Ptr, 2 * kMaxShift + 1> slots_;
    std::array<std::atomic<juce::uint32>, 2 * kMaxShift + 1> lastUse_{};
    std::atomic<juce::uint32> clock_{0};
    juce::ReferenceCountedArray<SampleBuffer> garbage_;   // under slotLock_

    // requests from the audio thread
    juce::AbstractFifo fifo_{256};
    std::array<int, 256> fifoData_{};
    std::array<std::atomic<bool>, 2 * kMaxShift + 1> requested_{};

    // jobs and source (worker threads and setSource)
    std::mutex jobsMutex_;
    std::vector<std::shared_ptr<Job>> jobs_;
    std::shared_ptr<const fz::Channels> audio_;
    SampleBuffer::Ptr unshifted_;
    int builtWindow_ = 0;
    juce::uint64 orderCounter_ = 0, generation_ = 0;

    std::atomic<bool> active_{false};
    std::atomic<int> window_{4096};
    std::atomic<int> readyAhead_{0}, totalAhead_{0};
    std::vector<std::unique_ptr<Worker>> workers_;
};

} // namespace fzp

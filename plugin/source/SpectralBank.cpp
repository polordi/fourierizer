#include "SpectralBank.h"

#include <algorithm>
#include <cstdlib>

namespace fzp {

class SpectralBank::Worker : public juce::Thread {
public:
    Worker(SpectralBank& bank, int i) : juce::Thread("Fourierizer spectral " + juce::String(i)), bank_(bank) {}
    void run() override {
        while (!threadShouldExit())
            if (!bank_.step()) wait(2);   // idle: look for requests every 2 ms
    }

private:
    SpectralBank& bank_;
};

SpectralBank::SpectralBank() {
    for (int i = 0; i < 2; ++i) {
        workers_.push_back(std::make_unique<Worker>(*this, i));
        workers_.back()->startThread();
    }
}

SpectralBank::~SpectralBank() {
    for (auto& w : workers_) w->signalThreadShouldExit();
    for (auto& w : workers_) w->stopThread(10000);
}

// ------------------------------------------------------------------------------ source
void SpectralBank::setSource(std::shared_ptr<const fz::Channels> audio, SampleBuffer::Ptr unshifted) {
    std::lock_guard lock(jobsMutex_);
    invalidate();
    const bool ok = audio != nullptr && !audio->empty() && !(*audio)[0].empty() && unshifted != nullptr;
    audio_ = ok ? std::move(audio) : nullptr;
    unshifted_ = ok ? unshifted : nullptr;
    const juce::SpinLock::ScopedLockType slots(slotLock_);
    slots_[(size_t) slotOf(0)] = unshifted_;
}

// Drops every copy (new result or new window). Copies still growing are marked abandoned, so a
// voice that is playing one ends where the copy ends instead of waiting for it.
void SpectralBank::invalidate() {
    ++generation_;
    for (auto& j : jobs_) j->buffer->abandoned.store(true);
    jobs_.clear();
    const juce::SpinLock::ScopedLockType slots(slotLock_);
    for (auto& s : slots_)
        if (s != nullptr) {
            if (s != unshifted_) garbage_.add(s);
            s = nullptr;
        }
    for (auto& r : requested_) r.store(false);
    builtWindow_ = window_.load();
    readyAhead_ = 0;
}

void SpectralBank::collectGarbage() {
    juce::ReferenceCountedArray<SampleBuffer> drop;   // freed after the lock is released
    {
        const juce::SpinLock::ScopedLockType slots(slotLock_);
        for (int i = garbage_.size(); --i >= 0;)
            if (garbage_.getObjectPointerUnchecked(i)->getReferenceCount() == 1) {
                drop.add(garbage_.getObjectPointerUnchecked(i));
                garbage_.remove(i);
            }
    }
}

// ------------------------------------------------------------------------------ audio thread
bool SpectralBank::lookup(int shift, SampleBuffer::Ptr& out) {
    const int i = slotOf(std::clamp(shift, -kMaxShift, kMaxShift));
    const juce::SpinLock::ScopedTryLockType lock(slotLock_);
    if (!lock.isLocked()) return false;
    out = slots_[(size_t) i];
    lastUse_[(size_t) i].store(++clock_, std::memory_order_relaxed);
    if (out == nullptr && !requested_[(size_t) i].exchange(true)) {
        const auto scope = fifo_.write(1);
        if (scope.blockSize1 > 0) fifoData_[(size_t) scope.startIndex1] = i - kMaxShift;
        else requested_[(size_t) i].store(false);   // full: ask again next block
    }
    return true;
}

// ------------------------------------------------------------------------------ workers
void SpectralBank::drainRequests() {
    const auto scope = fifo_.read(fifo_.getNumReady());
    auto take = [&](int start, int size) {
        for (int k = 0; k < size; ++k) {
            const int shift = fifoData_[(size_t) (start + k)];
            const auto it = std::find_if(jobs_.begin(), jobs_.end(), [&](auto& j) { return j->shift == shift; });
            if (it != jobs_.end()) {                     // being computed ahead: promote it
                if (!(*it)->demanded) { (*it)->demanded = true; (*it)->order = ++orderCounter_; }
            } else if (slots_[(size_t) slotOf(shift)] == nullptr) {
                startJob(shift, true);
            }
            requested_[(size_t) slotOf(shift)].store(false);
        }
    };
    take(scope.startIndex1, scope.blockSize1);
    take(scope.startIndex2, scope.blockSize2);
}

bool SpectralBank::makeRoom(std::int64_t bytes, bool evict) {
    auto sizeOf = [](const SampleBuffer::Ptr& b) { return (std::int64_t) b->audio.getNumChannels() * b->audio.getNumSamples() * (std::int64_t) sizeof(float); };
    std::int64_t used = 0;
    for (int i = 0; i < (int) slots_.size(); ++i)
        if (slots_[(size_t) i] != nullptr && i != slotOf(0)) used += sizeOf(slots_[(size_t) i]);
    while (used + bytes > kBudgetBytes) {
        if (!evict) return false;
        int victim = -1;   // least recently played finished copy
        for (int i = 0; i < (int) slots_.size(); ++i) {
            const auto& s = slots_[(size_t) i];
            if (s == nullptr || i == slotOf(0) || s->ready.load() < s->audio.getNumSamples()) continue;
            if (victim < 0 || lastUse_[(size_t) i].load() < lastUse_[(size_t) victim].load()) victim = i;
        }
        if (victim < 0) return false;
        used -= sizeOf(slots_[(size_t) victim]);
        const juce::SpinLock::ScopedLockType slots(slotLock_);
        garbage_.add(slots_[(size_t) victim]);
        slots_[(size_t) victim] = nullptr;
    }
    return true;
}

std::shared_ptr<SpectralBank::Job> SpectralBank::startJob(int shift, bool demanded) {
    if (audio_ == nullptr || shift == 0) return nullptr;
    const int channels = (int) audio_->size(), length = (int) (*audio_)[0].size();
    if (!makeRoom((std::int64_t) channels * length * (std::int64_t) sizeof(float), demanded)) return nullptr;
    auto job = std::make_shared<Job>();
    job->shift = shift;
    job->demanded = demanded;
    job->order = ++orderCounter_;
    job->shifter = std::make_unique<fz::SpectralShifter>(audio_, (double) shift, builtWindow_);
    job->buffer = new SampleBuffer();
    job->buffer->sampleRate = 48000.0;
    job->buffer->audio.setSize(channels, length);   // only [0, ready) is ever read
    job->buffer->ready.store(0);
    {
        const juce::SpinLock::ScopedLockType slots(slotLock_);
        slots_[(size_t) slotOf(shift)] = job->buffer;
        lastUse_[(size_t) slotOf(shift)].store(++clock_);
    }
    jobs_.push_back(job);
    return job;
}

std::shared_ptr<SpectralBank::Job> SpectralBank::pickJob() {
    std::lock_guard lock(jobsMutex_);
    if (window_.load() != builtWindow_) invalidate();
    drainRequests();
    std::shared_ptr<Job> best;
    for (auto& j : jobs_) {
        if (j->busy) continue;
        if (best == nullptr || (j->demanded && !best->demanded) ||
            (j->demanded == best->demanded && (j->demanded ? j->order < best->order : std::abs(j->shift) < std::abs(best->shift))))
            best = j;
    }
    if (best == nullptr && active_.load() && audio_ != nullptr) {   // nothing asked: compute ahead
        for (int d = 1; d <= kAheadRange && best == nullptr; ++d)
            for (int s : {d, -d})
                if (slots_[(size_t) slotOf(s)] == nullptr) {
                    best = startJob(s, false);
                    if (best == nullptr) d = kAheadRange;   // over budget: stop computing ahead
                    break;
                }
    }
    if (best != nullptr) best->busy = true;
    return best;
}

bool SpectralBank::step() {
    auto job = pickJob();
    if (job == nullptr) { updateReadyCount(); return false; }

    thread_local fz::Channels part;
    const std::int64_t from = job->shifter->produced();
    job->shifter->process(from == 0 ? 4096 : 16384, part);   // a small first chunk: the note starts sooner
    auto& audio = job->buffer->audio;
    for (int c = 0; c < audio.getNumChannels(); ++c) {
        float* dst = audio.getWritePointer(c) + from;
        const auto& src = part[(size_t) c];
        for (size_t i = 0; i < src.size(); ++i) dst[i] = (float) src[i];
    }
    job->buffer->ready.store((int) job->shifter->produced(), std::memory_order_release);

    {
        std::lock_guard lock(jobsMutex_);
        job->busy = false;
        if (job->shifter->done()) jobs_.erase(std::remove(jobs_.begin(), jobs_.end(), job), jobs_.end());
    }
    updateReadyCount();
    return true;
}

void SpectralBank::updateReadyCount() {
    std::lock_guard lock(jobsMutex_);
    int ready = 0;
    for (int d = 1; d <= kAheadRange; ++d)
        for (int s : {d, -d}) {
            const auto& b = slots_[(size_t) slotOf(s)];
            if (b != nullptr && b->ready.load() >= b->audio.getNumSamples()) ++ready;
        }
    readyAhead_ = ready;
    totalAhead_ = active_.load() && audio_ != nullptr ? 2 * kAheadRange : 0;
}

} // namespace fzp

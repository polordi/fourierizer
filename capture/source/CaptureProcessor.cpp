#include "CaptureProcessor.h"

#include <Captures.h>

#include "CaptureEditor.h"

CaptureProcessor::CaptureProcessor()
    : AudioProcessor(BusesProperties()
                         .withInput("Input", juce::AudioChannelSet::stereo(), true)
                         .withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
    writerThread_.startThread();
    startTimerHz(30);
}

CaptureProcessor::~CaptureProcessor() {
    stopTimer();
    {
        const juce::SpinLock::ScopedLockType lock(lock_);
        if (active_ != nullptr) done_[0] = std::move(active_);   // a recording in progress is kept
    }
    timerCallback();
    disarm();
    if (waitingRec_ != nullptr) { waitingRec_->writer.reset(); waitingRec_->file.deleteFile(); }
    writerThread_.stopThread(4000);
}

bool CaptureProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    const auto in = layouts.getMainInputChannelSet(), out = layouts.getMainOutputChannelSet();
    return in == out && (out == juce::AudioChannelSet::mono() || out == juce::AudioChannelSet::stereo());
}

void CaptureProcessor::prepareToPlay(double sampleRate, int) {
    const bool changed = std::abs(sampleRate - sampleRate_.load()) > 0.5;
    sampleRate_ = sampleRate;
    preroll_.setSize(2, std::max(1, (int) (0.05 * sampleRate)));   // allocated here, never on the audio thread
    preroll_.clear();
    prerollPos_ = prerollFill_ = 0;
    if (changed) disarm();   // an armed file has the old rate in its header
}

void CaptureProcessor::releaseResources() {}

// ------------------------------------------------------------------------------ audio thread
void CaptureProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    const int n = buffer.getNumSamples(), chans = std::min(getTotalNumInputChannels(), buffer.getNumChannels());
    for (int c = 0; c < std::min(chans, 2); ++c) {
        const float p = buffer.getMagnitude(c, 0, n);
        if (p > peak_[(size_t) c].load()) peak_[(size_t) c] = p;
    }

    bool playing = false;
    if (auto* ph = getPlayHead())
        if (const auto pos = ph->getPosition()) playing = pos->getIsPlaying();
    if (!playing) holdUntilStop_ = false;
    float blockPeak = 0;
    for (int c = 0; c < chans; ++c) blockPeak = std::max(blockPeak, buffer.getMagnitude(c, 0, n));

    const juce::SpinLock::ScopedTryLockType lock(lock_);
    if (!lock.isLocked()) return;   // the message thread is swapping recorders: skip this block

    // Start on signal: wait for the threshold, then write the pre-roll and go on recording.
    if (waitingRec_ != nullptr && chans > 0) {
        if (blockPeak >= juce::Decibels::decibelsToGain(thresholdDb_.load())) {
            active_ = std::move(waitingRec_);
            recorded_ = 0;
            byTransport_ = false;
            waiting_ = false;
            recording_ = true;
            const int len = preroll_.getNumSamples(), start = (prerollPos_ - prerollFill_ + len) % len;
            for (int done = 0; done < prerollFill_;) {   // oldest first, in up to two pieces
                const int at = (start + done) % len, take = std::min(prerollFill_ - done, len - at);
                const float* ptrs[2] = {preroll_.getReadPointer(0, at), preroll_.getReadPointer(chans > 1 ? 1 : 0, at)};
                active_->writer->write(ptrs, take);
                recorded_ += take;
                done += take;
            }
            prerollFill_ = 0;
        } else {   // keep the last 50 ms
            const int len = preroll_.getNumSamples();
            for (int i = std::max(0, n - len); i < n; ++i) {
                for (int c = 0; c < 2; ++c) preroll_.setSample(c, prerollPos_, buffer.getSample(std::min(c, chans - 1), i));
                prerollPos_ = (prerollPos_ + 1) % len;
            }
            prerollFill_ = std::min(len, prerollFill_ + n);
        }
    }

    auto stopActive = [&] {
        for (auto& d : done_)
            if (d == nullptr) {
                active_->samples = recorded_.load();
                d = std::move(active_);   // a move: nothing is freed here
                recording_ = false;
                return;
            }
    };
    // Record while playing: start on the transport's first block, stop when it stops.
    if (follow_ && playing && !wasPlaying_ && active_ == nullptr && armed_ != nullptr && !holdUntilStop_) {
        active_ = std::move(armed_);
        recorded_ = 0;
        byTransport_ = true;
        recording_ = true;
    }
    if (active_ != nullptr && byTransport_ && !playing) stopActive();
    wasPlaying_ = playing;

    if (active_ != nullptr && chans > 0) {
        const juce::int64 max = (juce::int64) (fzshared::kMaxCaptureSeconds * sampleRate_.load());
        const int take = (int) std::min<juce::int64>(n, max - recorded_.load());
        if (take > 0) active_->writer->write(buffer.getArrayOfReadPointers(), take);
        recorded_ += std::max(take, 0);
        if (recorded_.load() >= max) {   // the instrument's 60 s limit
            if (byTransport_) holdUntilStop_ = true;
            stopActive();
        }
    }
    // the audio passes through untouched
}

// ------------------------------------------------------------------------------ message thread
std::unique_ptr<CaptureProcessor::Recorder> CaptureProcessor::makeRecorder() {
    const auto folder = fzshared::capturesFolder();
    if (!folder.createDirectory()) return nullptr;
    auto r = std::make_unique<Recorder>();
    r->file = folder.getNonexistentChildFile("Recording", ".wav");   // renamed when finished
    std::unique_ptr<juce::OutputStream> os = r->file.createOutputStream();
    if (os == nullptr) return nullptr;
    juce::WavAudioFormat wav;
    const int chans = juce::jlimit(1, 2, getTotalNumInputChannels());
    auto writer = wav.createWriterFor(os, juce::AudioFormatWriterOptions{}.withSampleRate(sampleRate_.load()).withNumChannels(chans).withBitsPerSample(24));
    if (writer == nullptr) { r->file.deleteFile(); return nullptr; }
    // Room for the whole 60 s: nothing is lost even if the disk stalls, or the host renders
    // faster than real time (an export). About 23 MB for stereo at 48 kHz, while armed or recording.
    const int room = (int) (fzshared::kMaxCaptureSeconds * sampleRate_.load()) + 8192;
    r->writer = std::make_unique<juce::AudioFormatWriter::ThreadedWriter>(writer.release(), writerThread_, room);
    return r;
}

void CaptureProcessor::toggleRecord() {
    if (waiting_) {   // cancel the wait: the prepared file is dropped
        std::unique_ptr<Recorder> r;
        {
            const juce::SpinLock::ScopedLockType lock(lock_);
            r = std::move(waitingRec_);
            waiting_ = false;
        }
        if (r != nullptr) { r->writer.reset(); r->file.deleteFile(); }
        return;
    }
    if (recording_) {
        const juce::SpinLock::ScopedLockType lock(lock_);
        for (auto& d : done_)
            if (d == nullptr && active_ != nullptr) {
                active_->samples = recorded_.load();
                d = std::move(active_);
                recording_ = false;
                if (byTransport_) holdUntilStop_ = true;   // do not restart until the transport stops
            }
        return;
    }
    std::unique_ptr<Recorder> r;
    {
        const juce::SpinLock::ScopedLockType lock(lock_);
        r = std::move(armed_);
    }
    if (r == nullptr) r = makeRecorder();
    if (r == nullptr) return;
    if (waitSignal_) {   // the audio thread starts it when the input crosses the threshold
        const juce::SpinLock::ScopedLockType lock(lock_);
        prerollFill_ = 0;
        waitingRec_ = std::move(r);
        waiting_ = true;
        return;
    }
    r->started = juce::Time::getCurrentTime();
    const juce::SpinLock::ScopedLockType lock(lock_);
    active_ = std::move(r);
    recorded_ = 0;
    byTransport_ = false;
    recording_ = true;
}

void CaptureProcessor::setFollowTransport(bool on) {
    follow_ = on;
    if (!on) disarm();
}

void CaptureProcessor::disarm() {
    std::unique_ptr<Recorder> r;
    {
        const juce::SpinLock::ScopedLockType lock(lock_);
        r = std::move(armed_);
    }
    if (r != nullptr) {
        r->writer.reset();
        r->file.deleteFile();
    }
}

void CaptureProcessor::finish(std::unique_ptr<Recorder> r) {
    r->writer.reset();   // flushes the FIFO and closes the file
    const double seconds = (double) r->samples / std::max(1.0, sampleRate_.load());
    if (seconds < 0.05) { r->file.deleteFile(); return; }
    const auto when = (r->started.toMilliseconds() > 0 ? r->started : juce::Time::getCurrentTime()).formatted("%Y-%m-%d %H.%M.%S");
    const auto base = juce::File::createLegalFileName((trackName_.isNotEmpty() ? trackName_ : juce::String("Capture")) + " " + when);
    const auto target = r->file.getParentDirectory().getNonexistentChildFile(base, ".wav");
    if (r->file.moveFileTo(target)) r->file = target;
    lastCapture_ = r->file.getFileName() + "  ·  " + juce::String(seconds, 1) + " s";
    if (onCaptureSaved) onCaptureSaved();
}

void CaptureProcessor::timerCallback() {
    // note when a transport-started recording began (for its file name)
    {
        const juce::SpinLock::ScopedLockType lock(lock_);
        if (active_ != nullptr && active_->started.toMilliseconds() == 0)
            active_->started = juce::Time::getCurrentTime() - juce::RelativeTime::seconds(recordedSeconds());
    }
    for (size_t i = 0; i < done_.size(); ++i) {
        std::unique_ptr<Recorder> r;
        {
            const juce::SpinLock::ScopedLockType lock(lock_);
            r = std::move(done_[i]);
        }
        if (r != nullptr) finish(std::move(r));
    }
    if (follow_ && !isNonRealtime()) {
        bool need;
        {
            const juce::SpinLock::ScopedLockType lock(lock_);
            need = armed_ == nullptr;
        }
        if (need)
            if (auto r = makeRecorder()) {
                const juce::SpinLock::ScopedLockType lock(lock_);
                armed_ = std::move(r);
            }
    }
}

void CaptureProcessor::updateTrackProperties(const TrackProperties& properties) {
    // called on the message thread by most hosts
    trackName_ = properties.name.value_or(juce::String());
}

// ------------------------------------------------------------------------------ state
void CaptureProcessor::getStateInformation(juce::MemoryBlock& destData) {
    juce::ValueTree t("FourierizerCapture");
    t.setProperty("follow", follow_.load(), nullptr);
    t.setProperty("waitSignal", waitSignal_.load(), nullptr);
    t.setProperty("threshold", thresholdDb_.load(), nullptr);
    juce::MemoryOutputStream out(destData, false);
    t.writeToStream(out);
}

void CaptureProcessor::setStateInformation(const void* data, int sizeInBytes) {
    const auto t = juce::ValueTree::readFromData(data, (size_t) sizeInBytes);
    if (!t.hasType("FourierizerCapture")) return;
    setFollowTransport((bool) t["follow"]);
    setWaitForSignal((bool) t["waitSignal"]);
    if (t.hasProperty("threshold")) setThresholdDb((float) t["threshold"]);
}

juce::AudioProcessorEditor* CaptureProcessor::createEditor() { return new CaptureEditor(*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new CaptureProcessor(); }

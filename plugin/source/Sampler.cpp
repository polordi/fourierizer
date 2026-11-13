#include "Sampler.h"

#include <cmath>

namespace fzp {

Sampler::Sampler() = default;

void Sampler::prepare(double hostSampleRate) { hostRate_ = hostSampleRate > 0 ? hostSampleRate : 48000.0; }

// ------------------------------------------------------------------------------ hand-off
void Sampler::setResult(SampleBuffer::Ptr buffer) {
    const juce::SpinLock::ScopedLockType lock(handoff_);
    if (buffer != nullptr) pool_.add(buffer);
    pendingResult_ = buffer.get();
    hasResult_ = buffer != nullptr && buffer->audio.getNumSamples() > 0;
    if (buffer == nullptr) pendingResult_ = reinterpret_cast<SampleBuffer*>(this);  // sentinel: clear
}

void Sampler::playPreview(int layer, SampleBuffer::Ptr buffer, SampleBuffer::Ptr original, float gain, bool startOriginal) {
    const juce::SpinLock::ScopedLockType lock(handoff_);
    pool_.add(buffer);
    if (original != nullptr) pool_.add(original);
    pendingPreview_ = buffer.get();
    pendingOriginal_ = original.get();
    previewOriginal_ = startOriginal && original != nullptr;
    pendingPreviewLayer_ = layer;
    pendingPreviewGain_ = gain;
    stopPreviewFlag_ = false;
}

void Sampler::stopPreview() {
    {
        const juce::SpinLock::ScopedLockType lock(handoff_);
        pendingPreview_ = nullptr;
    }
    stopPreviewFlag_ = true;
}

void Sampler::collectGarbage() {
    const juce::SpinLock::ScopedLockType lock(handoff_);
    for (int i = pool_.size(); --i >= 0;) {
        auto* b = pool_.getObjectPointerUnchecked(i);
        if (b->getReferenceCount() == 1 && b != pendingResult_ && b != pendingPreview_ && b != pendingOriginal_) pool_.remove(i);
    }
}

void Sampler::takePending() {
    const juce::SpinLock::ScopedTryLockType lock(handoff_);
    if (!lock.isLocked()) return;  // try again next block
    if (pendingResult_ != nullptr) {
        current_ = pendingResult_ == reinterpret_cast<SampleBuffer*>(this) ? nullptr : pendingResult_;
        pendingResult_ = nullptr;
    }
    if (pendingPreview_ != nullptr) {
        preview_.buffer = pendingPreview_;
        preview_.original = pendingOriginal_;
        preview_.mix = previewOriginal_ ? 1.0f : 0.0f;
        preview_.layer = pendingPreviewLayer_;
        preview_.gain = pendingPreviewGain_;
        preview_.pos = 0;
        preview_.active = true;
        preview_.stopping = false;
        preview_.fade = 1;
        pendingPreview_ = nullptr;
        pendingOriginal_ = nullptr;
    }
}

// ------------------------------------------------------------------------------ UI notes
void Sampler::uiNoteOn(int note, float velocity) {
    const auto scope = fifo_.write(1);
    if (scope.blockSize1 > 0) fifoData_[(size_t) scope.startIndex1] = {0, note, velocity};
}
void Sampler::uiNoteOff(int note) {
    const auto scope = fifo_.write(1);
    if (scope.blockSize1 > 0) fifoData_[(size_t) scope.startIndex1] = {1, note, 0};
}
void Sampler::uiAllOff() {
    const auto scope = fifo_.write(1);
    if (scope.blockSize1 > 0) fifoData_[(size_t) scope.startIndex1] = {2, 0, 0};
}

// ------------------------------------------------------------------------------ voices
void Sampler::noteOn(int note, float velocity, int root) {
    if (current_ == nullptr || current_->audio.getNumSamples() == 0) return;
    Voice* v = nullptr;
    for (auto& c : voices_)
        if (!c.active) { v = &c; break; }
    if (v == nullptr) {  // steal the oldest
        v = &voices_[0];
        for (auto& c : voices_)
            if (c.age < v->age) v = &c;
    }
    v->active = true;
    v->released = false;
    v->held = false;
    v->note = note;
    v->velocity = velocity;
    v->level = 0;
    v->pos = 0;
    v->t = 0;
    v->buffer = current_;
    v->step = std::pow(2.0, (note - root) / 12.0) * current_->sampleRate / hostRate_;
    v->age = ++ageCounter_;
}

void Sampler::startRelease(Voice& v) {
    v.released = true;
    v.releaseFrom = v.level;
    v.tRelease = 0;
}

void Sampler::noteOff(int note) {
    for (auto& v : voices_)
        if (v.active && !v.released && v.note == note) {
            if (sustainPedal_) v.held = true;
            else startRelease(v);
        }
}

void Sampler::allOff() {
    for (auto& v : voices_)
        if (v.active && !v.released) startRelease(v);
    sustainPedal_ = false;
}

// Linear attack to 1, exponential decay toward the sustain level (time constant decay/3, as in
// the browser demo), linear release from the current level.
float Sampler::envelopeStep(Voice& v, const Envelope& env, double dt) {
    if (v.released) {
        v.tRelease += dt;
        const double r = std::max(0.001, (double) env.release);
        v.level = (float) std::max(0.0, v.releaseFrom * (1.0 - v.tRelease / r));
        if (v.tRelease >= r) { v.active = false; v.buffer = nullptr; }
        return v.level;
    }
    v.t += dt;
    const double a = std::max(0.001, (double) env.attack);
    if (v.t < a) v.level = (float) (v.t / a);
    else {
        const double tau = std::max(0.001, env.decay / 3.0);
        v.level = (float) (env.sustain + (1.0 - env.sustain) * std::exp(-(v.t - a) / tau));
    }
    return v.level;
}

static inline float hermite(const float* x, int n, double pos) {
    const int i = (int) pos;
    const float f = (float) (pos - i);
    auto at = [&](int k) { return k >= 0 && k < n ? x[k] : 0.0f; };
    const float xm1 = at(i - 1), x0 = at(i), x1 = at(i + 1), x2 = at(i + 2);
    const float c1 = 0.5f * (x1 - xm1), c2 = xm1 - 2.5f * x0 + 2.0f * x1 - 0.5f * x2, c3 = 0.5f * (x2 - xm1) + 1.5f * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
}

void Sampler::process(juce::AudioBuffer<float>& out, const juce::MidiBuffer& midi, const Envelope& env, int root, float gain) {
    takePending();
    if (stopPreviewFlag_.exchange(false) && preview_.active) preview_.stopping = true;

    // UI notes first (they apply at the start of the block)
    const auto scope = fifo_.read(fifo_.getNumReady());
    auto apply = [&](int start, int size) {
        for (int k = 0; k < size; ++k) {
            const auto& e = fifoData_[(size_t) (start + k)];
            if (e.type == 0) noteOn(e.note, e.velocity, root);
            else if (e.type == 1) noteOff(e.note);
            else allOff();
        }
    };
    apply(scope.startIndex1, scope.blockSize1);
    apply(scope.startIndex2, scope.blockSize2);

    const int n = out.getNumSamples(), chans = out.getNumChannels();
    const double dt = 1.0 / hostRate_;
    auto renderSpan = [&](int from, int to) {
        for (auto& v : voices_) {
            if (!v.active) continue;
            const auto& a = v.buffer->audio;
            const int len = a.getNumSamples(), bc = a.getNumChannels();
            for (int s = from; s < to && v.active; ++s) {
                if (v.pos >= len) { v.active = false; v.buffer = nullptr; break; }
                const float g = envelopeStep(v, env, dt) * v.velocity * gain;
                if (!v.active) break;
                for (int c = 0; c < chans; ++c)
                    out.addSample(c, s, g * hermite(a.getReadPointer(std::min(c, bc - 1)), len, v.pos));
                v.pos += v.step;
            }
        }
        if (preview_.active) {
            const auto& a = preview_.buffer->audio;
            const auto* o = preview_.original != nullptr ? &preview_.original->audio : nullptr;
            const int len = a.getNumSamples(), bc = a.getNumChannels(), oc = o ? o->getNumChannels() : 0, olen = o ? o->getNumSamples() : 0;
            const double step = preview_.buffer->sampleRate / hostRate_;
            const float target = (o != nullptr && previewOriginal_.load()) ? 1.0f : 0.0f, glide = (float) (dt / 0.012);  // 12 ms A/B crossfade
            for (int s = from; s < to; ++s) {
                if (preview_.pos >= len || preview_.fade <= 0) { preview_.active = false; preview_.buffer = nullptr; preview_.original = nullptr; break; }
                if (preview_.stopping) preview_.fade -= (float) (dt / 0.015);  // 15 ms fade-out
                preview_.mix += juce::jlimit(-glide, glide, target - preview_.mix);
                const float g = preview_.gain * gain * std::max(0.0f, preview_.fade), m = preview_.mix;
                for (int c = 0; c < chans; ++c) {
                    float v = (1 - m) * hermite(a.getReadPointer(std::min(c, bc - 1)), len, preview_.pos);
                    if (m > 0) v += m * hermite(o->getReadPointer(std::min(c, oc - 1)), olen, preview_.pos);
                    out.addSample(c, s, g * v);
                }
                preview_.pos += step;
            }
        }
    };

    int cursor = 0;
    for (const auto meta : midi) {
        const int at = juce::jlimit(0, n, meta.samplePosition);
        renderSpan(cursor, at);
        cursor = at;
        const auto m = meta.getMessage();
        if (m.isNoteOn()) noteOn(m.getNoteNumber(), m.getFloatVelocity(), root);
        else if (m.isNoteOff()) noteOff(m.getNoteNumber());
        else if (m.isAllNotesOff() || m.isAllSoundOff()) allOff();
        else if (m.isSustainPedalOn()) sustainPedal_ = true;
        else if (m.isSustainPedalOff()) {
            sustainPedal_ = false;
            for (auto& v : voices_)
                if (v.active && v.held && !v.released) startRelease(v);
        }
    }
    renderSpan(cursor, n);

    // positions for the UI
    const Voice* newest = nullptr;
    int count = 0;
    for (const auto& v : voices_)
        if (v.active) {
            ++count;
            if (newest == nullptr || v.age > newest->age) newest = &v;
        }
    activeVoices_ = count;
    resultPos_ = newest != nullptr ? (float) (newest->pos / std::max(1, newest->buffer->audio.getNumSamples())) : -1.0f;
    if (preview_.active) {
        previewLayerOut_ = preview_.layer;
        previewPos_ = (float) (preview_.pos / std::max(1, preview_.buffer->audio.getNumSamples()));
    } else {
        previewLayerOut_ = -1;
        previewPos_ = -1;
    }
}

} // namespace fzp

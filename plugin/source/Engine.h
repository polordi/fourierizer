// The plugin's engine service: owns the four sources, runs every heavy job (decode, spectrogram,
// render, layer preview) on background threads with fourierizer-core, hands results to the
// Sampler, and saves / restores the whole project (UI state, last render request and the
// sources as FLAC) inside the host's project file.
//
// It works with or without the editor: when FL Studio loads a project with the window closed,
// setState() re-renders the saved request so the instrument plays right away.
#pragma once

#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>
#include <juce_data_structures/juce_data_structures.h>

#include <fourierizer/ops.h>
#include <fourierizer/render.h>
#include <fourierizer/spectrogram.h>

#include <array>
#include <functional>
#include <map>
#include <memory>
#include <mutex>

#include "Sampler.h"

namespace fzp {

inline constexpr double kProjectRate = 48000.0;   // the UI and the sources live at 48 kHz
inline constexpr double kMaxSeconds = 60.0;

using Done = std::function<void(juce::var)>;      // called on a background thread

class Engine {
public:
    explicit Engine(Sampler& sampler);
    ~Engine();

    // ---- sources (any thread). Info: {name, samples, channels}
    juce::var setSource(int layer, const juce::String& name, fz::Channels audio, std::shared_ptr<juce::MemoryBlock> flac = {});
    juce::var sourceInfo(int layer) const;
    void decodeBytes(int layer, juce::MemoryBlock bytes, const juce::String& name, Done done);
    void decodeFile(int layer, const juce::File& file, Done done);
    juce::var resultToLayer(int layer, const juce::String& name);
    void clearSource(int layer);
    void clearResult();

    // ---- jobs (results through `done`)
    void spectrogram(int layer, double pitch, const fz::Grid& grid, const fz::Axis& axis, Done done);
    void render(const juce::var& request, Done done);       // supersedes (cancels) the previous one
    void resultImage(const fz::Axis& axis, Done done);       // the current result on another axis
    void preview(const juce::var& layerJob, bool original, Done done);

    // ---- data the UI fetches by key through the resource provider
    std::optional<std::vector<std::byte>> blob(const juce::String& key) const;
    juce::var resultInfo() const;
    juce::File resultWavFile() const;                      // last render as a WAV (for drag & drop)
    bool writeResultWav(const juce::File& file) const;

    // ---- project
    void setProject(const juce::String& json);
    juce::String project() const;
    juce::MemoryBlock saveState(const juce::ValueTree& params) const;
    juce::ValueTree loadState(const void* data, int size);  // returns the saved parameter tree
    std::function<void()> onProjectLoaded;                   // after setState (message thread)

    static fz::Grid gridOf(const juce::var& v);
    static fz::Axis axisOf(const juce::var& v);
    static std::vector<fz::Shape> shapesOf(const juce::var& v);

private:
    struct Source {
        juce::String name;
        std::shared_ptr<const fz::Channels> audio;
        std::shared_ptr<juce::MemoryBlock> flac;   // encoded lazily, cached for saving
    };
    std::shared_ptr<const fz::Channels> pitched(int layer, double semitones);
    juce::var finishDecode(int layer, juce::AudioFormatReader* reader, const juce::String& name);
    juce::String putBlob(const juce::String& prefix, std::vector<std::byte> data);
    std::shared_ptr<juce::MemoryBlock> encodeFlac(const fz::Channels& audio) const;
    void runRender(const juce::var& request, std::shared_ptr<std::atomic<bool>> cancel, Done done);

    Sampler& sampler_;
    juce::ThreadPool pool_{3};
    juce::AudioFormatManager formats_;

    mutable std::mutex mutex_;                                       // guards everything below
    std::array<Source, 4> sources_;
    std::map<std::string, std::shared_ptr<const fz::Channels>> pitchCache_;
    std::map<juce::String, std::vector<std::byte>> blobs_;
    std::map<juce::String, juce::String> latestBlob_;                // prefix -> key
    juce::uint64 blobCounter_ = 0;
    juce::String project_;
    juce::var lastRequest_;
    std::shared_ptr<const fz::Channels> result_;
    juce::var resultInfo_;
    std::shared_ptr<std::atomic<bool>> renderCancel_;
    juce::uint64 renderGeneration_ = 0;
    juce::File resultWav_;
};

} // namespace fzp

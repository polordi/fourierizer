#include "Engine.h"

#include <fourierizer/resample.h>
#include <fourierizer/spectrogram.h>

#include <chrono>

namespace fzp {

namespace {
const fz::Grid kResultGrid{fz::Window::Hann, 2048, 2048, 256};
constexpr int kStateMagic = 0x467a5232;  // "FzR2"

double num(const juce::var& v, double fallback = 0) { return v.isVoid() || v.isUndefined() ? fallback : (double) v; }

juce::var obj(std::initializer_list<std::pair<const char*, juce::var>> props) {
    auto* o = new juce::DynamicObject();
    for (auto& [k, v] : props) o->setProperty(k, v);
    return juce::var(o);
}

juce::var errorVar(const juce::String& message) { return obj({{"error", message}}); }

std::vector<std::byte> toBytes(const std::vector<uint8_t>& v) {
    std::vector<std::byte> b(v.size());
    std::memcpy(b.data(), v.data(), v.size());
    return b;
}

juce::String tempFolderName() { return "Fourierizer"; }

template <typename F>
struct LambdaJob : juce::ThreadPoolJob {
    F fn;
    LambdaJob(const juce::String& name, F f) : juce::ThreadPoolJob(name), fn(std::move(f)) {}
    JobStatus runJob() override { fn(); return jobHasFinished; }
};
template <typename F>
void run(juce::ThreadPool& pool, const juce::String& name, F f) { pool.addJob(new LambdaJob<F>(name, std::move(f)), true); }
} // namespace

Engine::Engine(Sampler& sampler, SpectralBank& bank) : sampler_(sampler), bank_(bank) {
    formats_.registerBasicFormats();
    resultWav_ = juce::File::getSpecialLocation(juce::File::tempDirectory)
                     .getChildFile(tempFolderName())
                     .getChildFile("Fourierizer result " + juce::String::toHexString(juce::Random::getSystemRandom().nextInt()) + ".wav");
}

Engine::~Engine() {
    {
        std::lock_guard lock(mutex_);
        if (renderCancel_) *renderCancel_ = true;
    }
    pool_.removeAllJobs(true, 10000);
    resultWav_.deleteFile();
}

// ------------------------------------------------------------------------------ parsing
fz::Grid Engine::gridOf(const juce::var& v) {
    return {fz::windowFromName(v["window"].toString().toStdString()), (int) v["L"], (int) v["N"], (int) v["H"]};
}

fz::Axis Engine::axisOf(const juce::var& v) {
    fz::Axis a;
    if (!v.isObject()) return a;
    a.fmin = std::max(0.0, num(v["fmin"], fz::kSpecFMin));
    a.fmax = std::max(a.fmin + 100, num(v["fmax"], fz::kSpecFMax));
    a.log = v["scale"].toString() != "lin";
    if (a.log) a.fmin = std::max(a.fmin, 20.0);
    return a;
}

std::vector<fz::Shape> Engine::shapesOf(const juce::var& v) {
    std::vector<fz::Shape> out;
    if (auto* arr = v.getArray())
        for (auto& s : *arr) {
            fz::Shape sh;
            sh.kind = s["kind"].toString() == "poly" ? fz::ShapeKind::Poly : fz::ShapeKind::Rect;
            sh.mode = s["mode"].toString() == "subtract" ? fz::ShapeMode::Subtract : fz::ShapeMode::Add;
            sh.gain = num(s["gain"], 1.0);
            if (sh.kind == fz::ShapeKind::Rect) {
                sh.t = {num(s["t"][0]), num(s["t"][1])};
                sh.f = {num(s["f"][0]), num(s["f"][1])};
            } else if (auto* pts = s["points"].getArray()) {
                for (auto& p : *pts) sh.points.push_back({num(p[0]), num(p[1])});
                if (sh.points.size() < 3) continue;
            }
            if (s.hasProperty("featherS")) sh.featherS = num(s["featherS"]);
            if (s.hasProperty("featherOct")) sh.featherOct = num(s["featherOct"]);
            sh.fadeIn = num(s["fadeIn"]);
            sh.fadeOut = num(s["fadeOut"]);
            out.push_back(std::move(sh));
        }
    return out;
}

// ------------------------------------------------------------------------------ sources
juce::var Engine::setSource(int layer, const juce::String& name, fz::Channels audio, std::shared_ptr<juce::MemoryBlock> flac) {
    if (layer < 0 || layer > 3) return errorVar("bad layer");
    auto shared = std::make_shared<const fz::Channels>(std::move(audio));
    const int samples = shared->empty() ? 0 : (int) (*shared)[0].size(), chans = (int) shared->size();
    {
        std::lock_guard lock(mutex_);
        sources_[(size_t) layer] = {name, shared, flac};
        for (auto it = pitchCache_.begin(); it != pitchCache_.end();)
            it = it->first.rfind(std::to_string(layer) + ":", 0) == 0 ? pitchCache_.erase(it) : std::next(it);
    }
    if (flac == nullptr)  // encode in the background so saving the project stays instant
        run(pool_, "encode", [this, layer, shared] {
            auto enc = encodeFlac(*shared);
            std::lock_guard lock(mutex_);
            if (sources_[(size_t) layer].audio == shared) sources_[(size_t) layer].flac = enc;
        });
    return obj({{"name", name}, {"samples", samples}, {"channels", chans}});
}

juce::var Engine::sourceInfo(int layer) const {
    std::lock_guard lock(mutex_);
    const auto& s = sources_[(size_t) layer];
    if (s.audio == nullptr) return {};
    return obj({{"name", s.name}, {"samples", s.audio->empty() ? 0 : (int) (*s.audio)[0].size()}, {"channels", (int) s.audio->size()}});
}

juce::var Engine::finishDecode(int layer, juce::AudioFormatReader* reader, const juce::String& name) {
    std::unique_ptr<juce::AudioFormatReader> r(reader);
    if (r == nullptr || r->lengthInSamples <= 0) return errorVar("unsupported");
    const double rate = r->sampleRate > 0 ? r->sampleRate : kProjectRate;
    const auto chans = (int) juce::jlimit(1u, 2u, r->numChannels);
    const auto keep = (juce::int64) std::min<double>((double) r->lengthInSamples, kMaxSeconds * rate);
    juce::AudioBuffer<float> buf(chans, (int) keep);
    r->read(&buf, 0, (int) keep, 0, true, chans > 1);
    fz::Channels audio((size_t) chans);
    for (int c = 0; c < chans; ++c) {
        const float* p = buf.getReadPointer(c);
        fz::Signal x(p, p + keep);
        audio[(size_t) c] = rate == kProjectRate ? std::move(x) : fz::resampleRate(x, rate, kProjectRate);
    }
    auto info = setSource(layer, name, std::move(audio));
    info.getDynamicObject()->setProperty("trimmed", (double) r->lengthInSamples > kMaxSeconds * rate);
    return info;
}

void Engine::decodeBytes(int layer, juce::MemoryBlock bytes, const juce::String& name, Done done) {
    run(pool_, "decode", [this, layer, bytes = std::move(bytes), name, done] {
        auto stream = std::make_unique<juce::MemoryInputStream>(bytes, false);
        done(finishDecode(layer, formats_.createReaderFor(std::move(stream)), name));
    });
}

void Engine::decodeFile(int layer, const juce::File& file, Done done) {
    run(pool_, "decode", [this, layer, file, done] {
        done(finishDecode(layer, formats_.createReaderFor(file), file.getFileNameWithoutExtension()));
    });
}

void Engine::clearSource(int layer) {
    if (layer < 0 || layer > 3) return;
    std::lock_guard lock(mutex_);
    sources_[(size_t) layer] = {};
    for (auto it = pitchCache_.begin(); it != pitchCache_.end();)
        it = it->first.rfind(std::to_string(layer) + ":", 0) == 0 ? pitchCache_.erase(it) : std::next(it);
    if (auto it = latestBlob_.find("spec" + juce::String(layer)); it != latestBlob_.end()) { blobs_.erase(it->second); latestBlob_.erase(it); }
}

void Engine::clearResult() {
    {
        std::lock_guard lock(mutex_);
        if (renderCancel_) *renderCancel_ = true;
        result_ = nullptr;
        resultInfo_ = juce::var();
        lastRequest_ = juce::var();
    }
    sampler_.setResult(nullptr);
    bank_.setSource(nullptr, nullptr);
    resultWav_.deleteFile();
}

juce::var Engine::resultToLayer(int layer, const juce::String& name) {
    std::shared_ptr<const fz::Channels> r;
    {
        std::lock_guard lock(mutex_);
        r = result_;
    }
    if (r == nullptr || r->empty()) return errorVar("no result");
    return setSource(layer, name, *r);
}

std::shared_ptr<const fz::Channels> Engine::pitched(int layer, double semitones) {
    if (layer < 0 || layer > 3) return nullptr;
    std::shared_ptr<const fz::Channels> src;
    const std::string key = std::to_string(layer) + ":" + std::to_string(semitones);
    {
        std::lock_guard lock(mutex_);
        src = sources_[(size_t) layer].audio;
        if (src == nullptr || semitones == 0) return src;
        if (auto it = pitchCache_.find(key); it != pitchCache_.end()) return it->second;
    }
    fz::Channels p;  // computed outside the lock
    for (auto& c : *src) p.push_back(fz::tapePitch(c, semitones));
    auto shared = std::make_shared<const fz::Channels>(std::move(p));
    std::lock_guard lock(mutex_);
    if (sources_[(size_t) layer].audio == src) pitchCache_[key] = shared;
    return shared;
}

// ------------------------------------------------------------------------------ blobs
juce::String Engine::putBlob(const juce::String& prefix, std::vector<std::byte> data) {
    std::lock_guard lock(mutex_);
    if (auto it = latestBlob_.find(prefix); it != latestBlob_.end()) blobs_.erase(it->second);
    const auto key = prefix + "-" + juce::String(++blobCounter_);
    blobs_[key] = std::move(data);
    latestBlob_[prefix] = key;
    return key;
}

std::optional<std::vector<std::byte>> Engine::blob(const juce::String& key) const {
    std::lock_guard lock(mutex_);
    if (auto it = blobs_.find(key); it != blobs_.end()) return it->second;
    return std::nullopt;
}

// ------------------------------------------------------------------------------ jobs
void Engine::spectrogram(int layer, double pitch, const fz::Grid& grid, const fz::Axis& axis, Done done) {
    run(pool_, "spectrogram", [this, layer, pitch, grid, axis, done] {
        try {
            auto x = pitched(layer, pitch);
            if (x == nullptr) return done(errorVar("no audio in layer " + juce::String(layer + 1)));
            const auto img = fz::spectrogramImage(fz::midOf(*x), kProjectRate, grid, 1400, 360, axis);
            const auto key = putBlob("spec" + juce::String(layer), toBytes(img.data));
            done(obj({{"key", key}, {"cols", img.cols}, {"rows", img.rows}, {"duration", (double) (*x)[0].size() / kProjectRate}}));
        } catch (const std::exception& e) { done(errorVar(e.what())); }
    });
}

void Engine::render(const juce::var& request, Done done) {
    auto cancel = std::make_shared<std::atomic<bool>>(false);
    {
        std::lock_guard lock(mutex_);
        if (renderCancel_) *renderCancel_ = true;
        renderCancel_ = cancel;
        lastRequest_ = juce::JSON::parse(juce::JSON::toString(request, true));  // deep copy
    }
    run(pool_, "render", [this, request, cancel, done] { runRender(request, cancel, done); });
}

void Engine::runRender(const juce::var& request, std::shared_ptr<std::atomic<bool>> cancel, Done done) {
    const auto t0 = std::chrono::steady_clock::now();
    try {
        const auto op = fz::opFromName(request["op"].toString().toStdString());
        fz::Channels y;
        if (op == fz::Op::Sum) {
            std::vector<fz::LayerInput> layers;
            if (auto* arr = request["layers"].getArray())
                for (auto& l : *arr) {
                    auto x = pitched((int) l["id"], num(l["pitch"]));
                    if (x == nullptr) continue;
                    fz::LayerInput in{*x, gridOf(l["grid"]), shapesOf(l["shapes"])};
                    in.featherS = num(l["featherS"], 0.01);
                    in.featherOct = num(l["featherOct"], 1.0 / 12);
                    in.gainDb = num(l["gainDb"]);
                    in.offsetS = num(l["offsetS"]);
                    layers.push_back(std::move(in));
                }
            fz::RenderOptions o;
            o.threads = 4;
            o.cancel = cancel.get();
            y = fz::render(layers, kProjectRate, o);
        } else {
            std::vector<fz::OpLayer> all;
            if (auto* arr = request["all"].getArray())
                for (auto& l : *arr) {
                    if (!l.isObject()) { if (op != fz::Op::Max) all.push_back({}); continue; }
                    auto x = pitched((int) l["id"], num(l["pitch"]));
                    fz::OpLayer o{x ? *x : fz::Channels{}, shapesOf(l["shapes"])};
                    o.featherS = num(l["featherS"], 0.01);
                    o.featherOct = num(l["featherOct"], 1.0 / 12);
                    o.gainDb = num(l["gainDb"]);
                    o.offsetS = num(l["offsetS"]);
                    if (op == fz::Op::Max && o.channels.empty()) continue;
                    all.push_back(std::move(o));
                }
            y = fz::renderOp(all, op, kProjectRate, (int) request["a"], (int) request["b"], fz::kCommonGrid, 2, -0.3, cancel.get());
        }
        if (*cancel) return;

        const double peak = fz::peakOf(y);
        const int n = y.empty() ? 0 : (int) y[0].size();
        SampleBuffer::Ptr buf = new SampleBuffer();
        buf->sampleRate = kProjectRate;
        buf->audio.setSize(2, n);
        for (int c = 0; c < 2; ++c)
            for (int i = 0; i < n; ++i) buf->audio.setSample(c, i, (float) y[(size_t) std::min<size_t>((size_t) c, y.size() - 1)][(size_t) i]);
        const bool audible = n > 0 && peak > 0;
        auto shared = std::make_shared<const fz::Channels>(std::move(y));
        sampler_.setResult(audible ? buf : nullptr);
        bank_.setSource(audible ? shared : nullptr, audible ? buf : nullptr);

        juce::var image;
        if (n > 0) {
            const auto img = fz::spectrogramImage(fz::midOf(*shared), kProjectRate, kResultGrid, 1400, 300, axisOf(request["axis"]));
            image = obj({{"key", putBlob("result", toBytes(img.data))}, {"cols", img.cols}, {"rows", img.rows}});
        }
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        auto info = obj({{"peak", peak}, {"ms", ms}, {"duration", n / kProjectRate}, {"image", image}});
        {
            std::lock_guard lock(mutex_);
            result_ = shared;
            resultInfo_ = info;
        }
        if (n > 0 && peak > 0) writeResultWav(resultWav_);
        if (done) done(info);
    } catch (const fz::Cancelled&) {
    } catch (const std::exception& e) {
        if (done) done(errorVar(e.what()));
    }
}

void Engine::resultImage(const fz::Axis& axis, Done done) {
    run(pool_, "image", [this, axis, done] {
        std::shared_ptr<const fz::Channels> r;
        {
            std::lock_guard lock(mutex_);
            r = result_;
        }
        if (r == nullptr || r->empty() || (*r)[0].empty()) return done(juce::var());
        const auto img = fz::spectrogramImage(fz::midOf(*r), kProjectRate, kResultGrid, 1400, 300, axis);
        done(obj({{"key", putBlob("result", toBytes(img.data))}, {"cols", img.cols}, {"rows", img.rows}}));
    });
}

void Engine::preview(const juce::var& l, bool original, Done done) {
    run(pool_, "preview", [this, l, original, done] {
        try {
            const int layer = (int) l["id"];
            auto x = pitched(layer, num(l["pitch"]));
            if (x == nullptr) return done(errorVar("no audio"));
            fz::LayerInput in{*x, gridOf(l["grid"]), shapesOf(l["shapes"])};
            in.featherS = num(l["featherS"], 0.01);
            in.featherOct = num(l["featherOct"], 1.0 / 12);
            const auto y = fz::synthesizeLayer(in, kProjectRate);
            const double peakSel = fz::peakOf(y), peakOrig = fz::peakOf(*x), peak = std::max(peakSel, peakOrig);
            auto toBuffer = [](const fz::Channels& c) {
                SampleBuffer::Ptr buf = new SampleBuffer();
                buf->sampleRate = kProjectRate;
                const int n = (int) c[0].size(), bc = (int) c.size();
                buf->audio.setSize(bc, n);
                for (int ch = 0; ch < bc; ++ch)
                    for (int i = 0; i < n; ++i) buf->audio.setSample(ch, i, (float) c[(size_t) ch][(size_t) i]);
                return buf;
            };
            if (peak > 0)  // one gain for both, so the A/B comparison is fair
                sampler_.playPreview(layer, toBuffer(y), toBuffer(*x), peak > 0.977 ? (float) (0.977 / peak) : 1.0f, original);
            done(obj({{"peak", original ? peakOrig : peakSel}, {"duration", (double) (*x)[0].size() / kProjectRate}}));
        } catch (const std::exception& e) { done(errorVar(e.what())); }
    });
}

juce::var Engine::resultInfo() const {
    std::lock_guard lock(mutex_);
    return resultInfo_;
}

juce::File Engine::resultWavFile() const { return resultWav_; }

bool Engine::writeResultWav(const juce::File& file) const {
    std::shared_ptr<const fz::Channels> r;
    {
        std::lock_guard lock(mutex_);
        r = result_;
    }
    if (r == nullptr || r->empty() || (*r)[0].empty()) return false;
    file.getParentDirectory().createDirectory();
    file.deleteFile();
    juce::WavAudioFormat wav;
    auto fos = std::make_unique<juce::FileOutputStream>(file);
    if (!fos->openedOk()) return false;
    std::unique_ptr<juce::OutputStream> os = std::move(fos);
    auto w = wav.createWriterFor(os, juce::AudioFormatWriterOptions{}.withSampleRate(kProjectRate).withNumChannels(2).withBitsPerSample(24));
    if (w == nullptr) return false;
    const int n = (int) (*r)[0].size();
    juce::AudioBuffer<float> buf(2, n);
    for (int c = 0; c < 2; ++c)
        for (int i = 0; i < n; ++i) buf.setSample(c, i, (float) (*r)[(size_t) std::min<size_t>((size_t) c, r->size() - 1)][(size_t) i]);
    return w->writeFromAudioSampleBuffer(buf, 0, n);
}

// ------------------------------------------------------------------------------ project
void Engine::setProject(const juce::String& json) {
    std::lock_guard lock(mutex_);
    project_ = json;
}

juce::String Engine::project() const {
    std::lock_guard lock(mutex_);
    return project_;
}

std::shared_ptr<juce::MemoryBlock> Engine::encodeFlac(const fz::Channels& audio) const {
    auto mb = std::make_shared<juce::MemoryBlock>();
    if (audio.empty() || audio[0].empty()) return mb;
    juce::FlacAudioFormat flac;
    std::unique_ptr<juce::OutputStream> os = std::make_unique<juce::MemoryOutputStream>(*mb, false);
    auto w = flac.createWriterFor(os, juce::AudioFormatWriterOptions{}.withSampleRate(kProjectRate)
                                          .withNumChannels((int) audio.size()).withBitsPerSample(24).withQualityOptionIndex(5));
    if (w == nullptr) return mb;
    const int n = (int) audio[0].size(), chans = (int) audio.size();
    juce::AudioBuffer<float> buf(chans, n);
    for (int c = 0; c < chans; ++c)
        for (int i = 0; i < n; ++i) buf.setSample(c, i, (float) audio[(size_t) c][(size_t) i]);
    w->writeFromAudioSampleBuffer(buf, 0, n);
    w.reset();  // flushes and deletes the stream
    return mb;
}

juce::MemoryBlock Engine::saveState(const juce::ValueTree& params) const {
    juce::ValueTree root("Fourierizer");
    std::array<Source, 4> sources;
    {
        std::lock_guard lock(mutex_);
        root.setProperty("version", 1, nullptr);
        root.setProperty("project", project_, nullptr);
        root.setProperty("request", juce::JSON::toString(lastRequest_, true), nullptr);
        sources = sources_;
    }
    for (int i = 0; i < 4; ++i) {
        const auto& s = sources[(size_t) i];
        if (s.audio == nullptr) continue;
        auto flac = s.flac != nullptr ? s.flac : encodeFlac(*s.audio);
        juce::ValueTree layer("Layer");
        layer.setProperty("index", i, nullptr);
        layer.setProperty("name", s.name, nullptr);
        layer.setProperty("flac", juce::var(*flac), nullptr);
        root.appendChild(layer, nullptr);
    }
    root.appendChild(params.createCopy(), nullptr);
    juce::MemoryOutputStream out;
    out.writeInt(kStateMagic);
    root.writeToStream(out);
    return out.getMemoryBlock();
}

juce::ValueTree Engine::loadState(const void* data, int size) {
    juce::MemoryInputStream in(data, (size_t) size, false);
    if (size < 4 || in.readInt() != kStateMagic) return {};
    const auto root = juce::ValueTree::readFromStream(in);
    if (!root.hasType("Fourierizer")) return {};
    juce::ValueTree params;
    {
        std::lock_guard lock(mutex_);
        for (auto& s : sources_) s = {};
        pitchCache_.clear();
    }
    for (const auto& child : root) {
        if (!child.hasType("Layer")) { params = child.createCopy(); continue; }
        const int i = child["index"];
        const auto* mb = child["flac"].getBinaryData();
        if (i < 0 || i > 3 || mb == nullptr) continue;
        auto flacCopy = std::make_shared<juce::MemoryBlock>(*mb);
        juce::FlacAudioFormat flac;
        std::unique_ptr<juce::AudioFormatReader> r(flac.createReaderFor(new juce::MemoryInputStream(*flacCopy, false), true));
        if (r == nullptr) continue;
        const int n = (int) r->lengthInSamples, chans = (int) r->numChannels;
        juce::AudioBuffer<float> buf(chans, n);
        r->read(&buf, 0, n, 0, true, true);
        fz::Channels audio((size_t) chans);
        for (int c = 0; c < chans; ++c) audio[(size_t) c].assign(buf.getReadPointer(c), buf.getReadPointer(c) + n);
        setSource(i, child["name"].toString(), std::move(audio), flacCopy);
    }
    setProject(root["project"].toString());
    const auto request = juce::JSON::parse(root["request"].toString());
    if (request.isObject()) render(request, {});
    else {
        sampler_.setResult(nullptr);
        bank_.setSource(nullptr, nullptr);
    }
    return params;
}

} // namespace fzp

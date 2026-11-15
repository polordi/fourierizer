#include "Engine.h"

#include <fourierizer/resample.h>
#include <fourierizer/spectrogram.h>

#include <chrono>

#include <Captures.h>

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
            const auto kind = s["kind"].toString();
            sh.kind = kind == "poly" ? fz::ShapeKind::Poly : kind == "harm" ? fz::ShapeKind::Harm : fz::ShapeKind::Rect;
            sh.mode = s["mode"].toString() == "subtract" ? fz::ShapeMode::Subtract : fz::ShapeMode::Add;
            sh.gain = num(s["gain"], 1.0);
            if (sh.kind == fz::ShapeKind::Rect) {
                sh.t = {num(s["t"][0]), num(s["t"][1])};
                sh.f = {num(s["f"][0]), num(s["f"][1])};
            } else if (sh.kind == fz::ShapeKind::Harm) {
                sh.t = {num(s["t"][0]), num(s["t"][1])};
                sh.f0 = num(s["f0"], 220);
                sh.count = (int) num(s["count"], 8);
                sh.width = num(s["width"], 1.0 / 12);
                const auto par = s["parity"].toString();
                sh.parity = par == "odd" ? fz::Parity::Odd : par == "even" ? fz::Parity::Even : fz::Parity::All;
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
juce::var Engine::setSource(int layer, const juce::String& name, fz::Channels audio, std::shared_ptr<juce::MemoryBlock> flac, int origin) {
    return setSourceShared(layer, name, std::make_shared<const fz::Channels>(std::move(audio)), std::move(flac), origin);
}

juce::var Engine::setSourceShared(int layer, const juce::String& name, std::shared_ptr<const fz::Channels> shared,
                                  std::shared_ptr<juce::MemoryBlock> flac, int origin) {
    if (layer < 0 || layer > 3 || shared == nullptr) return errorVar("bad layer");
    const int samples = shared->empty() ? 0 : (int) (*shared)[0].size(), chans = (int) shared->size();
    {
        std::lock_guard lock(mutex_);
        sources_[(size_t) layer] = {name, shared, flac, origin};
        for (auto it = pitchCache_.begin(); it != pitchCache_.end();)
            it = it->first.rfind(std::to_string(layer) + ":", 0) == 0 ? pitchCache_.erase(it) : std::next(it);
    }
    if (flac == nullptr)  // encode in the background so saving the project stays instant
        run(pool_, "encode", [this, layer, shared] {
            auto enc = encodeFlac(*shared);
            std::lock_guard lock(mutex_);
            if (sources_[(size_t) layer].audio == shared) sources_[(size_t) layer].flac = enc;
        });
    return obj({{"name", name}, {"samples", samples}, {"channels", chans}, {"origin", origin}});
}

juce::var Engine::sourceInfo(int layer) const {
    std::lock_guard lock(mutex_);
    const auto& s = sources_[(size_t) layer];
    if (s.audio == nullptr) return {};
    return obj({{"name", s.name}, {"samples", s.audio->empty() ? 0 : (int) (*s.audio)[0].size()}, {"channels", (int) s.audio->size()}, {"origin", s.origin}});
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

// The sampler and the Spectral bank play `y` (silence clears them).
void Engine::installResult(const std::shared_ptr<const fz::Channels>& y, double peak) {
    const int n = y == nullptr || y->empty() ? 0 : (int) (*y)[0].size();
    if (n == 0 || peak <= 0) {
        sampler_.setResult(nullptr);
        bank_.setSource(nullptr, nullptr);
        return;
    }
    SampleBuffer::Ptr buf = new SampleBuffer();
    buf->sampleRate = kProjectRate;
    buf->audio.setSize(2, n);
    for (int c = 0; c < 2; ++c)
        for (int i = 0; i < n; ++i) buf->audio.setSample(c, i, (float) (*y)[std::min<size_t>((size_t) c, y->size() - 1)][(size_t) i]);
    sampler_.setResult(buf);
    bank_.setSource(y, buf);
}

juce::var Engine::resultToLayer(int layer, const juce::String& name, int origin) {
    std::shared_ptr<const fz::Channels> r;
    std::shared_ptr<juce::MemoryBlock> flac;
    {
        std::lock_guard lock(mutex_);
        r = result_;
        for (auto& t : takes_)
            if (t.id == origin && t.result == r) flac = t.flac;
    }
    if (r == nullptr || r->empty()) return errorVar("no result");
    return setSourceShared(layer, name, r, flac, origin);
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
void Engine::spectrogram(int layer, double pitch, const fz::Grid& grid, const fz::Axis& axis, Done done, const juce::var& range, bool multires) {
    run(pool_, "spectrogram", [this, layer, pitch, grid, axis, done, range, multires] {
        try {
            auto x = pitched(layer, pitch);
            if (x == nullptr) return done(errorVar("no audio in layer " + juce::String(layer + 1)));
            fz::SpectrogramImage img;
            if (range.isObject()) {   // a zoomed view
                const int cols = juce::jlimit(16, 4096, (int) num(range["cols"], 1400));
                const long long s0 = std::llround(num(range["t0"]) * kProjectRate), s1 = std::max(s0 + 1, std::llround(num(range["t1"]) * kProjectRate));
                const int maxHop = std::min(grid.H, std::max(16, (int) ((s1 - s0) / cols)));
                fz::Grid g = grid;
                g.H = std::max(16, std::min(grid.H, maxHop));
                img = multires ? fz::multiresImage(fz::midOf(*x), kProjectRate, grid, cols, 360, axis, s0, s1, maxHop)
                               : fz::spectrogramImage(fz::midOf(*x), kProjectRate, g, cols, 360, axis, s0, s1);
            } else img = multires ? fz::multiresImage(fz::midOf(*x), kProjectRate, grid, 1400, 360, axis, 0, -1, grid.H)
                                  : fz::spectrogramImage(fz::midOf(*x), kProjectRate, grid, 1400, 360, axis);
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
                    in.multires = (bool) l["multires"];
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
        auto shared = std::make_shared<const fz::Channels>(std::move(y));
        installResult(shared, peak);

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

void Engine::analyze(const juce::var& q, Done done) {
    // only the newest request matters while the user zooms and pans
    const auto ticket = ++analyzeTicket_;
    run(pool_, "analyze", [this, q, done, ticket] {
        if (ticket != analyzeTicket_.load()) return done(juce::var());
        std::shared_ptr<const fz::Channels> r;
        {
            std::lock_guard lock(mutex_);
            r = result_;
        }
        if (r == nullptr || r->empty() || (*r)[0].empty()) return done(juce::var());
        const double t0 = num(q["t0"]), t1 = num(q["t1"]);
        const int n = juce::jlimit(256, 16384, (int) num(q["n"], 4096));
        const int cols = juce::jlimit(16, 4096, (int) num(q["cols"], 1400)), rows = juce::jlimit(16, 2048, (int) num(q["rows"], 400));
        const long long s0 = std::llround(t0 * kProjectRate), s1 = std::max(s0 + 1, std::llround(t1 * kProjectRate));
        const int hop = std::max(16, std::min(n / 4, (int) ((s1 - s0) / cols)));
        const auto x = fz::midOf(*r);
        const auto img = fz::spectrogramImage(x, kProjectRate, fz::Grid{fz::Window::Hann, n, n, hop}, cols, rows, axisOf(q["axis"]), s0, s1);
        const auto wave = fz::waveformPeaks(x, s0, s1, img.cols);
        std::vector<std::byte> waveBytes(wave.size() * sizeof(float));
        std::memcpy(waveBytes.data(), wave.data(), waveBytes.size());
        done(obj({{"image", obj({{"key", putBlob("analysis", toBytes(img.data))}, {"cols", img.cols}, {"rows", img.rows}, {"peakDbfs", img.peakDbfs}})},
                  {"wave", putBlob("analysiswave", std::move(waveBytes))}, {"t0", t0}, {"t1", t1}}));
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
            in.multires = (bool) l["multires"];
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

// ------------------------------------------------------------------------------ captures
juce::var Engine::captures() {
    auto files = fzshared::capturesFolder().findChildFiles(juce::File::findFiles, false, "*.wav;*.aif;*.aiff;*.flac");
    std::sort(files.begin(), files.end(), [](const juce::File& a, const juce::File& b) { return a.getLastModificationTime() > b.getLastModificationTime(); });
    juce::Array<juce::var> list;
    for (const auto& f : files) {
        if (f.getFileName().startsWith("Recording")) continue;   // still being written by Capture
        std::unique_ptr<juce::AudioFormatReader> r(formats_.createReaderFor(f));
        if (r == nullptr || r->sampleRate <= 0) continue;
        list.add(obj({{"name", f.getFileNameWithoutExtension()}, {"path", f.getFullPathName()},
                      {"seconds", (double) r->lengthInSamples / r->sampleRate}, {"modified", (double) f.getLastModificationTime().toMilliseconds()}}));
        if (list.size() >= 30) break;
    }
    return list;
}

void Engine::loadCapture(int layer, const juce::String& path, Done done) {
    const juce::File f(path);
    if (!f.isAChildOf(fzshared::capturesFolder()) || !f.existsAsFile()) return done(errorVar("This capture is no longer there"));
    decodeFile(layer, f, std::move(done));
}

// ------------------------------------------------------------------------------ takes
std::shared_ptr<const fz::Channels> Engine::decodeFlac(const juce::MemoryBlock& mb) {
    juce::FlacAudioFormat flac;
    std::unique_ptr<juce::AudioFormatReader> r(flac.createReaderFor(new juce::MemoryInputStream(mb, false), true));
    if (r == nullptr) return nullptr;
    const int n = (int) r->lengthInSamples, chans = (int) r->numChannels;
    juce::AudioBuffer<float> buf(chans, n);
    r->read(&buf, 0, n, 0, true, true);
    fz::Channels audio((size_t) chans);
    for (int c = 0; c < chans; ++c) audio[(size_t) c].assign(buf.getReadPointer(c), buf.getReadPointer(c) + n);
    return std::make_shared<const fz::Channels>(std::move(audio));
}

juce::var Engine::takeInfo(const Take& t) {
    juce::Array<juce::var> layers;
    for (const auto& s : t.sources) layers.add(s.audio == nullptr ? juce::var() : obj({{"name", s.name}, {"origin", s.origin}}));
    juce::var thumb;
    if (!t.thumb.empty()) thumb = obj({{"key", putBlob("take" + juce::String(t.id), toBytes(t.thumb))}, {"cols", t.thumbCols}, {"rows", t.thumbRows}});
    return obj({{"id", t.id}, {"name", t.name}, {"created", (double) t.created}, {"duration", t.samples / kProjectRate},
                {"op", t.request["op"].toString()}, {"thumb", thumb}, {"layers", layers}});
}

juce::var Engine::keepTake(const juce::String& project, const juce::String& name) {
    Take t;
    {
        std::lock_guard lock(mutex_);
        if (result_ == nullptr || result_->empty() || (*result_)[0].empty()) return errorVar("Render something first");
        if ((int) takes_.size() >= kMaxTakes) return errorVar("The history is full (" + juce::String(kMaxTakes) + " takes): delete one first");
        t.id = nextTakeId_++;
        t.name = name.isNotEmpty() ? name : "Take " + juce::String(t.id);
        t.project = project;
        t.request = lastRequest_;
        t.sources = sources_;
        t.result = result_;
        t.samples = (int) (*result_)[0].size();
        t.peak = (double) resultInfo_["peak"];
        t.created = juce::Time::currentTimeMillis();
    }
    const auto img = fz::spectrogramImage(fz::midOf(*t.result), kProjectRate, kResultGrid, 160, 40);
    t.thumb = img.data;
    t.thumbCols = img.cols;
    t.thumbRows = img.rows;
    {
        std::lock_guard lock(mutex_);
        takes_.push_back(t);
    }
    run(pool_, "encode take", [this, result = t.result, id = t.id] {
        auto enc = encodeFlac(*result);
        std::lock_guard lock(mutex_);
        for (auto& k : takes_)
            if (k.id == id) k.flac = enc;
    });
    return takeInfo(t);
}

juce::var Engine::takes() {
    std::vector<Take> copy;
    {
        std::lock_guard lock(mutex_);
        copy = takes_;
    }
    juce::Array<juce::var> list;
    for (const auto& t : copy) list.add(takeInfo(t));
    return list;
}

// The take's result, decoded from its FLAC the first time after loading a project.
std::shared_ptr<const fz::Channels> Engine::takeAudio(int id, juce::String* name, std::shared_ptr<juce::MemoryBlock>* flacOut) {
    std::shared_ptr<const fz::Channels> audio;
    std::shared_ptr<juce::MemoryBlock> flac;
    {
        std::lock_guard lock(mutex_);
        for (const auto& t : takes_)
            if (t.id == id) {
                audio = t.result;
                flac = t.flac;
                if (name != nullptr) *name = t.name;
            }
    }
    if (flacOut != nullptr) *flacOut = flac;
    if (audio != nullptr || flac == nullptr) return audio;
    audio = decodeFlac(*flac);
    std::lock_guard lock(mutex_);
    for (auto& t : takes_)
        if (t.id == id) t.result = audio;
    return audio;
}

void Engine::restoreTake(int id, Done done) {
    run(pool_, "restore take", [this, id, done] {
        auto audio = takeAudio(id);
        if (audio == nullptr) return done(errorVar("This take no longer exists"));
        double peak = 0;
        {
            std::lock_guard lock(mutex_);
            const auto it = std::find_if(takes_.begin(), takes_.end(), [&](const Take& t) { return t.id == id; });
            if (it == takes_.end()) return done(errorVar("This take no longer exists"));
            if (renderCancel_) *renderCancel_ = true;
            sources_ = it->sources;
            pitchCache_.clear();
            result_ = audio;
            lastRequest_ = it->request;
            project_ = it->project;
            peak = it->peak;
            resultInfo_ = obj({{"peak", peak}, {"ms", 0}, {"duration", it->samples / kProjectRate}, {"image", juce::var()}});
        }
        installResult(audio, peak);
        writeResultWav(resultWav_);
        juce::Array<juce::var> layers;
        for (int i = 0; i < 4; ++i) layers.add(sourceInfo(i));
        done(obj({{"project", project()}, {"layers", layers}, {"result", resultInfo()}}));
    });
}

void Engine::deleteTake(int id) {
    std::lock_guard lock(mutex_);
    takes_.erase(std::remove_if(takes_.begin(), takes_.end(), [&](const Take& t) { return t.id == id; }), takes_.end());
}

void Engine::renameTake(int id, const juce::String& name) {
    std::lock_guard lock(mutex_);
    for (auto& t : takes_)
        if (t.id == id && name.trim().isNotEmpty()) t.name = name.trim();
}

void Engine::takeToLayer(int id, int layer, Done done) {
    run(pool_, "take to layer", [this, id, layer, done] {
        juce::String name;
        std::shared_ptr<juce::MemoryBlock> flac;
        auto audio = takeAudio(id, &name, &flac);
        if (audio == nullptr) return done(errorVar("This take no longer exists"));
        done(setSourceShared(layer, name, audio, flac, id));
    });
}

void Engine::previewTake(int id, Done done) {
    run(pool_, "preview take", [this, id, done] {
        auto audio = takeAudio(id);
        if (audio == nullptr || audio->empty()) return done(errorVar("This take no longer exists"));
        SampleBuffer::Ptr buf = new SampleBuffer();
        buf->sampleRate = kProjectRate;
        const int n = (int) (*audio)[0].size(), chans = (int) audio->size();
        buf->audio.setSize(chans, n);
        for (int c = 0; c < chans; ++c)
            for (int i = 0; i < n; ++i) buf->audio.setSample(c, i, (float) (*audio)[(size_t) c][(size_t) i]);
        sampler_.playPreview(kTakePreview, buf, nullptr, 1.0f, false);
        done(obj({{"duration", n / kProjectRate}}));
    });
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

// Version 2: every distinct audio (layers and takes share it) is stored once as FLAC; layers
// and takes refer to it by index. Version 1 (H5/H6) stored one FLAC per layer.
juce::MemoryBlock Engine::saveState(const juce::ValueTree& params) const {
    juce::ValueTree root("Fourierizer");
    std::array<Source, 4> sources;
    std::vector<Take> takes;
    {
        std::lock_guard lock(mutex_);
        root.setProperty("version", 2, nullptr);
        root.setProperty("project", project_, nullptr);
        root.setProperty("request", juce::JSON::toString(lastRequest_, true), nullptr);
        root.setProperty("nextTake", nextTakeId_, nullptr);
        sources = sources_;
        takes = takes_;
    }
    std::vector<std::pair<const fz::Channels*, Source>> audios;   // distinct audio, with any cached FLAC
    auto indexOf = [&](const Source& s) {
        if (s.audio == nullptr) return -1;
        for (size_t i = 0; i < audios.size(); ++i)
            if (audios[i].first == s.audio.get()) {
                if (audios[i].second.flac == nullptr) audios[i].second.flac = s.flac;
                return (int) i;
            }
        audios.push_back({s.audio.get(), s});
        return (int) audios.size() - 1;
    };
    auto layerTree = [&](const char* type, int i, const Source& s) {
        juce::ValueTree t(type);
        t.setProperty("index", i, nullptr);
        t.setProperty("name", s.name, nullptr);
        t.setProperty("origin", s.origin, nullptr);
        t.setProperty("audio", indexOf(s), nullptr);
        return t;
    };
    for (int i = 0; i < 4; ++i)
        if (sources[(size_t) i].audio != nullptr) root.appendChild(layerTree("Layer", i, sources[(size_t) i]), nullptr);
    for (const auto& k : takes) {
        juce::ValueTree t("Take");
        t.setProperty("id", k.id, nullptr);
        t.setProperty("name", k.name, nullptr);
        t.setProperty("created", (double) k.created, nullptr);
        t.setProperty("project", k.project, nullptr);
        t.setProperty("request", juce::JSON::toString(k.request, true), nullptr);
        t.setProperty("samples", k.samples, nullptr);
        t.setProperty("peak", k.peak, nullptr);
        t.setProperty("thumb", juce::var(juce::MemoryBlock(k.thumb.data(), k.thumb.size())), nullptr);
        t.setProperty("thumbCols", k.thumbCols, nullptr);
        t.setProperty("thumbRows", k.thumbRows, nullptr);
        auto flac = k.flac != nullptr ? k.flac : (k.result != nullptr ? encodeFlac(*k.result) : nullptr);
        if (flac == nullptr) continue;
        t.setProperty("flac", juce::var(*flac), nullptr);
        for (int i = 0; i < 4; ++i)
            if (k.sources[(size_t) i].audio != nullptr) t.appendChild(layerTree("TakeLayer", i, k.sources[(size_t) i]), nullptr);
        root.appendChild(t, nullptr);
    }
    for (size_t i = 0; i < audios.size(); ++i) {
        const auto& s = audios[i].second;
        auto flac = s.flac != nullptr ? s.flac : encodeFlac(*s.audio);
        juce::ValueTree a("Audio");
        a.setProperty("index", (int) i, nullptr);
        a.setProperty("flac", juce::var(*flac), nullptr);
        root.appendChild(a, nullptr);
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
        takes_.clear();
        pitchCache_.clear();
    }
    // distinct audio (version 2)
    std::map<int, std::pair<std::shared_ptr<const fz::Channels>, std::shared_ptr<juce::MemoryBlock>>> audios;
    for (const auto& child : root)
        if (child.hasType("Audio"))
            if (const auto* mb = child["flac"].getBinaryData()) {
                auto flac = std::make_shared<juce::MemoryBlock>(*mb);
                if (auto audio = decodeFlac(*flac)) audios[(int) child["index"]] = {audio, flac};
            }
    auto sourceOf = [&](const juce::ValueTree& t) -> Source {
        if (t.hasProperty("audio")) {   // version 2
            const auto it = audios.find((int) t["audio"]);
            if (it == audios.end()) return {};
            return {t["name"].toString(), it->second.first, it->second.second, (int) t["origin"]};
        }
        const auto* mb = t["flac"].getBinaryData();   // version 1
        if (mb == nullptr) return {};
        auto flac = std::make_shared<juce::MemoryBlock>(*mb);
        return {t["name"].toString(), decodeFlac(*flac), flac, 0};
    };
    int maxId = 0;
    for (const auto& child : root) {
        if (child.hasType("Audio")) continue;
        if (child.hasType("Layer")) {
            const int i = child["index"];
            const auto s = sourceOf(child);
            if (i >= 0 && i <= 3 && s.audio != nullptr) setSourceShared(i, s.name, s.audio, s.flac, s.origin);
        } else if (child.hasType("Take")) {
            Take t;
            t.id = child["id"];
            t.name = child["name"].toString();
            t.created = (juce::int64) (double) child["created"];
            t.project = child["project"].toString();
            t.request = juce::JSON::parse(child["request"].toString());
            t.samples = child["samples"];
            t.peak = child["peak"];
            if (const auto* th = child["thumb"].getBinaryData()) t.thumb.assign((const uint8_t*) th->getData(), (const uint8_t*) th->getData() + th->getSize());
            t.thumbCols = child["thumbCols"];
            t.thumbRows = child["thumbRows"];
            if (const auto* mb = child["flac"].getBinaryData()) t.flac = std::make_shared<juce::MemoryBlock>(*mb);
            for (const auto& l : child) {
                const int i = l["index"];
                if (l.hasType("TakeLayer") && i >= 0 && i <= 3) t.sources[(size_t) i] = sourceOf(l);
            }
            maxId = std::max(maxId, t.id);
            std::lock_guard lock(mutex_);
            takes_.push_back(std::move(t));
        } else {
            params = child.createCopy();
        }
    }
    {
        std::lock_guard lock(mutex_);
        nextTakeId_ = std::max((int) root.getProperty("nextTake", 1), maxId + 1);
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

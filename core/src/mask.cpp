#include "fourierizer/mask.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <numbers>
#include <stdexcept>

namespace fz {

namespace {
constexpr double kInf = std::numeric_limits<double>::infinity();

inline void combine(double* out, int k, double ms, ShapeMode mode) {
    if (mode == ShapeMode::Add) out[k] = out[k] + (1 - out[k]) * ms;
    else out[k] = out[k] * (1 - ms);
}
} // namespace

double ramp(double d) {
    if (d <= -0.5) return 0;
    if (d >= 0.5) return 1;
    return 0.5 + 0.5 * std::sin(std::numbers::pi * d);
}

double fade(double u) {
    return 0.5 - 0.5 * std::cos(std::numbers::pi * (u < 0 ? 0 : u > 1 ? 1 : u));
}

double envelope(double t, const std::vector<double>& iv, double fadeIn, double fadeOut) {
    double E = 0;
    for (size_t j = 0; j + 1 < iv.size(); j += 2) {
        double e = 1;
        if (fadeIn > 0) e *= fade((t - iv[j]) / fadeIn);
        if (fadeOut > 0) e *= fade((iv[j + 1] - t) / fadeOut);
        if (e > E) E = e;
    }
    return E;
}

std::vector<double> polyRowIntervals(const std::vector<std::array<double, 2>>& points, double phi) {
    const size_t n = points.size();
    std::vector<double> ps(n);
    for (size_t i = 0; i < n; ++i) ps[i] = std::log2(std::max(points[i][1], kFreqFloor));
    const double lo = *std::min_element(ps.begin(), ps.end()), hi = *std::max_element(ps.begin(), ps.end());
    const double eps = 1e-9 * std::max(1.0, hi - lo);
    const double y = std::min(std::max(phi, lo + eps), hi - eps);
    std::vector<double> xs;
    for (size_t i = 0; i < n; ++i) {
        const size_t j = i == 0 ? n - 1 : i - 1;
        const double ax = points[j][0], ay = ps[j], bx = points[i][0], by = ps[i];
        if ((ay > y) != (by > y)) xs.push_back(ax + (y - ay) * (bx - ax) / (by - ay));
    }
    std::sort(xs.begin(), xs.end());
    if (xs.size() % 2) xs.pop_back();
    return xs;
}

std::vector<double> logFreqs(const std::vector<double>& freqs) {
    std::vector<double> P(freqs.size());
    for (size_t k = 0; k < freqs.size(); ++k) P[k] = std::log2(std::max(freqs[k], kFreqFloor));
    return P;
}

SelectionRaster::SelectionRaster(const std::vector<Shape>& shapes, std::vector<double> P,
                                 double featherS, double featherOct)
    : P_(std::move(P)) {
    for (const Shape& s : shapes) {
        Compiled c{};
        c.mode = s.mode;
        c.gain = s.gain;
        c.ft = std::max(s.featherS.value_or(featherS), 1e-9);
        c.fp = std::max(s.featherOct.value_or(featherOct), 1e-9);
        c.fi = std::max(s.fadeIn, 0.0);
        c.fo = std::max(s.fadeOut, 0.0);
        c.fades = c.fi > 0 || c.fo > 0;
        c.isRect = s.kind == ShapeKind::Rect;
        if (c.isRect) {
            c.t0 = s.t[0];
            c.t1 = s.t[1];
            c.p0 = s.f[0] > 0 ? std::log2(s.f[0]) : -kInf;
            c.p1 = s.f[1] > 0 ? std::log2(s.f[1]) : -kInf;
        } else {
            if (s.points.size() < 3) throw std::invalid_argument("a polygon needs at least 3 points");
            for (auto& p : s.points) {
                c.vx.push_back(p[0] / c.ft);
                c.vy.push_back(std::log2(std::max(p[1], kFreqFloor)) / c.fp);
            }
            c.minX = *std::min_element(c.vx.begin(), c.vx.end());
            c.maxX = *std::max_element(c.vx.begin(), c.vx.end());
            c.minY = *std::min_element(c.vy.begin(), c.vy.end());
            c.maxY = *std::max_element(c.vy.begin(), c.vy.end());
            if (c.fades) {
                c.rows.reserve(P_.size());
                for (double phi : P_) c.rows.push_back(polyRowIntervals(s.points, phi));
            }
        }
        shapes_.push_back(std::move(c));
    }
}

void SelectionRaster::row(double t, double* out) const {
    std::fill(out, out + P_.size(), 0.0);
    for (const Compiled& s : shapes_) {
        if (s.isRect) rectRow(s, t, out);
        else polyRow(s, t, out);
    }
}

void SelectionRaster::rectRow(const Compiled& s, double t, double* out) const {
    const double dt = std::min(t - s.t0, s.t1 - t) / s.ft;
    if (dt <= -0.5) return;  // fully outside in time: M_s = 0 for every bin
    const double E = s.fades ? envelope(t, {s.t0, s.t1}, s.fi, s.fo) : 1.0;
    if (E == 0) return;
    const int B = static_cast<int>(P_.size());
    for (int k = 0; k < B; ++k) {
        const double dp = std::min(P_[k] - s.p0, s.p1 - P_[k]) / s.fp;
        const double d = (dt >= 0 && dp >= 0) ? std::min(dt, dp) : -std::hypot(std::min(dt, 0.0), std::min(dp, 0.0));
        const double ms = s.gain * ramp(d) * E;
        if (ms != 0) combine(out, k, ms, s.mode);
    }
}

void SelectionRaster::polyRow(const Compiled& s, double t, double* out) const {
    const double X = t / s.ft;
    if (X < s.minX - 0.5 || X > s.maxX + 0.5) return;  // d < −½ on the whole row
    const size_t n = s.vx.size();
    const int B = static_cast<int>(P_.size());
    for (int k = 0; k < B; ++k) {
        const double Y = P_[k] / s.fp;
        if (Y < s.minY - 0.5 || Y > s.maxY + 0.5) continue;
        double d2 = kInf;
        bool inside = false;
        for (size_t i = 0; i < n; ++i) {
            const size_t j = i == 0 ? n - 1 : i - 1;
            const double ax = s.vx[j], ay = s.vy[j], ex = s.vx[i] - ax, ey = s.vy[i] - ay;
            const double seg = ex * ex + ey * ey;
            double u = ((X - ax) * ex + (Y - ay) * ey) / (seg > 0 ? seg : 1);
            u = u < 0 ? 0 : u > 1 ? 1 : u;
            const double dx = X - ax - u * ex, dy = Y - ay - u * ey;
            d2 = std::min(d2, dx * dx + dy * dy);
            if ((ay > Y) != (s.vy[i] > Y) && X < ax + (Y - ay) * ex / ey) inside = !inside;
        }
        const double d = std::sqrt(d2);
        const double E = s.fades ? envelope(t, s.rows[k], s.fi, s.fo) : 1.0;
        const double ms = s.gain * ramp(inside ? d : -d) * E;
        if (ms != 0) combine(out, k, ms, s.mode);
    }
}

} // namespace fz

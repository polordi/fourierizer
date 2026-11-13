// Resolution-independent selections (python/fourierizer_ref/mask.py, PLAN §4.3).
//
// Shapes live in the plane (t [s], φ = log₂ f). Each has a signed distance d to its boundary,
// measured in units of its feather, and a soft mask a·ρ(d)·E(t, φ):
//   ρ(d) = ½ + ½ sin(πd) on [−½, ½]              (edge softness)
//   E    = max_j S((t − a_j)/fadeIn)·S((b_j − t)/fadeOut)   over the time intervals [a_j, b_j]
//          the shape covers on the row φ, S(u) = ½ − ½ cos(πu) on [0, 1]   (time fades)
// Shapes combine in order: add M ← M + (1 − M)·M_s, subtract M ← M·(1 − M_s).
#pragma once

#include <array>
#include <optional>
#include <vector>

namespace fz {

enum class ShapeKind { Rect, Poly };
enum class ShapeMode { Add, Subtract };

struct Shape {
    ShapeKind kind = ShapeKind::Rect;
    ShapeMode mode = ShapeMode::Add;
    double gain = 1.0;
    std::array<double, 2> t{0, 1};                   // rect: seconds
    std::array<double, 2> f{20, 20000};              // rect: Hz (≤ 0 means "down to DC")
    std::vector<std::array<double, 2>> points;       // poly: (seconds, Hz)
    std::optional<double> featherS, featherOct;      // per shape; else the layer's
    double fadeIn = 0.0, fadeOut = 0.0;              // seconds, inside the selection
};

constexpr double kFreqFloor = 1.0;  // Hz; the DC bin is mapped here for log₂

double ramp(double d);
double fade(double u);

/// E on one row: max over intervals iv = [a, b, a, b, …] of fade-in × fade-out (0 if none).
double envelope(double t, const std::vector<double>& iv, double fadeIn, double fadeOut);

/// Time intervals a polygon covers on the row φ = log₂ f (rows outside its frequency range use
/// the nearest covered row).
std::vector<double> polyRowIntervals(const std::vector<std::array<double, 2>>& points, double phi);

/// log₂ of each bin frequency with the DC bin mapped to kFreqFloor.
std::vector<double> logFreqs(const std::vector<double>& freqs);

/// A selection compiled for one grid's bins: row(t) gives the mask at time t.
class SelectionRaster {
public:
    SelectionRaster(const std::vector<Shape>& shapes, std::vector<double> logFreqs,
                    double featherS = 0.01, double featherOct = 1.0 / 12.0);
    bool empty() const { return shapes_.empty(); }
    void row(double t, double* out) const;

private:
    struct Compiled {
        ShapeMode mode;
        double gain, ft, fp, fi, fo;
        bool fades, isRect;
        double t0, t1, p0, p1;                       // rect
        std::vector<double> vx, vy;                  // poly, scaled by the feathers
        double minX, maxX, minY, maxY;
        std::vector<std::vector<double>> rows;       // poly with fades: intervals per bin
    };
    void rectRow(const Compiled& s, double t, double* out) const;
    void polyRow(const Compiled& s, double t, double* out) const;

    std::vector<Compiled> shapes_;
    std::vector<double> P_;
};

} // namespace fz

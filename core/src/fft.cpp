#include "fourierizer/fft.h"

#include <numbers>
#include <stdexcept>
#include <string>

namespace fz {

using cd = std::complex<double>;

RealFFT::RealFFT(int n) : n_(n), m_(n / 2) {
    if (n < 4 || (n & (n - 1)) != 0)
        throw std::invalid_argument("FFT size must be a power of two >= 4, got " + std::to_string(n));
    int bits = 0;
    while ((1 << bits) < m_) ++bits;
    rev_.resize(m_);
    for (int i = 0; i < m_; ++i) {
        int r = 0;
        for (int b = 0; b < bits; ++b) r |= ((i >> b) & 1) << (bits - 1 - b);
        rev_[i] = r;
    }
    const double pi = std::numbers::pi;
    tw_.resize(std::max(1, m_ / 2));
    for (int k = 0; k < static_cast<int>(tw_.size()); ++k)
        tw_[k] = std::polar(1.0, -2.0 * pi * k / m_);
    split_.resize(m_ + 1);
    for (int k = 0; k <= m_; ++k)
        split_[k] = std::polar(1.0, -2.0 * pi * k / n_);
    z_.resize(m_);
}

void RealFFT::complexFFT(cd* z, bool inverse) const {
    const int m = m_;
    for (int i = 0; i < m; ++i)
        if (rev_[i] > i) std::swap(z[i], z[rev_[i]]);
    for (int size = 2; size <= m; size <<= 1) {
        const int half = size >> 1, step = m / size;
        for (int start = 0; start < m; start += size) {
            for (int k = 0; k < half; ++k) {
                cd w = tw_[k * step];
                if (inverse) w = std::conj(w);
                cd& a = z[start + k];
                cd& b = z[start + k + half];
                const cd x = b * w;
                b = a - x;
                a += x;
            }
        }
    }
}

void RealFFT::forward(const double* in, int inLength, double* re, double* im) {
    // z[j] = x[2j] + i·x[2j+1]
    for (int j = 0; j < m_; ++j) {
        const int a = 2 * j, b = a + 1;
        z_[j] = cd(a < inLength ? in[a] : 0.0, b < inLength ? in[b] : 0.0);
    }
    complexFFT(z_.data(), false);
    // E[k] = (Z[k] + conj Z[M−k]) / 2,  O[k] = (Z[k] − conj Z[M−k]) / 2i,  X[k] = E[k] + W^k O[k]
    for (int k = 0; k <= m_; ++k) {
        const cd zk = z_[k % m_], zc = std::conj(z_[(m_ - k) % m_]);
        const cd e = 0.5 * (zk + zc), o = cd(0, -0.5) * (zk - zc);
        const cd x = e + split_[k] * o;
        re[k] = x.real();
        im[k] = x.imag();
    }
}

void RealFFT::inverse(const double* re, const double* im, double* out) {
    // E[k] = (X[k] + conj X[M−k]) / 2,  O[k] = (X[k] − conj X[M−k]) / 2 · W^{−k},  Z = E + iO
    for (int k = 0; k < m_; ++k) {
        const cd xk(re[k], k == 0 ? 0.0 : im[k]);
        const int c = m_ - k;
        const cd xc(re[c], (c == 0 || c == m_) ? 0.0 : -im[c]);
        const cd e = 0.5 * (xk + xc), o = 0.5 * (xk - xc) * std::conj(split_[k]);
        z_[k] = e + cd(0, 1) * o;
    }
    complexFFT(z_.data(), true);
    const double s = 1.0 / m_;
    for (int j = 0; j < m_; ++j) {
        out[2 * j] = z_[j].real() * s;
        out[2 * j + 1] = z_[j].imag() * s;
    }
}

} // namespace fz

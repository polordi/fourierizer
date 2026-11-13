// Real FFT with numpy's conventions: forward returns bins 0..N/2 unnormalized, inverse
// divides by N (like numpy.fft.irfft). N must be a power of two ≥ 4.
//
// A real signal of length N is packed into a complex one of length N/2 (even samples as real
// parts, odd samples as imaginary parts), transformed with an iterative radix-2 FFT and then
// split back. That halves the work of a full complex FFT.
#pragma once

#include <complex>
#include <vector>

namespace fz {

class RealFFT {
public:
    explicit RealFFT(int n);

    int size() const { return n_; }
    int bins() const { return n_ / 2 + 1; }

    /// X = rfft(x zero-padded to N). `in` has `inLength` ≤ N samples; re/im have bins() entries.
    void forward(const double* in, int inLength, double* re, double* im);

    /// x = irfft(X) of length N (divided by N). re/im have bins() entries; im[0], im[N/2] ignored.
    void inverse(const double* re, const double* im, double* out);

private:
    void complexFFT(std::complex<double>* z, bool inverse) const;

    int n_, m_;                                 // N and N/2
    std::vector<int> rev_;                      // bit reversal for the N/2-point FFT
    std::vector<std::complex<double>> tw_;      // e^{-2πik/(N/2)}, k < N/4
    std::vector<std::complex<double>> split_;   // e^{-2πik/N},     k ≤ N/2
    std::vector<std::complex<double>> z_;       // work buffer, N/2
};

} // namespace fz

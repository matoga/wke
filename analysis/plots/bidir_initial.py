"""Build the initial state of the bidirectional scaling studies: shared-data/measured-state-d.json.

usage: analysis/.venv/bin/python analysis/plots/bidir_initial.py [--data <dir>]

The data folder (published measurements of bidirectional scaling in a quench-cooled box of ³⁹K) comes
from --data or the environment variable WKE_BIDIR_DATA. All ten t = 0 spectra (every a of both series)
are averaged on the finer k grid of series 2: the state at t = 0 is prepared with a → 0, so it does not
depend on the a used afterwards. The published n_k is per volume, n_k = V f/(2π)³, so N = ∫ n_k d³k.
"""
import glob
import json
import os
import sys
import numpy as np

HBAR, KB = 1.054571817e-34, 1.380649e-23
M_K39 = 38.96370668 * 1.66053906660e-27
# box during thermalisation: cylinder of diameter 25 µm and length 42 µm
D_UM, L_UM = 25.0, 42.0
V_UM3 = np.pi * (D_UM / 2) ** 2 * L_UM


def data_dir(argv):
    d = argv[argv.index('--data') + 1] if '--data' in argv else os.environ.get('WKE_BIDIR_DATA')
    if not d:
        sys.exit('pass --data <dir> or set WKE_BIDIR_DATA')
    return d


def load_nk(path):
    """k (µm⁻¹), n_k (µm³), error (µm³) of one published distribution file (two header rows)."""
    d = np.loadtxt(path, skiprows=2)
    return d[:, 0], d[:, 1], d[:, 2]


def moments(k, n):
    """N = ∫ 4πk² n_k dk and E/N (nK) = ⟨ħ²k²/2m⟩/k_B."""
    N = np.trapezoid(4 * np.pi * k ** 2 * n, k)
    E = np.trapezoid(4 * np.pi * k ** 4 * n, k) * 1e12 * HBAR ** 2 / (2 * M_K39) / KB * 1e9
    return N, E / N


def pchip(x, y, xq):
    """Monotone cubic (Fritsch-Carlson) interpolation of y(x) at xq: smooth, through the points, no overshoot."""
    h, d = np.diff(x), np.diff(y) / np.diff(x)
    m = np.zeros_like(y)
    for i in range(1, len(x) - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    m[0], m[-1] = d[0], d[-1]
    j = np.clip(np.searchsorted(x, xq) - 1, 0, len(x) - 2)
    t = (xq - x[j]) / h[j]
    h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
    return h00 * y[j] + h10 * h[j] * m[j] + h01 * y[j + 1] + h11 * h[j] * m[j + 1]


def smooth_state(k, n, err, k_out):
    """ln n_k interpolated by pchip through the points with n_k > 2σ, up to the first point above 1 µm⁻¹ that
    fails; beyond it the last
    decay of ln n_k continues linearly (an exponential tail)."""
    good = n > 2 * err
    # stop at the first point above 1 µm⁻¹ that fails, so an isolated noisy point further out is not bridged to
    bad = np.flatnonzero(~good & (k > 1.0))
    last = (bad[0] - 1) if len(bad) else len(k) - 1
    keep = good & (np.arange(len(k)) <= last)
    kg, lg = k[keep], np.log(n[keep])
    out = pchip(kg, lg, np.clip(k_out, kg[0], kg[-1]))
    slope = (lg[-1] - lg[-2]) / (kg[-1] - kg[-2])
    tail = k_out > kg[-1]
    out[tail] = lg[-1] + slope * (k_out[tail] - kg[-1])
    return np.exp(out)


def series1(d):
    """The t = 0 spectrum of each a of series 1 (150, 300, 600 a₀), smoothed on a dense grid, with its own N."""
    k_out = np.linspace(0.0284, 5.4, 400)
    out = {}
    for a in (150, 300, 600):
        k, n, e = load_nk(os.path.join(d, 'Distributions', 'nk', 'Series 1', f'nk_a{a}a0_t0ms.txt'))
        s = smooth_state(k, n, e, k_out)
        N_raw, EN_raw = moments(k, n)
        N, EN = moments(k_out, s)
        out[str(a)] = {'k_um_inv': k_out.tolist(), 'n_k': s.tolist(), 'N': N, 'density_um3': N / V_UM3, 'EN_nK': EN}
        print(f'  {a} a0: measured N = {N_raw:.0f}, E/N = {EN_raw:.2f} nK; smoothed N = {N:.0f}, E/N = {EN:.2f} nK, n = {N / V_UM3:.4f} µm⁻³')
    path = os.path.join(os.path.dirname(__file__), '..', '..', 'shared-data', 'measured-states-d-series1.json')
    json.dump(out, open(path, 'w'))
    print(f'-> {os.path.normpath(path)}')


def main(argv):
    if '--series1' in argv:
        return series1(data_dir(argv))
    d = data_dir(argv)
    files = sorted(glob.glob(os.path.join(d, 'Distributions', 'nk', 'Series *', 'nk_a*_t0ms.txt')))
    if len(files) != 10:
        sys.exit(f'expected 10 t = 0 spectra, found {len(files)}')
    grid = load_nk(next(f for f in files if 'Series 2' in f))[0]
    stack = []
    for f in files:
        k, n, _ = load_nk(f)
        N, EN = moments(k, n)
        print(f'  {os.path.relpath(f, d)}: N = {N:.0f}, E/N = {EN:.1f} nK')
        stack.append(np.interp(grid, k, n))
    n = np.mean(stack, axis=0)
    N, EN = moments(grid, n)
    out = {
        'k_um_inv': grid.tolist(),
        'n_k': n.tolist(),
        'N': N,
        'V_um3': V_UM3,
        'density_um3': N / V_UM3,
        'EN_nK': EN,
    }
    path = os.path.join(os.path.dirname(__file__), '..', '..', 'shared-data', 'measured-state-d.json')
    json.dump(out, open(path, 'w'))
    print(f'average of {len(files)}: N = {N:.0f}, V = {V_UM3:.0f} µm³, n = {N / V_UM3:.4f} µm⁻³, E/N = {EN:.2f} nK -> {os.path.normpath(path)}')


if __name__ == '__main__':
    main(sys.argv)

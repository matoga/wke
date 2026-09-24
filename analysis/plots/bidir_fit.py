"""Scaling analysis of the bidirectional scaling experiment, applied alike to the published n_k and to WKE runs.

Spectra are sets of curves (t in ms, a in a₀, k in µm⁻¹, n_k in µm³ per volume, error or None).

- Self-similar collapse n_k(k, t) = t̄^α F(t̄^β k), t̄ = t ā^p / t₀ with ā = a/(300 a₀) and t₀ = 40 ms:
  the cost at (α, β, p) is the mean over a scaled-k grid of the variance of ln(t̄^(−α) n_k) between the
  curves, each divided by the mean squared relative error of the data at that point (1 for model curves). This is the
  F-statistic of the published analysis: spread between the scaled curves over the spread within them.
- Uncertainties: the spread (standard deviation) of the exponents over 80 subsets, each holding a random
  third of the k points of every curve.
- The clock exponent p: with α and β fixed, the p that best collapses the curves of all a together.
- Observables: the quasi-condensate number N_QC and width Δ_k from the cumulative distribution
  F_k = ∫₀^k 4πk′² n_k dk′, and the apparent temperatures T_peak and T_low from the spectral energy
  density E_k = (ħ²k²/2m) 4πk² n_k (definitions below, each checked against the published values).
"""
import glob
import os
import re
import numpy as np

A_REF, T0_MS = 300.0, 40.0
HBAR, KB = 1.054571817e-34, 1.380649e-23
M_K39 = 38.96370668 * 1.66053906660e-27
V_UM3 = np.pi * 12.5 ** 2 * 42.0
# published results
PUBLISHED = {
    'alpha_IR': (1.08, 0.09), 'beta_IR': (0.34, 0.04), 'alpha_UV': (-0.67, 0.06), 'beta_UV': (-0.14, 0.02),
    'p_IR': (0.9, 0.1), 'p_UV': (1.1, 0.1),
}
# momentum windows in scaled k = t̄^β k (µm⁻¹) and the time window in t ā (ms)
WINDOW = {'IR': (0.0, 0.5), 'UV': (1.0, 4.0)}
T_WINDOW = (20.0, 160.0)


# ---------------------------------------------------------------- data

def load_series(data_dir, series):
    """Published n_k of one series: list of curves {a, t, k, n, err}."""
    out = []
    for f in sorted(glob.glob(os.path.join(data_dir, 'Distributions', 'nk', f'Series {series}', 'nk_a*_t*ms.txt'))):
        m = re.search(r'nk_a(\d+)a0_t(\d+)ms', f)
        d = np.loadtxt(f, skiprows=2)
        out.append(dict(a=float(m.group(1)), t=float(m.group(2)), k=d[:, 0], n=d[:, 1], err=d[:, 2]))
    return out


def load_xy(path):
    d = np.loadtxt(path, skiprows=1)
    return d[:, 0], d[:, 1], d[:, 2]


def run_curves(run, k_min=0.0):
    """WKE run as curves in the published convention n_k = V f/(2π)³, snapshot times in ms (t = 0 included)."""
    s = run['snapshots']
    k = np.asarray(s['k_um_inv'])
    keep = k >= k_min
    out = []
    for t, f in zip(s['t_s'], s['n_k']):
        f = np.asarray(f, dtype=float)
        if not np.all(np.isfinite(f)):
            continue
        out.append(dict(a=float(run['settings']['a_a0']), t=1e3 * t, k=k[keep], n=V_UM3 * f[keep] / (2 * np.pi) ** 3, err=None))
    return out


# ---------------------------------------------------------------- collapse

def _prepared(curves, rng=None):
    """ln n, relative error and k per curve; with rng, a random third of the points of each curve."""
    out = []
    for c in curves:
        ok = c['n'] > 0
        if rng is not None:
            ok &= rng.random(len(c['n'])) < 1 / 3
        if ok.sum() < 3:
            continue
        s = (c['err'][ok] / c['n'][ok]) if c['err'] is not None else None
        out.append((c['a'], c['t'], c['k'][ok], np.log(c['n'][ok]), s))
    return out


def collapse_cost(prep, alpha, beta, p, window, nx=60):
    lo, hi = window
    xg = np.linspace(max(lo, 1e-3), hi, nx)
    Y = np.full((len(prep), nx), np.nan)
    S2 = np.full((len(prep), nx), np.nan)
    for i, (a, t, k, y, s) in enumerate(prep):
        tb = t * (a / A_REF) ** p / T0_MS
        x = tb ** beta * k
        inside = (xg >= x[0]) & (xg <= x[-1])
        Y[i, inside] = np.interp(xg[inside], x, y - alpha * np.log(tb))
        S2[i, inside] = np.interp(xg[inside], x, s ** 2) if s is not None else 1.0
    cnt = np.sum(np.isfinite(Y), axis=0)
    use = cnt >= 2
    if use.sum() < nx // 4:
        return np.inf
    # spread between the curves over the spread within them, at each scaled k
    var = np.nanvar(Y[:, use], axis=0, ddof=1)
    return float(np.mean(var / np.nanmean(S2[:, use], axis=0)))


def _minimise(cost, x0, steps, n_iter=6):
    """Coordinate grid search with shrinking steps (no scipy)."""
    x = np.array(x0, dtype=float)
    steps = np.array(steps, dtype=float)
    best = cost(x)
    for _ in range(n_iter):
        improved = True
        while improved:
            improved = False
            for j in range(len(x)):
                for d in np.linspace(-5, 5, 11) * steps[j]:
                    if d == 0:
                        continue
                    y = x.copy()
                    y[j] += d
                    c = cost(y)
                    if c < best:
                        best, x, improved = c, y, True
        steps /= 4
    return x, best


def fit_ab(curves, window, p=1.0, fixed_p=True, n_sub=80, seed=1):
    """Exponents (α, β) of the collapse over the time window; returns dict with values, errors and cost."""
    prep = _prepared(curves)
    start = (1.0, 0.3) if window[1] <= 1 else (-0.7, -0.14)
    f = lambda v: collapse_cost(prep, v[0], v[1], p, window)
    # coarse global scan first, so the start does not decide the minimum
    grid = [(al, be) for al in np.linspace(-3, 3, 31) for be in np.linspace(-0.8, 0.8, 33)]
    start = min(grid, key=f)
    (al, be), c = _minimise(f, start, (0.1, 0.02))
    rng = np.random.default_rng(seed)
    subs = []
    for _ in range(n_sub):
        ps = _prepared(curves, rng)
        g = lambda v: collapse_cost(ps, v[0], v[1], p, window)
        subs.append(_minimise(g, (al, be), (0.05, 0.01), n_iter=3)[0])
    subs = np.array(subs)
    return dict(alpha=al, beta=be, cost=c, alpha_err=subs[:, 0].std(), beta_err=subs[:, 1].std())


def fit_p(curves, window, alpha, beta, n_sub=80, seed=2):
    """Clock exponent p of t → t ā^p for fixed (α, β): best collapse of all a together."""
    prep = _prepared(curves)
    ps = np.linspace(-1, 3, 81)
    f = lambda v: collapse_cost(prep, alpha, beta, v[0], window)
    p0 = ps[int(np.argmin([f([q]) for q in ps]))]
    (p,), c = _minimise(f, (p0,), (0.02,))
    rng = np.random.default_rng(seed)
    subs = []
    for _ in range(n_sub):
        pr = _prepared(curves, rng)
        g = lambda v: collapse_cost(pr, alpha, beta, v[0], window)
        subs.append(_minimise(g, (p,), (0.02,), n_iter=3)[0][0])
    profile = np.array([f([q]) for q in ps])
    return dict(p=p, p_err=float(np.std(subs)), cost=c, p_grid=ps, cost_grid=profile)


def in_window(curves, p=1.0, window=T_WINDOW):
    """Curves whose rescaled time t ā^p lies in the window (ms)."""
    lo, hi = window
    return [c for c in curves if lo * (1 - 1e-9) <= c['t'] * (c['a'] / A_REF) ** p <= hi * (1 + 1e-9)]


# ---------------------------------------------------------------- observables

def Nk(c):
    return 4 * np.pi * c['k'] ** 2 * c['n']


def Ek_nK_um(c):
    """Spectral energy density E_k/k_B (nK µm): ħ²k²/2m N_k."""
    return HBAR ** 2 * (c['k'] * 1e6) ** 2 / (2 * M_K39) / KB * 1e9 * Nk(c)


def cumulative(c):
    """F_k = ∫₀^k 4πk′² n_k dk′ (atoms) on [0, k...]."""
    k, N = c['k'], Nk(c)
    F = np.concatenate([[0], np.cumsum(0.5 * (N[1:] + N[:-1]) * np.diff(k))])
    return np.concatenate([[0], k]), np.concatenate([[0], F])


def quasi_condensate(c, k_fit=(0.8, 1.2)):
    """N_QC (atoms) and Δ_k (µm⁻¹) from F_k: a line fitted to F_k over k_fit, N_QC = max(0, intercept);
    Δ_k = the k where F_k minus the fitted thermal part (slope × k) first reaches N_QC/2 (nan if N_QC = 0).
    On the published F_k this gives the published N_QC from 80 ms on and Δ_k at every time."""
    kk, FF = cumulative(c)
    sel = (kk > k_fit[0]) & (kk <= k_fit[1])
    if sel.sum() < 2:
        return np.nan, np.nan
    slope, icpt = np.polyfit(kk[sel], FF[sel], 1)
    nqc = max(0.0, icpt)
    if nqc == 0:
        return 0.0, np.nan
    G = FF - slope * kk
    j = int(np.argmax(G >= nqc / 2))
    dk = float(np.interp(nqc / 2, G[j - 1:j + 1], kk[j - 1:j + 1])) if j > 0 else kk[0]
    return nqc, dk


# ħ²k²/2m at the peak of k⁴/(e^x − 1): x = 2(1 − e^(−x))
X_PEAK = 1.5936242600400401


def temperatures(c, k_low=(0.5, 1.2), k_max=4.0, smooth=0.15):
    """Apparent temperatures (nK), as defined for the published data.
    T_peak: at μ = 0 the Bose E_k ∝ k⁴/(e^x − 1), x = ħ²k²/2mk_BT, peaks at x = 1.594, so
    T_peak = ħ²k_peak²/(2m k_B 1.594), with k_peak the maximum of E_k smoothed over ±0.15 µm⁻¹ (k ≤ 4 µm⁻¹).
    T_low: in the classical-field limit n_k = V k_B T/((2π)³ ħ²k²/2m), so E_k = 4πV k_B T k²/(2π)³;
    T_low from a least-squares fit E_k = A k² over k_low. Both reproduce the published values at 300 a₀."""
    k, E = c['k'], Ek_nK_um(c)
    inside = k <= k_max
    ks = k[inside]
    Es = np.array([np.mean(E[inside][np.abs(ks - q) <= smooth]) for q in ks])
    j = int(np.argmax(Es))
    if 0 < j < len(ks) - 1:
        A = np.polyfit(ks[j - 1:j + 2], Es[j - 1:j + 2], 2)
        kp = -A[1] / (2 * A[0]) if A[0] < 0 else ks[j]
    else:
        kp = ks[j]
    T_peak = HBAR ** 2 * (kp * 1e6) ** 2 / (2 * M_K39 * KB * X_PEAK) * 1e9
    sel = (k > k_low[0]) & (k <= k_low[1])
    A = np.sum(E[sel] * k[sel] ** 2) / np.sum(k[sel] ** 4) if sel.any() else np.nan
    T_low = (2 * np.pi) ** 3 * A / (4 * np.pi * V_UM3)
    return T_peak, T_low

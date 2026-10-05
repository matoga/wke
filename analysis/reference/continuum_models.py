"""
Independent continuum reference for the dressing ratios C_model/C_bare in tests/loops.test.ts.

Same state as the test: the Gaussian shell q(p) ∝ exp[−(p − 20/3)²/(2σ²)], σ = 0.28/0.3, normalised on
[0.01, ∞), occupation f = q/p², N_cal = 2. Nothing here uses the solver's grid, tables or quadrature:

  H(x) = ∫ s f ln|(s − x)/(s + x)| ds   by composite Gauss with the log singularity subtracted
  J(x) = ∫₀^|x| s f ds                  by composite Gauss
  C(p) ∝ ∫∫ dp₁ dp₂ p₁ p₂ min(p, p₁, p₂, p₃)/p · M · [f₁f₂(f + f₃) − f f₃(f₁ + f₂)],  p₃² = p₁² + p₂² − p²

with the dressing M averaged over the resonant configurations of fixed magnitudes. P = |p + p₃| is uniform
on its interval; for fixed P the two triangles (p, p₃, P) and (p₁, p₂, P) turn independently about P, so
the dihedral angle φ is uniform on [0, π] and Q = |p − p₁| follows from Q² = A − B cos φ. The marginal of
Q is uniform on [max(|p − p₁|, |p₂ − p₃|), min(p + p₁, p₂ + p₃)].

Usage:  analysis/.venv/bin/python analysis/reference/continuum_models.py   (numpy only, about 25 minutes)
"""

import numpy as np

P0, SIG, NCAL = 20 / 3, 0.28 / 0.3, 2.0
P_MAX_REF, N_GRID = 28.9312, 500
IDX = [375, 393, 407, 419, 428]
RUNG_C = 1.85

qp = lambda p: np.exp(-((p - P0) ** 2) / (2 * SIG * SIG))


def gauss_panels(a, b, panels, n):
    x, w = np.polynomial.legendre.leggauss(n)
    edges = np.linspace(a, b, panels + 1)
    lo, hi = edges[:-1, None], edges[1:, None]
    return (0.5 * (hi - lo) * x + 0.5 * (hi + lo)).ravel(), (0.5 * (hi - lo) * w).ravel()


# normalisation on [0.01, ∞)
_s, _w = gauss_panels(0.01, 40, 4000, 8)
Z = np.sum(_w * qp(_s))
sf = lambda s: qp(s) / Z / s  # s f(s)

# ------------------------------------------------------------------ H and J tables ---
S_HI = 20.0
xs = np.exp(np.linspace(np.log(1e-3), np.log(2000.0), 6000))


def H_direct(x):
    # ∫₀^S s f ln|s − x| ds with (s f(s) − x f(x)) ln|s − x| regular, split at x, minus the smooth ln(s + x) part
    out = np.empty_like(x)
    for i, xi in enumerate(x):
        c = sf(xi) if xi < S_HI else 0.0
        parts = []
        if xi < S_HI:
            parts = [gauss_panels(1e-9, xi, 200, 8), gauss_panels(xi, S_HI, 400, 8)]
        else:
            parts = [gauss_panels(1e-9, S_HI, 600, 8)]
        acc = 0.0
        for s, w in parts:
            acc += np.sum(w * ((sf(s) - c) * np.log(np.abs(s - xi)) - sf(s) * np.log(s + xi)))
        F = lambda s: (s - xi) * np.log(abs(s - xi)) - s if s != xi else -s
        acc += c * (F(S_HI) - F(0.0))
        out[i] = acc
    return out


Ht = H_direct(xs)
_js, _jw = gauss_panels(1e-9, S_HI, 20000, 4)
_jc = np.concatenate([[0.0], np.cumsum(_jw * sf(_js))])
_jx = np.concatenate([[0.0], _js])


def H(x):
    ax = np.abs(x)
    v = np.interp(np.log(np.maximum(ax, xs[0])), np.log(xs), Ht)
    v = np.where(ax < xs[0], ax * Ht[0] / xs[0], v)
    return np.sign(x) * v


def Hp(x):
    ax = np.maximum(np.abs(x), xs[0])
    d = 1e-5 * ax
    return (H(ax + d) - H(ax - d)) / (2 * d)


def divH(a, b):
    d = a - b
    small = np.abs(d) < 1e-4 * np.maximum(np.abs(a), 1e-3)
    return np.where(small, Hp(0.5 * (a + b)), (H(a) - H(b)) / np.where(small, 1.0, d))


def J(x):
    return np.interp(np.abs(x), _jx, _jc)


def lminus(Q, w, sign):
    xa, xb = (w + Q * Q) / (2 * Q), (w - Q * Q) / (2 * Q)
    re = sign / (2 * NCAL) * divH(xa, xb)
    im = -np.pi * sign / (2 * NCAL) * (J(xa) - J(xb)) / Q
    return re, im


def lplus(P, wp, sign):
    D = np.sqrt(np.maximum(2 * wp - P * P, 0))
    ya, yb = 0.5 * (P + D), 0.5 * (D - P)
    re = sign / NCAL * divH(ya, yb)
    im = -np.pi * sign / NCAL * (J(ya) - J(yb)) / P
    return re, im


# ------------------------------------------------------------------ collision sums ---
f = lambda p: qp(p) / Z / (p * p)
XQ, WQ = np.polynomial.legendre.leggauss(32)
XP, WP = np.polynomial.legendre.leggauss(24)
NPHI = 32
# partner quadrature: Gauss panels of this width, with breakpoints at every kink of min(p, p1, p2, p3)
PANEL, NODES = 0.1, 4
PHI = (np.arange(NPHI) + 0.5) * np.pi / NPHI  # midpoint rule: spectral for g(cos φ)


def events(p):
    """Continuum partner quadrature for target p: (p1, p2, weight)."""
    lo, hi = 0.2, 16.0
    b1 = sorted({lo, hi, *[v for v in (p, p / np.sqrt(2)) if lo < v < hi]})
    P1, W1 = [], []
    for a, b in zip(b1[:-1], b1[1:]):
        x, w = gauss_panels(a, b, max(1, int(np.ceil((b - a) / PANEL))), NODES)
        P1.append(x); W1.append(w)
    P1, W1 = np.concatenate(P1), np.concatenate(W1)
    rows = []
    for p1, w1 in zip(P1, W1):
        low = max(lo, np.sqrt(max(p * p - p1 * p1, 0.0)))
        cuts = {low, hi}
        for v in (p, p1, np.sqrt(max(2 * p * p - p1 * p1, 0.0))):
            if low < v < hi: cuts.add(v)
        cuts = sorted(cuts)
        for a, b in zip(cuts[:-1], cuts[1:]):
            if b - a < 1e-12: continue
            x, w = gauss_panels(a, b, max(1, int(np.ceil((b - a) / PANEL))), NODES)
            rows.append(np.stack([np.full_like(x, p1), x, w * w1]))
    return np.concatenate(rows, axis=1)


def collision(p, model, sign):
    p1, p2, w = events(p)
    p3 = np.sqrt(np.maximum(p1 * p1 + p2 * p2 - p * p, 0))
    ok = p3 > 1e-9
    p1, p2, w, p3 = p1[ok], p2[ok], w[ok], p3[ok]
    fp, f1, f2, f3 = f(p), f(p1), f(p2), f(p3)
    rate = w * p1 * p2 * np.minimum(np.minimum(p, p1), np.minimum(p2, p3)) / p * (f1 * f2 * (fp + f3) - fp * f3 * (f1 + f2))
    if model == 'bare':
        return rate.sum()
    om = np.abs(p * p - p1 * p1)
    Qa, Qb = np.maximum(np.abs(p - p1), np.abs(p2 - p3)), np.minimum(p + p1, p2 + p3)
    Q = 0.5 * (Qb + Qa)[:, None] + 0.5 * (Qb - Qa)[:, None] * XQ
    re_m, im_m = lminus(np.maximum(Q, 1e-12), om[:, None], sign)
    Pa, Pb = np.maximum(np.abs(p - p3), np.abs(p1 - p2)), np.minimum(p + p3, p1 + p2)
    wp = p * p + p3 * p3
    if model == 'one-loop':
        P = 0.5 * (Pb + Pa)[:, None] + 0.5 * (Pb - Pa)[:, None] * XP
        re_p, _ = lplus(P, wp[:, None], sign)
        M = 1 + 2 * 0.5 * (re_p * WP).sum(1) + 8 * 0.5 * (re_m * WQ).sum(1)
    elif model in ('chain', 'heuristic-a', 'heuristic-c'):
        c = {'chain': 1.0, 'heuristic-a': 4.0, 'heuristic-c': RUNG_C}[model]
        M = 0.5 * (WQ / ((1 - c * re_m) ** 2 + (c * im_m) ** 2)).sum(1)
    elif model == 'heuristic-b':
        M = np.zeros_like(p1)
        for xp, wpp in zip(XP, WP):
            P = 0.5 * (Pb + Pa) + 0.5 * (Pb - Pa) * xp
            re_p, _ = lplus(P, wp, sign)  # heuristic B keeps Re L₊ only
            aPar = (p * p + P * P - p3 * p3) / (2 * P)
            bPar = (p1 * p1 + P * P - p2 * p2) / (2 * P)
            A = p * p + p1 * p1 - 2 * aPar * bPar
            B = 2 * np.sqrt(np.maximum(p * p - aPar ** 2, 0) * np.maximum(p1 * p1 - bPar ** 2, 0))
            Qphi = np.sqrt(np.maximum(A[:, None] - B[:, None] * np.cos(PHI), 1e-24))
            rm, im = lminus(Qphi, om[:, None], sign)
            zr = re_p[:, None] + 4 * rm
            zi = 4 * im
            M += 0.5 * wpp * (1 / ((1 - zr) ** 2 + zi ** 2)).mean(1)
    else:
        raise ValueError(model)
    return (rate * M).sum()


if __name__ == '__main__':
    grid = np.exp(np.linspace(np.log(0.01), np.log(P_MAX_REF), N_GRID))
    for x, v in [(0.5, -2.4027462e-2), (3, -1.5763827e-1), (6.6666667, -4.9931614e-1), (9, -2.9653021e-1), (20, -1.0408138e-1)]:
        print(f'H({x}) = {H(np.array([x]))[0]:.8e}  (test reference {v:.8e})', flush=True)
    models = ['one-loop', 'chain', 'heuristic-a', 'heuristic-b', 'heuristic-c']
    for sign in (1, -1):
        print(f'sign {sign:+d}: columns {models}')
        for i in IDX:
            p = grid[i]
            bare = collision(p, 'bare', sign)
            print('  [' + ', '.join(f'{collision(p, m, sign) / bare:.5f}' for m in models) + f'],  # p = {p:.4f}', flush=True)

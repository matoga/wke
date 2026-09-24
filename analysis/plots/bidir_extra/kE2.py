"""Two robust measures of where the energy sits: a log-parabola peak fit over E_k ≥ 0.4 max, and ⟨k⟩_E."""
import numpy as np
import bidir_fit as B

def kE_fit(c, frac=0.4, kmax=4.5):
    """Peak of E_k from ln E_k = c0 + c1 ln k + c2 (ln k)² fitted over the points with E_k ≥ frac × max (k ≤ kmax)."""
    k, E = c['k'], B.Ek_nK_um(c)
    s = (k <= kmax) & (k > 0)
    k, E = k[s], E[s]
    near = E >= frac * E.max()
    x, y = np.log(k[near]), np.log(E[near])
    A = np.polyfit(x, y, 2)
    return float(np.exp(-A[1] / (2 * A[0]))) if A[0] < 0 else np.nan, near, A, s

def kE_mean(c, kmax=4.5):
    """Energy-weighted mean wavenumber ⟨k⟩_E = ∫k E_k dk / ∫E_k dk over k ≤ kmax."""
    k, E = c['k'], B.Ek_nK_um(c)
    s = k <= kmax
    return float(np.trapezoid(k[s] * E[s], k[s]) / np.trapezoid(E[s], k[s]))


# fits checked by eye: (a in a₀, t in ms) -> points dropped from the right end of the fit window
DROP_RIGHT = {(600.0, 320.0): 1}


def kE_mid(c, frac=0.6, kmax=4.5):
    """Peak of E_k from a parabola in E_k against k over the points with E_k ≥ frac × max (k ≤ kmax),
    weighted by 1/σ when the curve has errors."""
    k, E = c['k'], B.Ek_nK_um(c)
    s = (k <= kmax) & (k > 0)
    k, E = k[s], E[s]
    w = None if c.get('err') is None else 1 / np.maximum(B.Ek_nK_um(dict(k=c['k'], n=c['err']))[s], 1e-9)
    near = E >= frac * E.max()
    drop = DROP_RIGHT.get((c.get('a'), c.get('t')), 0) if c.get('err') is not None else 0
    if drop:
        near[np.flatnonzero(near)[-drop:]] = False
    A = np.polyfit(k[near], E[near], 2, w=None if w is None else w[near])
    return float(-A[1] / (2 * A[0])) if A[0] < 0 else np.nan, near, A, s

"""2D scan of the clock exponent p and a time offset δt: τ = (t − δt) ā^p, ā = a/300 a₀.
Cost: mean over τ ∈ [20, 160] ms and k ∈ [1, 4] µm⁻¹ of the variance of E_k between the values of a at equal τ,
divided by the mean squared error (1 for model curves); E_k interpolated linearly in ln(t − δt) between
snapshots, no extrapolation outside the measured times."""
import sys, os, json, glob
sys.path.insert(0, 'analysis/plots')
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import bidir_fit as B
from common import save
from bidir_initial import pchip
SMOOTH_T = os.environ.get('SMOOTH_T') == '1'
D = os.environ['WKE_BIDIR_DATA']
OUT = 'analysis/results/2026-09-24_bidir-chain-uv-standard'
TAU = np.geomspace(float(os.environ.get('TAU_LO', 20)), float(os.environ.get('TAU_HI', 160)), 9)
P = np.linspace(0, 3, 31)  # steps of 0.1
DT = np.arange(0, float(os.environ.get('DT_MAX', 10)) + 0.5, 1.0)  # steps of 1 ms
KG = np.linspace(1.0, 4.0, 25)

def tables(curves_by_a, noise=None, rng=None):
    tab = {}
    for a, cs in curves_by_a.items():
        cs = sorted([c for c in cs if c['t'] > 0], key=lambda c: c['t'])
        E, S = [], []
        for c in cs:
            n = c['n'] if (rng is None or c['err'] is None) else c['n'] + rng.standard_normal(len(c['n'])) * c['err']
            E.append(np.interp(KG, c['k'], B.Ek_nK_um(dict(k=c['k'], n=n))))
            S.append(np.interp(KG, c['k'], B.Ek_nK_um(dict(k=c['k'], n=c['err']))) if c['err'] is not None else np.ones_like(KG))
        tab[a] = (np.array([c['t'] for c in cs]), np.array(E), np.array(S))
    return tab

ADAPT = os.environ.get('ADAPT') == '1'
TAU_BOUNDS = (10.0, 320.0)


def cost(tab, p, dt):
    """With ADAPT, the τ window is the overlap of the τ ranges covered by every a, clipped to TAU_BOUNDS,
    and must span at least a factor 4; otherwise the fixed TAU grid."""
    prep = {}
    for a, (t, E, S) in tab.items():
        ts = t - dt
        ok = ts > 0
        if ok.sum() < 2:
            return np.nan
        prep[a] = (ts[ok], E[ok], S[ok])
    if ADAPT:
        lo = max(TAU_BOUNDS[0], max(ts[0] * (a / 300) ** p for a, (ts, _, _) in prep.items()))
        hi = min(TAU_BOUNDS[1], min(ts[-1] * (a / 300) ** p for a, (ts, _, _) in prep.items()))
        if hi < 4 * lo:
            return np.nan
        taus = np.geomspace(lo, hi, 9)
    else:
        taus = TAU
    vals = []
    for tau in taus:
        Es, Ss = [], []
        for a, (ts, Ea, Sa) in prep.items():
            tt = tau * (a / 300) ** (-p)
            if tt < ts[0] * (1 - 1e-9) or tt > ts[-1] * (1 + 1e-9):
                return np.nan
            if SMOOTH_T and len(ts) >= 3:
                # monotone cubic in ln t at each k: through every measured spectrum, no overshoot
                lt, x = np.log(ts), np.log(tt)
                Es.append(np.array([pchip(lt, Ea[:, q], np.array([x]))[0] for q in range(Ea.shape[1])]))
                Ss.append(np.array([pchip(lt, Sa[:, q] ** 2, np.array([x]))[0] for q in range(Sa.shape[1])]))
            else:
                j = int(np.clip(np.searchsorted(ts, tt) - 1, 0, len(ts) - 2))
                w = np.clip((np.log(tt) - np.log(ts[j])) / (np.log(ts[j + 1]) - np.log(ts[j])), 0, 1)
                Es.append((1 - w) * Ea[j] + w * Ea[j + 1]); Ss.append((1 - w) * Sa[j] ** 2 + w * Sa[j + 1] ** 2)
        vals.append(np.var(Es, axis=0, ddof=1) / np.mean(Ss, axis=0))
    return float(np.mean(vals))


def scan(tab):
    return np.array([[cost(tab, p, dt) for p in P] for dt in DT])

def best(C):
    i, j = np.unravel_index(np.nanargmin(C), C.shape)
    return P[j], DT[i]

data = {a: [c for c in B.load_series(D, 1) if c['a'] == a] for a in (150.0, 300.0, 600.0)}
Cd = scan(tables(data))
pd, dd = best(Cd)
rng = np.random.default_rng(7)
boot = np.array([best(scan(tables(data, rng=rng))) for _ in range(int(os.environ.get('NBOOT', 40)))])
print(f'measured: p = {pd:.2f}, δt = {dd:.2f} ms; resampled p = {boot[:,0].mean():.2f} ± {boot[:,0].std():.2f}, δt = {boot[:,1].mean():.2f} ± {boot[:,1].std():.2f} ms')
DATA_ONLY = os.environ.get('DATA_ONLY') == '1'
if not DATA_ONLY:
    runs = [json.load(open(f)) for f in glob.glob(OUT + '/runs/*.json')]
    model = {r['settings']['a_a0']: B.run_curves(r) for r in runs}
    Cm = scan(tables(model))
    pm, dm = best(Cm)
    print(f'large-N (100 to 280 a0): p = {pm:.2f}, δt = {dm:.2f} ms')
# profile: best p at each δt (measured)
prof = [(dt, P[np.nanargmin(row)] if np.any(np.isfinite(row)) else np.nan) for dt, row in zip(DT, Cd)]
print('measured best p at δt =', ' '.join(f'{dt:g}:{p:.2f}' for dt, p in prof))


panels = [(Cd, 'measured (series 1: 150, 300, 600 a₀)', (pd, dd))]
if not DATA_ONLY:
    panels.append((Cm, 'large-N, no offset in the model (100 to 280 a₀)', (pm, dm)))
fig, axes = plt.subplots(1, len(panels), figsize=(5.6 * len(panels), 4.6), squeeze=False)
axes = axes[0]
for ax, (C, name, (pb, db)) in zip(axes, panels):
    im = ax.pcolormesh(P, DT, np.log10(C), shading='nearest', cmap='viridis_r')
    ax.contour(P, DT, np.log10(C), levels=np.log10(np.nanmin(C)) + np.array([0.05, 0.2, 0.5]), colors='w', linewidths=0.7)
    ax.plot(pb, db, marker='*', ms=12, color='#c0392b', mec='w')
    ax.plot([P[np.nanargmin(r)] if np.any(np.isfinite(r)) else np.nan for r in C], DT, color='#c0392b', lw=0.8, ls=':')
    ax.set(xlabel='p in τ = (t − δt) ā^p', ylabel='δt (ms)', title=name)
    fig.colorbar(im, ax=ax, label='log₁₀ cost')
axes[0].scatter(boot[:, 0], boot[:, 1], s=8, color='w', edgecolor='k', linewidth=0.4, zorder=3, label='resampled data')
axes[0].legend(frameon=False, fontsize=8, loc='upper right')
head = f'τ window adapted: overlap of all a within {TAU_BOUNDS[0]:g} to {TAU_BOUNDS[1]:g} ms' if ADAPT else f'τ = {TAU[0]:g} to {TAU[-1]:g} ms'
fig.suptitle(f'{head}\nmeasured best p = {pd:.1f} at δt = {dd:g} ms (star); dotted = best p at each δt', y=1.05, fontsize=9)
fig.tight_layout()
save(fig, OUT, ('bidir_scan_p_dt_adaptive' + ('_smooth' if SMOOTH_T else '') if ADAPT else f'bidir_scan_p_dt_tau{TAU[0]:g}-{TAU[-1]:g}') + f'_dt{DT[-1]:g}', dict(p=P, dt=DT, cost_measured=Cd, best_measured=[pd, dd], boot=boot))

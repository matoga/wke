"""Coherence-length figure: ℓ³ = f(k→0)/(η n), η the equilibrium condensed fraction, so that ℓ³ = V
in equilibrium. η = η_eq (ideal Bose gas at the initial E/N) for Bose +1 runs. Classical runs have
no cutoff-free η and use η = 1; that length is written ℓ̄ (ℓ̄³ = f(k→0)/n) everywhere, never ℓ.

Left: (m/ħ) dℓ²/dt against ℓ k_ξ, lin-lin; middle: the same, log-log; right: ℓ k_p against
ℓ k_ξ (constant once the spectrum scales). Points of one run are joined by thin lines. Guide: the measured universal rate D = 3.4 ħ/m.

Runs that record ℓ at every sample (points.ell_um, ellRate, ellRateErr; rate from the collision
term; f₀ from a fit ln f = A + B k² over k ≤ k_p/5, bars from the fit window k_p/5 or k_p/10 and
two steps) are drawn with bars; samples whose uncertainty exceeds their value are hidden. Older runs fall back to the occupation snapshots: the same fit
for f₀, dℓ²/dt by finite differences in t, no bars, the t = 0 snapshot dropped; the title says so.
"""
import numpy as np
import matplotlib.pyplot as plt
from common import Style, GUIDE, LABEL, point_kw, legends, save, run_id, ell_norm, ell_symbol

GUIDE_D = 3.4


def f0_fit(k, f, kmax):
    """f(k→0): least-squares fit ln f = A + B k² over all grid points with k ≤ kmax; returns e^A
    (the estimator run.ts uses)."""
    m = (k <= kmax) & (f > 0)
    if m.sum() < 3:
        return f[0]
    B, A = np.polyfit(k[m] ** 2, np.log(f[m]), 1)
    return np.exp(A)


def series(r):
    """(ℓ k_ξ, rate, err, ell k_p, from_snapshots) for one run."""
    p, s = r['points'], r['settings']
    kxi, hom = r['scales']['kXi_um_inv'], r['scales']['hbarOverM_um2_per_s']
    # run.ts stores ℓ with η = 1; ℓ³ = f₀/(η n) scales ℓ by η^(−1/3) and dℓ²/dt by η^(−2/3)
    cl, c2 = ell_norm(r) ** (-1 / 3), ell_norm(r) ** (-2 / 3)
    if p.get('ellRate'):
        x = np.array(p['X'], float)
        y, e, ell = (np.array(p[k], float) for k in ('ellRate', 'ellRateErr', 'ell_um'))
        ell = ell * cl
        return ell * kxi, y * c2, e * c2, ell * kxi / x, False
    sn = r.get('snapshots', {})
    if len(sn.get('n_k', [])) < 3:
        return None
    t = np.array(sn['t_s'], float)
    x = np.array(sn['X'], float)
    k = np.array(sn['k_um_inv'], float)
    f0 = [f0_fit(k, np.array(nk, float), kxi / xx / 5) for nk, xx in zip(sn['n_k'], x)]
    ell = np.cbrt(np.array(f0) / (ell_norm(r) * s['density_um3']))
    y = np.gradient(ell ** 2, t) / hom
    # drop t = 0: the initial state has no low-k plateau yet and its difference is one-sided
    ell, x, y = ell[1:], x[1:], y[1:]
    return ell * kxi, y, np.zeros_like(y), ell * kxi / x, True


def make(study_dir, study, runs):
    style = Style(runs)
    data = []
    for r in runs:
        d = series(r)
        if d is None:
            continue
        x, y, e, lk, snap = d
        # hide samples whose uncertainty exceeds their value (before the low-k plateau has formed)
        keep = np.isfinite(y) & np.isfinite(e) & np.isfinite(lk) & (e <= np.abs(y))
        data.append((r, x[keep], y[keep], e[keep], lk[keep], snap))
    if not any(len(d[1]) for d in data):
        print('  ell: no points'); return
    L, Lt, Lk = ell_symbol([d[0] for d in data])
    arrays = {}
    for r, x, y, e, lk, _ in data:
        rid = run_id(r)
        arrays[f'{rid}__{Lk}_kxi'] = x; arrays[f'{rid}__{Lk}_rate'] = y
        arrays[f'{rid}__{Lk}_rate_err'] = e; arrays[f'{rid}__{Lk}_kp'] = lk

    fig, axes = plt.subplots(1, 3, figsize=(17, 5.2))
    xmax = max(d[1].max() for d in data if len(d[1]))
    xmin = min(d[1].min() for d in data if len(d[1]))
    ally = np.concatenate([d[2] for d in data])

    for j, ax in enumerate(axes[:2]):
        logy = j == 1
        for r, x, y, e, _, _ in data:
            m, c = style.of(r)
            ok = y > 0 if logy else np.ones_like(y, bool)
            lo = np.minimum(e, y - 1e-12) if logy else e
            ax.plot(x[ok], y[ok], '-', color=c, lw=0.6, alpha=0.6, zorder=2)
            ax.errorbar(x[ok], y[ok], yerr=[lo[ok], e[ok]], **point_kw(m, c), ecolor=c, elinewidth=0.8, capsize=0, zorder=3)
        ax.axhline(GUIDE_D, **GUIDE)
        ax.annotate(f'{GUIDE_D}', (xmin if logy else 0, GUIDE_D), xytext=(4, 3), va='bottom', ha='left', **LABEL)
        ax.set_ylabel(rf'$(m/\hbar)\,\mathrm{{d}}{L}^{{2}}/\mathrm{{d}}t$')
    axes[0].set_xlim(0, 1.03 * xmax)
    axes[0].set_ylim(0, max(1.3 * np.nanpercentile(ally, 99), 1.2 * GUIDE_D))
    axes[1].set_xscale('log'); axes[1].set_yscale('log')
    pos = ally[ally > 0]
    axes[1].set_ylim(max(pos.min() * 0.7, 1e-4) if len(pos) else 1e-4, 3 * max(GUIDE_D, pos.max() if len(pos) else 1))

    ax = axes[2]
    for r, x, _, _, lk, _ in data:
        m, c = style.of(r)
        ax.plot(x, lk, '-', color=c, lw=0.6, alpha=0.6, zorder=2)
        ax.plot(x, lk, **point_kw(m, c), zorder=3)
    ax.set_xscale('log'); ax.set_yscale('log')
    ax.set_ylabel(rf'${L}\,k_p$')
    for a in axes:
        a.set_xlabel(rf'${L}\,k_\xi$'); a.grid(alpha=.3, which='both')
    arrays['guide__D'] = np.array(GUIDE_D)

    models = sorted({r['settings']['modelLabel'] for r in runs})
    acc = sorted({r['settings']['accuracy'] for r in runs})
    src = ('rate from the collision term' if not any(d[5] for d in data)
           else 'from the n_k snapshots, finite differences' if all(d[5] for d in data)
           else 'mixed: collision term and snapshot finite differences')
    etas = {r['settings']['stateName']: ell_norm(r) for r in runs}
    if all(v == 1.0 for v in etas.values()):
        head = 'ℓ̄³ = f(k→0)/n (η = 1: no cutoff-free equilibrium condensed fraction for classical waves)'
    else:
        head = ('ℓ³ = f(k→0)/(η_eq n), η_eq = ideal-Bose condensed fraction at the initial E/N: '
                + ', '.join(f'{k} {v:.3f}' for k, v in etas.items()))
    fig.suptitle(f"{head}\n{', '.join(models)}; {', '.join(acc)} accuracy; {src}")
    fig.tight_layout(rect=(0, 0, 0.80, 1))
    legends(fig, style, [f'{GUIDE_D} (measured D, in ħ/m)'], x0=0.805)
    save(fig, study_dir, 'ell', arrays)

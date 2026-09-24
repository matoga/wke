"""Rates at fixed progress against the gas parameter and against the energy ratio.

Left column: (m/ħ) d(1/k_p²)/dt at fixed k_ξ/k_p; right column: (m/ħ) dℓ²/dt at fixed ℓ k_ξ
(ℓ as in ell.py). Top row against n a³, bottom row against √ε = √(gn/(E/N)) = k_ξ/⟨k²⟩^(1/2),
the interaction over kinetic energy per atom of the initial state (conserved by the WKE up to the
numerical energy drift noted in the README).
Values are interpolated in log of the progress variable; a run that has not reached a level
is left out at that level. Marker = initial state, colour = the fixed level, runs of one state
joined by thin lines.
"""
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from common import Style, point_kw, save, run_id
import ell as ell_mod

A0_UM = 5.29177210903e-5
HBAR_JS = 1.054571817e-34
KB_JK = 1.380649e-23
KP_LEVELS = [4, 8, 12, 16]
ELL_LEVELS = [10, 20, 30, 40]
LEVEL_COLOURS = plt.get_cmap('viridis')(np.linspace(0.1, 0.85, 4))


def at(xs, ys, x0):
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    ok = np.isfinite(xs) & np.isfinite(ys) & (xs > 0)
    xs, ys = xs[ok], ys[ok]
    if len(xs) < 2 or not (xs.min() <= x0 <= xs.max()):
        return np.nan
    o = np.argsort(xs)
    return float(np.interp(np.log(x0), np.log(xs[o]), ys[o]))


def make(study_dir, study, runs):
    style = Style(runs)
    rows = []
    for r in runs:
        s, p = r['settings'], r['points']
        na3 = s['density_um3'] * (s['a_a0'] * A0_UM) ** 3
        # ⟨k²⟩ = 2m(E/N)/ħ² (µm⁻²), from E/N (nK) and ħ/m (µm²/s)
        k2 = 2 * r['initial']['EN_nK'] * 1e-9 * KB_JK / (HBAR_JS * r['scales']['hbarOverM_um2_per_s'] * 1e-12) * 1e-12
        X0 = r['scales']['kXi_um_inv'] / np.sqrt(k2)
        kp_rate = [at(p['X'], p['rate'], L) for L in KP_LEVELS]
        kp_err = [at(p['X'], p['rateErr'], L) for L in KP_LEVELS]
        d = ell_mod.series(r)
        ell_rate = [at(d[0], d[1], L) if d else np.nan for L in ELL_LEVELS]
        ell_err = [at(d[0], d[2], L) if d else np.nan for L in ELL_LEVELS]
        rows.append((r, na3, X0, kp_rate, kp_err, ell_rate, ell_err))

    arrays = {}
    for r, na3, X0, kr, ke, lr, le in rows:
        rid = run_id(r)
        arrays[f'{rid}__na3'] = na3; arrays[f'{rid}__sqrt_gn_over_EN'] = X0
        arrays[f'{rid}__kp_rate'] = np.array(kr); arrays[f'{rid}__kp_rate_err'] = np.array(ke)
        arrays[f'{rid}__ell_rate'] = np.array(lr); arrays[f'{rid}__ell_rate_err'] = np.array(le)
    arrays['levels__kxi_over_kp'] = np.array(KP_LEVELS); arrays['levels__ell_kxi'] = np.array(ELL_LEVELS)

    fig, axes = plt.subplots(2, 2, figsize=(12, 8.4))
    for col, (ri, ei, levels, ylab, lvl) in enumerate((
            (3, 4, KP_LEVELS, r'$(m/\hbar)\,\mathrm{d}(k_p^{-2})/\mathrm{d}t$', r'k_\xi/k_p'),
            (5, 6, ELL_LEVELS, r'$(m/\hbar)\,\mathrm{d}\ell^{2}/\mathrm{d}t$', r'\ell k_\xi'))):
        for row, (xi, xlab) in enumerate(((1, r'$n a^3$'), (2, r'$\sqrt{gn/(E/N)} = k_\xi/\langle k^2\rangle^{1/2}$'))):
            ax = axes[row, col]
            for j, L in enumerate(levels):
                c = LEVEL_COLOURS[j]
                for state in style.states:
                    sel = sorted((q for q in rows if q[0]['settings']['stateName'] == state), key=lambda q: q[xi])
                    x = np.array([q[xi] for q in sel]); y = np.array([q[ri][j] for q in sel]); e = np.array([q[ei][j] for q in sel])
                    ok = np.isfinite(y)
                    if not ok.any():
                        continue
                    ax.plot(x[ok], y[ok], '-', color=c, lw=0.6, alpha=0.6, zorder=2)
                    ax.errorbar(x[ok], y[ok], yerr=np.nan_to_num(e[ok]), **point_kw(style.marker[state], c), ecolor=c,
                                elinewidth=0.8, capsize=0, zorder=3)
            ax.set_xscale('log'); ax.set_ylim(0, None)
            ax.set_xlabel(xlab); ax.set_ylabel(ylab); ax.grid(alpha=.3, which='both')
        axes[0, col].set_title(f'at fixed ${lvl}$', fontsize=9)
        handles = [Line2D([], [], color=LEVEL_COLOURS[j], marker='o', ms=6, mfc='white', ls='', label=f'${lvl}$ = {L:g}')
                   for j, L in enumerate(levels)]
        axes[0, col].legend(handles=handles, fontsize=8, loc='lower right', frameon=False)

    models = sorted({r['settings']['modelLabel'] for r in runs})
    acc = sorted({r['settings']['accuracy'] for r in runs})
    fig.suptitle(f"Rates at fixed progress; {', '.join(models)}; {', '.join(acc)} accuracy")
    fig.tight_layout(rect=(0, 0, 0.80, 1))
    hs = [Line2D([], [], color='0.25', marker=style.marker[s], ms=6, mfc='white', ls='', label=f'{s}, E/N = {style.EN[s]:.0f} nK')
          for s in style.states]
    fig.legend(handles=hs, title='Marker: initial state', fontsize=8, title_fontsize=9, loc='upper left',
               bbox_to_anchor=(0.805, 0.95), frameon=False)
    save(fig, study_dir, 'rate_vs_a', arrays)

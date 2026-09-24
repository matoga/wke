"""Occupation spectra of all runs compared at fixed k_p, one panel per value of k_p.

n_k/(η n) (µm³) against k (µm⁻¹), log-log, with η as for ℓ (η_eq for Bose +1 runs, 1 for classical;
see ell.py), so that the k→0 plateau reads ℓ³ (ℓ̄³ for classical runs); k_p of the panel marked.
Only runs with k_p < k_ξ at that k_p are drawn, and each curve's legend entry gives its k_p/k_ξ.
A run's spectrum at a given k_p is interpolated in log n_k against log(k_ξ/k_p) between the two
snapshots that bracket it; a run that has no snapshot on both sides is left out of that panel.
Colour = a, line style = initial state.
"""
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from common import Style, GUIDE, LABEL, save, run_id, ell_norm

KP_LEVELS = [0.5, 0.25, 0.15, 0.1, 0.065]  # µm⁻¹
DASHES = ['-', '--', ':', '-.']


def at_kp(r, kp):
    """(k, n_k/(η n)) at smooth peak k_p, or None when k_p ≥ k_ξ or outside the snapshots."""
    sn = r.get('snapshots', {})
    kxi = r['scales']['kXi_um_inv']
    L = kxi / kp
    X = np.array(sn.get('X', []), float)
    j = np.searchsorted(X, L)
    if L <= 1 or j == 0 or j >= len(X):
        return None
    k = np.array(sn['k_um_inv'], float)
    lo, hi = np.array(sn['n_k'][j - 1], float), np.array(sn['n_k'][j], float)
    w = (np.log(L) - np.log(X[j - 1])) / (np.log(X[j]) - np.log(X[j - 1]))
    with np.errstate(divide='ignore', invalid='ignore'):
        f = np.exp((1 - w) * np.log(lo) + w * np.log(hi))
    return k, f / (ell_norm(r) * r['settings']['density_um3'])


def make(study_dir, study, runs):
    style = Style(runs)
    dash = {s: DASHES[i % len(DASHES)] for i, s in enumerate(style.states)}
    fig, axes = plt.subplots(1, len(KP_LEVELS), figsize=(3.6 * len(KP_LEVELS) + 2.6, 4.8), squeeze=False)
    axes = axes[0]
    arrays, drawn = {}, 0
    for ax, kp in zip(axes, KP_LEVELS):
        ymax, handles = 0, []
        for r in runs:
            d = at_kp(r, kp)
            if d is None:
                continue
            k, y = d
            ok = np.isfinite(y) & (y > 0)
            s = r['settings']
            ratio = kp / r['scales']['kXi_um_inv']
            h, = ax.plot(k[ok], y[ok], dash[s['stateName']], color=style.colour[s['a_a0']], lw=1.0,
                         label=f"{s['a_a0']:g} a₀, {s['stateName']}: {ratio:.2f}")
            handles.append(h)
            arrays[f'{run_id(r)}__kp{kp:g}__k_um_inv'] = k; arrays[f'{run_id(r)}__kp{kp:g}__nk_over_eta_n_um3'] = y
            arrays[f'{run_id(r)}__kp{kp:g}__kp_over_kxi'] = ratio
            ymax = max(ymax, y[ok].max()); drawn += 1
        ax.set_xscale('log'); ax.set_yscale('log')
        ax.set_xlim(kp / 100, kp * 30)
        if ymax:
            ax.set_ylim(ymax * 1e-6, ymax * 3)
        ax.axvline(kp, **GUIDE)
        ax.annotate('k_p', (kp, ax.get_ylim()[0]), xytext=(3, 4), va='bottom', **LABEL)
        ax.set_title(f'k_p = {kp:g} (µm⁻¹)', fontsize=9)
        ax.set_xlabel('k (µm⁻¹)'); ax.grid(alpha=.3, which='both')
        if handles:
            ax.legend(handles=handles, title='k_p/k_ξ', fontsize=5.8, title_fontsize=7, loc='lower left',
                      frameon=True, framealpha=0.85, edgecolor='none', handlelength=2.2)
    etas = {r['settings']['stateName']: ell_norm(r) for r in runs}
    quantum = any(v != 1.0 for v in etas.values())
    axes[0].set_ylabel('n_k/(η_eq n) (µm³)' if quantum else 'n_k/n (µm³)')
    if not drawn:
        plt.close(fig); print('  nk_fixed: no snapshots'); return
    arrays['levels__kp_um_inv'] = np.array(KP_LEVELS)
    models = sorted({r['settings']['modelLabel'] for r in runs})
    acc = sorted({r['settings']['accuracy'] for r in runs})
    norm = ('n_k/(η_eq n), η_eq = ideal-Bose condensed fraction at the initial E/N; plateau = ℓ³\n' if quantum
            else 'n_k/n; plateau = ℓ̄³ (η = 1)\n')
    fig.suptitle(f"{norm}n_k at fixed k_p (runs with k_p < k_ξ only); {', '.join(models)}; {', '.join(acc)} accuracy; "
                 'interpolated between snapshots')
    fig.tight_layout(rect=(0, 0, 1 - 2.4 / fig.get_figwidth(), 1))
    x0 = 1 - 2.3 / fig.get_figwidth()
    hs = [Line2D([], [], color='0.25', ls=dash[s], lw=1.2, label=f'{s}, E/N = {style.EN[s]:.0f} nK' + (f', η_eq = {etas[s]:.3f}' if quantum else '')) for s in style.states]
    fig.legend(handles=hs, title='Line: initial state', fontsize=8, title_fontsize=9, loc='upper left',
               bbox_to_anchor=(x0, 0.92), frameon=False)
    ha = [Line2D([], [], color=style.colour[a], lw=2, label=f'a = {a:g} a₀') for a in style.avals]
    fig.legend(handles=ha, title='Colour: scattering length', fontsize=8, title_fontsize=9, loc='upper left',
               bbox_to_anchor=(x0, 0.55), frameon=False)
    save(fig, study_dir, 'nk_fixed', arrays)

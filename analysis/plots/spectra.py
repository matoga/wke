"""Spectra figure, one panel per run: occupation n_k against k (log-log) at the saved snapshots,
coloured from early (violet) to late (red) along a rainbow scale, with k_ξ marked and the
initial state in black. Runs without saved snapshots are listed and skipped."""
import numpy as np
import matplotlib.pyplot as plt
from common import Style, GUIDE, LABEL, save, run_id

RAINBOW = plt.get_cmap('turbo')


def make(study_dir, study, runs):
    have = [r for r in runs if len(r.get('snapshots', {}).get('n_k', [])) > 1]
    missing = [run_id(r) for r in runs if r not in have]
    if missing:
        print(f"  spectra: no snapshots saved for {len(missing)} run(s): {', '.join(missing)}")
    if not have:
        return
    style = Style(have)
    n = len(have)
    cols = min(n, 4)
    rows = (n + cols - 1) // cols
    fig, axs = plt.subplots(rows, cols, figsize=(3.4 * cols + 1.2, 3.0 * rows), squeeze=False)
    arrays = {}
    for i, r in enumerate(have):
        ax = axs[i // cols, i % cols]
        s, sn = r['settings'], r['snapshots']
        k = np.array(sn['k_um_inv'], float)
        nk = np.array(sn['n_k'], float)
        X = np.array(sn['X'], float)
        rid = run_id(r)
        arrays[f'{rid}__k_um_inv'] = k; arrays[f'{rid}__n_k'] = nk
        arrays[f'{rid}__t_s'] = np.array(sn['t_s'], float); arrays[f'{rid}__kxi_over_kp'] = X
        m = len(nk)
        for j in range(m):
            c = 'k' if j == 0 else RAINBOW(0.05 + 0.9 * (j - 1) / max(1, m - 2))
            ok = nk[j] > 0
            ax.loglog(k[ok], nk[j][ok], color=c, lw=1.2 if j == 0 else 0.9)
        kxi = r['scales']['kXi_um_inv']
        ax.axvline(kxi, **GUIDE)
        ax.annotate('k_ξ', (kxi, 1), xycoords=('data', 'axes fraction'), xytext=(3, -12), **LABEL)
        top = np.nanmax(nk)
        ax.set_ylim(top * 1e-12, top * 3)
        ax.set_title(f"{s['stateName']}, a = {s['a_a0']:g} a₀ (E/N = {r['initial']['EN_nK']:.0f} nK)", fontsize=8.5)
        ax.set_xlabel('k (µm⁻¹)'); ax.set_ylabel('n_k (occupation)')
        ax.grid(alpha=.3, which='both')
    for j in range(n, rows * cols):
        axs[j // cols, j % cols].axis('off')
    sm = plt.cm.ScalarMappable(cmap=RAINBOW, norm=plt.Normalize(0, 1))
    cb = fig.colorbar(sm, ax=axs, fraction=0.025, pad=0.02)
    cb.set_ticks([0, 1]); cb.set_ticklabels(['early', 'late'])
    cb.set_label('snapshot (evenly spaced in log k_ξ/k_p; black: initial state)')
    models = sorted({r['settings']['modelLabel'] for r in have})
    fig.suptitle(f"Occupation at snapshots ({', '.join(models)})", fontsize=10)
    save(fig, study_dir, 'spectra', arrays)

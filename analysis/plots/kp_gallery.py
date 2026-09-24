"""Gallery, one column per run: 1/k_p² against t (top) and k_p against t (bottom), both lin-lin,
with 1/k_ξ² and k_ξ marked. Points are the samples used for the rate figure."""
import numpy as np
import matplotlib.pyplot as plt
from common import Style, GUIDE, LABEL, point_kw, save, run_id


def make(study_dir, study, runs):
    runs = [r for r in runs if len(r['points']['t_s'])]
    if not runs:
        print('  kp_gallery: no points'); return
    style = Style(runs)
    n = len(runs)
    fig, axs = plt.subplots(2, n, figsize=(2.6 * n, 5.6), squeeze=False)
    arrays = {}
    for j, r in enumerate(runs):
        m, c = style.of(r)
        s, p = r['settings'], r['points']
        t = np.array(p['t_s'], float)
        kxi = r['scales']['kXi_um_inv']
        kp = kxi / np.array(p['X'], float)
        rid = run_id(r)
        arrays[f'{rid}__t_s'] = t; arrays[f'{rid}__kp_um_inv'] = kp; arrays[f'{rid}__kxi_um_inv'] = kxi
        for row, (y, ref, lab) in enumerate(((1 / kp ** 2, 1 / kxi ** 2, '1/k_ξ²'), (kp, kxi, 'k_ξ'))):
            ax = axs[row, j]
            ax.plot(t, y, '-', color=c, lw=0.6, alpha=0.6)
            ax.plot(t, y, **point_kw(m, c, 3.2))
            ax.axhline(ref, **GUIDE)
            ax.annotate(lab, (t[0] if len(t) else 0, ref), xytext=(2, 2), va='bottom', **LABEL)
            ax.set_xlabel('t (s)', fontsize=8); ax.tick_params(labelsize=7); ax.grid(alpha=.3)
            if row == 1:
                ax.set_ylim(0, None)
        axs[0, j].set_title(f"{s['stateName']}\nE/N = {r['initial']['EN_nK']:.0f} nK, a = {s['a_a0']:g} a₀", fontsize=8.5)
    axs[0, 0].set_ylabel('1/k_p² (µm²)')
    axs[1, 0].set_ylabel('k_p (µm⁻¹)')
    models = sorted({r['settings']['modelLabel'] for r in runs})
    fig.suptitle(f"Peak momentum of each run ({', '.join(models)})", fontsize=10)
    fig.tight_layout()
    save(fig, study_dir, 'kp_gallery', arrays)

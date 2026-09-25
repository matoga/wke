"""How k_p is extracted: N_k = 4πk² n_k in lin-lin at several snapshots, the wide-peak fit and both estimators.

usage: analysis/.venv/bin/python analysis/plots/kp_extraction.py analysis/results/<study> [s01 s05 s12] [--experiment <data dir>]

With --experiment (or WKE_EXPERIMENT_DATA) also kp_extraction_experiment: the same fit on the measured n_k
of series 1 to 3, and k_p ℓ against t.

Top row: N_k/max against k at snapshots spread over the run. Shaded: the fit window of the wide peak
(the contiguous top down to 0.4 max; weights rise from 0 at 0.4 max to 1 at 0.6 max). Thin black: the fitted
parabola in (ln k, ln N_k). Solid line: the recorded wide peak (kpw_um_inv, interpolated to the snapshot
time); dashed: the older smooth peak (top 2% in ln N_k).
Middle row: the same with k ≤ 0.6 µm⁻¹, late snapshots.
Bottom row: 1/k_p² against t for both estimators and ℓ²/9, lin-lin from the origin.
Needs runs made with the wide peak (points.kpw_um_inv).
"""
import sys
import os
import json
import glob
import numpy as np
import matplotlib.pyplot as plt
sys.path.insert(0, os.path.dirname(__file__))
from common import save
from experiment import wke
from fig4c import STYLE, wide_fit


def make(study_dir, labels):
    arrays = {}
    with plt.rc_context(STYLE):
        fig, axes = plt.subplots(3, len(labels), figsize=(5.2 * len(labels), 12), constrained_layout=True)
        axes = np.atleast_2d(axes).reshape(3, len(labels))
        for col, lab in enumerate(labels):
            f = glob.glob(f'{study_dir}/runs/{lab}_*.json')[0]
            r = json.load(open(f)); d = wke(r); p = r['points']; sn = r['snapshots']
            k = np.array(sn['k_um_inv']); kxi = r['scales']['kXi_um_inv']; ts = np.array(sn['t_s'])
            t = np.array(p['t_s']); kpw = np.array(p['kpw_um_inv']); kps = kxi / np.array(p['X'])
            cm = plt.get_cmap('viridis')
            for row, (js, kmax) in enumerate(((np.linspace(0, len(ts) - 1, 6).astype(int), 3.0),
                                              (np.linspace(len(ts) // 2, len(ts) - 1, 5).astype(int), 0.6))):
                ax = axes[row, col]
                for j in js:
                    N = 4 * np.pi * k ** 2 * np.array(sn['n_k'][j]); c = cm(j / max(1, len(ts) - 1))
                    kp, lo, hi, co = wide_fit(k, N)
                    Nm = N.max()
                    m = k <= kmax
                    ax.plot(k[m], N[m] / Nm, color=c, lw=1.3, label=f't = {ts[j] * 1e3:.0f} ms')
                    ax.axvspan(k[lo], k[hi], color=c, alpha=0.08, lw=0)
                    kk = np.exp(np.linspace(np.log(k[lo]), np.log(k[hi]), 80))
                    ax.plot(kk, np.exp(np.polyval(co, np.log(kk))) / Nm, 'k-', lw=0.7)
                    if ts[j] >= t[0]:
                        ax.axvline(np.interp(ts[j], t, kpw), color=c, lw=1.2)
                        ax.axvline(np.interp(ts[j], t, kps), color=c, lw=1.0, ls=(0, (4, 2)))
                    arrays[f'{lab}__snap{j:02d}_t_s'] = ts[j]; arrays[f'{lab}__snap{j:02d}_Nk_over_max'] = N / Nm
                    arrays[f'{lab}__snap{j:02d}_kp_wide_python'] = kp
                arrays[f'{lab}__k_um_inv'] = k
                ax.set_xlim(0, kmax); ax.set_ylim(0, 1.08)
                ax.set_xlabel(r'$k$ (µm$^{-1}$)'); ax.set_ylabel(r'$N_k/\max N_k$')
                ax.set_title(f'{lab}, {r["settings"]["a_a0"]:g} ' + r'$a_0$' + ('' if row == 0 else ', late'))
                ax.legend(fontsize=8, frameon=False, loc='upper right')
            ax = axes[2, col]
            ok = d['ok']
            ax.plot(t * 1e3, 1 / kps ** 2, '-', color='0.6', lw=1.0, label='smooth peak (top 2%), old')
            ax.plot(t * 1e3, 1 / kpw ** 2, '-', color='#2b3f7f', lw=1.6, label=r'wide peak (top $\gtrsim$ max/2), new')
            ax.plot(t[ok] * 1e3, d['ell2'][ok] / 9, '--', color='#c0392b', lw=1.2, label=r'$\ell^2/9$')
            ax.set_xlim(0, None); ax.set_ylim(0, None)
            ax.set_xlabel('t (ms)'); ax.set_ylabel(r'$1/k_p^2$ (µm$^2$)'); ax.legend(fontsize=8, frameon=False)
            arrays.update({f'{lab}__t_s': t, f'{lab}__inv_kp2_smooth_um2': 1 / kps ** 2, f'{lab}__inv_kp2_wide_um2': 1 / kpw ** 2,
                           f'{lab}__ell2_over_9_um2': d['ell2'] / 9})
        fig.suptitle('k_p extraction on N_k = 4πk² n_k (lin-lin). Shaded: wide-peak fit window; thin black: fitted parabola; '
                     'solid: wide peak k_p (new); dashed: smooth peak k_p (old)', fontsize=10)
        save(fig, study_dir, 'kp_extraction', arrays)




def make_experiment(study_dir, data):
    """The same extraction on the measured n_k of series 1 to 3 (Fig 1d), and k_p ℓ against t for the experiment."""
    import os
    from fig4c import experiment_kp
    spectra, _, c_exp, c_err = experiment_kp(data)
    arrays = {'c_exp': c_exp, 'c_exp_err': c_err}
    with plt.rc_context(STYLE):
        fig, axes = plt.subplots(2, 3, figsize=(15.6, 8.4), constrained_layout=True)
        cm = plt.get_cmap('viridis')
        for col, (s, P, rows) in enumerate(spectra):
            fs = sorted(glob.glob(f'{data}/Fig1/Fig1d_*ms_{P}.txt'), key=lambda f: int(os.path.basename(f).split('_')[1][:-2]))
            ax = axes[0, col]
            for j, f in enumerate(fs):
                k, n, sg = np.loadtxt(f, skiprows=1).T
                N = 4 * np.pi * k ** 2 * np.clip(n, 1e-30, None); c = cm(j / max(1, len(fs) - 1))
                kp, lo, hi, co = wide_fit(k, N)
                ax.errorbar(k, N / N.max(), 4 * np.pi * k ** 2 * sg / N.max(), fmt='o-', ms=2.5, lw=0.8, color=c, elinewidth=0.6,
                            capsize=0, label=f't − t* = {os.path.basename(f).split("_")[1]}')
                kk = np.exp(np.linspace(np.log(k[lo]), np.log(k[hi]), 80))
                ax.plot(kk, np.exp(np.polyval(co, np.log(kk))) / N.max(), 'k-', lw=0.7)
                ax.axvline(kp, color=c, lw=1.0)
                arrays[f'{P}__{j:02d}_k_um_inv'] = k; arrays[f'{P}__{j:02d}_Nk_over_max'] = N / N.max(); arrays[f'{P}__{j:02d}_kp'] = kp
            ax.set_xlim(0, 0.6); ax.set_ylim(0, 1.3); ax.set_xlabel(r'$k$ (µm$^{-1}$)'); ax.set_ylabel(r'$N_k/\max N_k$')
            ax.set_title(f'measured, series {s} ({P}, 100 ' + r'$a_0$)'); ax.legend(fontsize=7, frameon=False, ncol=2)
            ax = axes[1, col]
            ax.errorbar((rows[:, 0]) * 1e3, rows[:, 1] * rows[:, 3], rows[:, 2] * rows[:, 3], fmt='D', ms=4, color='#8e2c2c',
                        mfc='#f0d0d0', capsize=0, elinewidth=0.8)
            ax.axhline(c_exp, color='0.45', lw=0.8); ax.annotate(f'c = {c_exp:.2f}', (rows[0, 0] * 1e3, c_exp), xytext=(2, 4),
                                                                 textcoords='offset points', fontsize=9, color='0.3')
            ax.set_ylim(0, 4.5); ax.set_xlabel('t (ms)'); ax.set_ylabel(r'$k_p\,\ell$')
            ax.set_title(r'$k_p\,\ell$, $\ell$ from the series at the same $t$ (bars: window max/2 against 0.7 max)')
            arrays.update({f'{P}__t_s': rows[:, 0], f'{P}__kp_ell': rows[:, 1] * rows[:, 3], f'{P}__kp_ell_err': rows[:, 2] * rows[:, 3]})
        fig.suptitle('k_p extraction on the measured N_k = 4πk² n_k (lin-lin): thin black the fitted parabola, vertical lines k_p', fontsize=10)
        save(fig, study_dir, 'kp_extraction_experiment', arrays)


if __name__ == '__main__':
    args = [a for i, a in enumerate(sys.argv[2:], 2) if not a.startswith('--') and sys.argv[i - 1] != '--experiment']
    make(sys.argv[1].rstrip('/'), args or ['s01', 's05', 's12'])
    data = sys.argv[sys.argv.index('--experiment') + 1] if '--experiment' in sys.argv else os.environ.get('WKE_EXPERIMENT_DATA')
    if data:
        make_experiment(sys.argv[1].rstrip('/'), data)

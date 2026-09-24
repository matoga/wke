import sys, os, json, glob
sys.path.insert(0, 'analysis/plots')
import warnings
import numpy as np, matplotlib
warnings.simplefilter('ignore', np.exceptions.RankWarning)
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import bidir_fit as B
from common import save, face, A_SCALE
D = os.environ['WKE_BIDIR_DATA']
study = 'analysis/results/2026-09-24_bidir-chain-series1-own-state-standard'

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kE2 import kE_mid


def kE(c):
    """Peak of E_k: parabola over the points with E_k ≥ 0.6 of the maximum, weighted by 1/σ for measured spectra."""
    return kE_mid(c)[0]


runs = sorted((json.load(open(f)) for f in glob.glob(study + '/runs/*.json')), key=lambda r: r['settings']['a_a0'])
data = sorted([c for c in B.load_series(D, 1) if c['a'] == 300], key=lambda c: c['t'])
# one colour scale over every a, model and measured
avals = sorted({r['settings']['a_a0'] for r in runs} | {150, 300, 600})
col = {a: A_SCALE(i / (len(avals) - 1)) for i, a in enumerate(avals)}
# panels left to right: t, t ā, t ā² (clock exponent p = 0, 1, 2)
P = (0, 1, 2)
fig, axes = plt.subplots(1, 3, figsize=(12.5, 4.4), sharey=True)
arrays = {}
TMAX = 330  # the data at 300 a₀ have ā = 1, so t ā² = t
for r in runs:
    a = r['settings']['a_a0']
    cs = B.run_curves(r)
    t, k = np.array([c['t'] for c in cs]), np.array([kE(c) for c in cs])
    arrays[f'wke_{a:g}a0__t_ms'], arrays[f'wke_{a:g}a0__kE'] = t, k
    for ax, p in zip(axes, P):
        ax.plot(t * (a / 300) ** p, k, color=col[a], lw=1.4, ls='--', label=f'large-N, a = {a:g} a₀')
rng = np.random.default_rng(5)
DCOL = {150: '#1b9e77', 300: '0.1', 600: '#c0392b'}
for ad in (150, 300, 600):
    cs = sorted([c for c in B.load_series(D, 1) if c['a'] == ad and min(c['t'] * (ad / 300) ** p for p in P) <= TMAX], key=lambda c: c['t'])
    t = np.array([c['t'] for c in cs])
    k = np.array([kE(c) for c in cs])
    # uncertainty: n_k resampled within its error bars, 300 times
    draws = np.array([[kE(dict(c, n=c['n'] + rng.standard_normal(len(c['n'])) * c['err'])) for c in cs] for _ in range(300)])
    # robust spread (1.4826 × median absolute deviation)
    # resamples whose parabola opens upwards give nan and are left out
    mad = lambda d: 1.4826 * np.nanmedian(np.abs(d - np.nanmedian(d, axis=0)), axis=0)
    ke, k6e = mad(draws), mad(draws ** 6)
    arrays[f'data_{ad}a0__t_ms'], arrays[f'data_{ad}a0__kE'], arrays[f'data_{ad}a0__kE_err'], arrays[f'data_{ad}a0__kE6_err'] = t, k, ke, k6e
    for ax, p in zip(axes, P):
        ax.errorbar(t * (ad / 300) ** p, k, ke, marker='o', ms=6, ls='-', lw=1.4, color=col[ad], mfc='white', elinewidth=0.9, capsize=0,
                    label=f'measured, a = {ad} a₀ (series 1)')
    print(ad, ' '.join(f'{tt:g}ms:{kk:.2f}±{ee:.2f}' for tt, kk, ee in zip(t, k, ke)))
axes[0].set(xlabel='t (ms)', ylabel='k_E = argmax E_k (µm⁻¹)', xlim=(0, TMAX), title='no rescaling: t')
axes[1].set(xlabel='t ā (ms), ā = a/300 a₀', xlim=(0, TMAX), title='t ā (p = 1)')
axes[2].set(xlabel='t ā² (ms), ā = a/300 a₀', xlim=(0, TMAX), title='kinetic clock: t ā² (p = 2)')
h, l = axes[0].get_legend_handles_labels()
fig.legend(h, l, frameon=False, fontsize=8, loc='upper left', bbox_to_anchor=(1.0, 0.9))
fig.suptitle('Energy peak k_E against t ā^p: large-N from each a\'s own measured t = 0 state (dashed) and measured (solid)', y=1.0)
fig.tight_layout()
save(fig, study, 'bidir_kE_three_clocks', arrays)


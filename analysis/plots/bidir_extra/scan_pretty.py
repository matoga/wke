import sys, os
sys.path.insert(0, 'analysis/plots')
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm
from matplotlib.ticker import FixedLocator, FuncFormatter, MultipleLocator
from common import save
plt.rcParams.update({'font.family': 'serif', 'font.serif': ['Times New Roman', 'Times', 'DejaVu Serif'],
                     'mathtext.fontset': 'stix', 'font.size': 11, 'axes.titlesize': 11})
OUT = 'analysis/results/2026-09-24_bidir-chain-uv-standard'
z = np.load(f'{OUT}/plots/bidir_scan_p_dt_adaptive_dt20.npz')
keep = z['dt'] <= 18
P, DT, C = z['p'], z['dt'][keep], z['cost_measured'][keep]
R = C / np.nanmin(C)                      # relative to the best point over the whole map
bestp = np.array([P[np.nanargmin(r)] for r in C])

fig, ax = plt.subplots(figsize=(6.0, 4.5))
im = ax.pcolormesh(DT, P, R.T, shading='nearest', cmap='RdBu_r', norm=LogNorm(vmin=1, vmax=10))
cb = fig.colorbar(im, ax=ax, pad=0.02, extend='max')
cb.set_ticks(FixedLocator([1, 2, 5, 10]))
cb.ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f'{v:g}'))
cb.ax.yaxis.set_minor_formatter(FuncFormatter(lambda v, _: ''))
cb.set_label('mismatch / best mismatch')
ax.plot(DT, bestp, color='k', lw=1.4, marker='o', ms=3.5)
for y, name, va, dy in ((1.1, r'published $p = 1.1$', 'top', -0.05), (2.0, r'kinetic $p = 2$', 'bottom', 0.05)):
    ax.axhline(y, color='k', lw=0.8, ls='--')
    ax.text(0.3, y + dy, name, va=va, fontsize=9)
ax.set(xlabel=r'coil lag $\delta t$ (ms)', ylabel=r'clock exponent $p$', xlim=(-0.5, 18.5), ylim=(-0.05, 3.05))
ax.xaxis.set_major_locator(MultipleLocator(3))
ax.yaxis.set_major_locator(MultipleLocator(0.5))
ax.set_title(r'Measured $E_k$ at 150, 300, 600 $a_0$ compared at equal $(t-\delta t)\,(a/300\,a_0)^{p}$')
fig.tight_layout()
save(fig, OUT, 'bidir_coil_lag_scan', dict(p=P, coil_lag_ms=DT, mismatch=C, mismatch_rel=R, best_p_per_lag=bestp))

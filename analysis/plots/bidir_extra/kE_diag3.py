import sys, os
sys.path.insert(0, 'analysis/plots'); sys.path.insert(0, os.path.dirname(__file__))
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import bidir_fit as B
from kE2 import kE_mid, kE_mean
from common import save
D = os.environ['WKE_BIDIR_DATA']
A0 = float(sys.argv[1]) if len(sys.argv) > 1 else 300.0
cs = sorted([c for c in B.load_series(D, 1) if c['a'] == A0 and c['t'] <= 320], key=lambda c: c['t'])
fig, axes = plt.subplots(2, 4, figsize=(13, 6), sharex=True, sharey=True)
arrays = {}
for ax, c in zip(axes.flat, cs):
    k, E, s = c['k'], B.Ek_nK_um(c) / 1e3, B.Ek_nK_um(dict(k=c['k'], n=c['err'])) / 1e3
    ax.errorbar(k, E, s, marker='o', ms=3.5, ls='-', lw=0.6, color='0.55', mfc='white', elinewidth=0.7, capsize=0)
    kf, near, A, sel = kE_mid(c)
    km = kE_mean(c)
    ks, Es = k[sel], E[sel]
    ax.plot(ks[near], Es[near], 'o', ms=5, color='#7b3fa0')
    kk = np.linspace(ks[near].min(), ks[near].max(), 80)
    ax.plot(kk, np.polyval(A, kk) / 1e3, color='#c0392b', lw=1.4)
    ax.axvline(kf, color='#c0392b', lw=0.9, ls=':')
    ax.set_title(f't = {c["t"]:g} ms: k_E = {kf:.2f} µm⁻¹ ({near.sum()} pts)', fontsize=8)
    arrays[f't{c["t"]:g}ms__k'], arrays[f't{c["t"]:g}ms__Ek'] = k, E
    arrays[f't{c["t"]:g}ms__kE_fit'], arrays[f't{c["t"]:g}ms__kE_mean'] = kf, km
for ax in axes[1]:
    ax.set_xlabel('k (µm⁻¹)')
for ax in axes[:, 0]:
    ax.set_ylabel('E_k / k_B (10³ nK µm)')
axes[0, 0].set_xlim(0, 4.6)
axes[0, 0].set_ylim(bottom=0)
fig.suptitle(f'{A0:g} a₀ (series 1): violet = points in the fit (E_k ≥ 0.6 max), red = parabola in E_k weighted by 1/σ (dotted: its peak)', y=1.0)
fig.tight_layout()
save(fig, 'analysis/results/2026-09-24_bidir-chain-uv-standard', f'bidir_kE_extraction3_{A0:g}a0', arrays)

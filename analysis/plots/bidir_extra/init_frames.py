import sys, os, json
sys.path.insert(0, 'analysis/plots')
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import bidir_fit as B
from common import save
D = os.environ['WKE_BIDIR_DATA']
OWN = 'analysis/results/2026-09-24_bidir-chain-series1-own-state-standard'
fig, axes = plt.subplots(2, 3, figsize=(12, 7), sharex='row', sharey='row')
arrays = {}
for j, a in enumerate((150, 300, 600)):
    # snapshot 0 of the run from this a's own state is the state the solver starts from
    r = json.load(open(f'{OWN}/runs/measured_d{a}_{a}a0_chain.json'))
    m = B.run_curves(r)[0]
    d = [c for c in B.load_series(D, 1) if c['a'] == a and c['t'] == 0][0]
    old = json.load(open('analysis/results/2026-09-24_bidir-chain-series1-standard/runs/measured_d_%da0_chain.json' % a))
    o = B.run_curves(old)[0]
    for i, (fn, scale, lab) in enumerate(((B.Ek_nK_um, 1e3, 'E_k / k_B (10³ nK µm)'), (lambda c: c['n'], 1, 'n_k (µm³)'))):
        ax = axes[i, j]
        ed = B.Ek_nK_um(dict(k=d['k'], n=d['err'])) if i == 0 else d['err']
        ax.errorbar(d['k'], fn(d) / scale, ed / scale, fmt='o', color='0.15', mfc='white', ms=5, elinewidth=0.8, capsize=0, label='measured, t = 0')
        s = m['k'] <= 5.5
        ax.plot(m['k'][s], fn(m)[s] / scale, color='#c0392b', lw=1.8, label='new initial state (this a, smoothed)')
        ax.plot(o['k'][s], fn(o)[s] / scale, color='0.6', lw=1.0, ls='--', label='previous initial state (average of ten)')
        arrays[f'{a}a0__k'], arrays[f'{a}a0__{"Ek" if i == 0 else "nk"}'] = m['k'][s], fn(m)[s]
        if i == 1:
            ax.set(yscale='log', ylim=(0.1, 1e5), xlabel='k (µm⁻¹)')
        else:
            ax.set(title=f'a = {a} a₀: E/N = {r["initial"]["EN_nK"]:.1f} nK, n = {r["settings"]["density_um3"]:.3f} µm⁻³')
        if j == 0:
            ax.set_ylabel(lab)
axes[0, 0].set(xlim=(0, 5.5), ylim=(0, None))
axes[0, 0].legend(frameon=False, fontsize=8)
fig.suptitle('Initial frame of the large-N runs: the t = 0 spectrum measured with each a, as the solver starts from it', y=1.0)
fig.tight_layout()
save(fig, OWN, 'bidir_initial_frames_per_a', arrays)

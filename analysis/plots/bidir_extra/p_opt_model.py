"""Optimal clock exponent p (δt = 0) from the E_k mismatch between values of a, for large-N and the data."""
import sys, os, json, glob
sys.path.insert(0, 'analysis/plots')
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import MultipleLocator
import bidir_fit as B
from common import save, A_SCALE
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kE2 import kE_mid
plt.rcParams.update({'font.family': 'serif', 'font.serif': ['Times New Roman', 'Times', 'DejaVu Serif'],
                     'mathtext.fontset': 'stix', 'font.size': 11, 'axes.titlesize': 11})
D = os.environ['WKE_BIDIR_DATA']
OUT = 'analysis/results/2026-09-24_bidir-chain-series1-own-state-standard'
P = np.linspace(0, 3, 121)
KG = np.linspace(1.0, 4.0, 25)
TAU_BOUNDS = (10.0, 320.0)

def table(curves, rng=None):
    cs = sorted([c for c in curves if c['t'] > 0], key=lambda c: c['t'])
    E, S = [], []
    for c in cs:
        n = c['n'] if (rng is None or c['err'] is None) else c['n'] + rng.standard_normal(len(c['n'])) * c['err']
        E.append(np.interp(KG, c['k'], B.Ek_nK_um(dict(k=c['k'], n=n))))
        S.append(np.interp(KG, c['k'], B.Ek_nK_um(dict(k=c['k'], n=c['err']))) if c['err'] is not None else np.ones_like(KG))
    return np.array([c['t'] for c in cs]), np.array(E), np.array(S)

def cost(tabs, p):
    """Mean over τ (the overlap of all a within 10 to 320 ms, at least a factor 4) and k ∈ [1, 4] µm⁻¹ of the
    variance of E_k between the a at equal τ = t ā^p, over the mean squared error (1 for the model)."""
    lo = max(TAU_BOUNDS[0], max(t[0] * (a / 300) ** p for a, (t, _, _) in tabs.items()))
    hi = min(TAU_BOUNDS[1], min(t[-1] * (a / 300) ** p for a, (t, _, _) in tabs.items()))
    if hi < 4 * lo:
        return np.nan
    vals = []
    for tau in np.geomspace(lo, hi, 9):
        Es, Ss = [], []
        for a, (t, E, S) in tabs.items():
            tt = tau * (a / 300) ** (-p)
            j = int(np.clip(np.searchsorted(t, tt) - 1, 0, len(t) - 2))
            w = np.clip((np.log(tt) - np.log(t[j])) / (np.log(t[j + 1]) - np.log(t[j])), 0, 1)
            Es.append((1 - w) * E[j] + w * E[j + 1]); Ss.append((1 - w) * S[j] ** 2 + w * S[j + 1] ** 2)
        vals.append(np.var(Es, axis=0, ddof=1) / np.mean(Ss, axis=0))
    return float(np.mean(vals))

def best(tabs):
    c = np.array([cost(tabs, p) for p in P])
    return P[np.nanargmin(c)], c

runs = {json.load(open(f))['settings']['a_a0']: json.load(open(f)) for f in glob.glob(OUT + '/runs/*.json')}
model = {a: table(B.run_curves(r)) for a, r in runs.items()}
data_c = {a: [c for c in B.load_series(D, 1) if c['a'] == a] for a in (150.0, 300.0, 600.0)}
data = {a: table(cs) for a, cs in data_c.items()}
rng = np.random.default_rng(11)
sets = {'150–300': (150.0, 300.0), '300–600': (300.0, 600.0), 'all three': (150.0, 300.0, 600.0)}
res = {}
for name, aa in sets.items():
    pm, cm = best({a: model[a] for a in aa})
    pd, cd = best({a: data[a] for a in aa})
    boot = [best({a: table(data_c[a], rng) for a in aa})[0] for _ in range(60)]
    res[name] = dict(pm=pm, cm=cm, pd=pd, cd=cd, pd_err=np.std(boot))
    print(f'{name}: large-N p = {pm:.2f}; measured p = {pd:.2f} ± {np.std(boot):.2f}')

# layout: the energy-peak panel large on the left; the mismatch curve and the optimal p by pair stacked on the right
fig = plt.figure(figsize=(9.5, 5.6))
gs = fig.add_gridspec(2, 2, width_ratios=[1.3, 1])
# colours of a (as in the left panel); a pair gets the colour midway between its two a, all three black
col = {150.0: A_SCALE(0.0), 300.0: A_SCALE(0.5), 600.0: A_SCALE(1.0)}
pair_col = {'150–300': A_SCALE(0.25), '300–600': A_SCALE(0.75), 'all three': '0.1'}
axes = [fig.add_subplot(gs[0, 1]), fig.add_subplot(gs[1, 1]), fig.add_subplot(gs[:, 0])]
ax = axes[0]
r = res['all three']
for name in sets:
    rr = res[name]
    ax.plot(P, rr['cm'] / np.nanmin(rr['cm']), color=pair_col[name], lw=1.4, ls='--')
    ax.plot(P, rr['cd'] / np.nanmin(rr['cd']), color=pair_col[name], lw=1.4, ls='-')
ax.plot([], [], color='0.3', ls='--', label='large-N')
ax.plot([], [], color='0.3', ls='-', label='measured')
ax.set(yscale='log', xlabel=r'clock exponent $p$', ylabel='mismatch / best', xlim=(0, 3), ylim=(0.9, None),
       title=r'mismatch against $p$ ($\delta t = 0$)')
ax.xaxis.set_major_locator(MultipleLocator(0.5))
ax.legend(frameon=False, fontsize=9)
ax = axes[1]
x = np.arange(len(sets))
for i, n in enumerate(sets):
    ax.plot(i - 0.1, res[n]['pm'], 's', color=pair_col[n], ms=7)
    ax.errorbar(i + 0.1, res[n]['pd'], res[n]['pd_err'], fmt='o', color=pair_col[n], ms=7, mfc='white', mew=1.4,
                elinewidth=1.2, capsize=0)
ax.plot([], [], 's', color='0.3', label='large-N')
ax.plot([], [], 'o', color='0.3', mfc='white', label='measured')
for y, name in ((1, r'$p = 1$'), (2, r'kinetic $p = 2$')):
    ax.axhline(y, color='0.5', lw=0.8, ls='--')
    ax.text(len(sets) - 0.55, y + 0.04, name, fontsize=9, ha='right')
ax.set(xticks=x, xticklabels=[f'{n} $a_0$' if n != 'all three' else n for n in sets], ylabel=r'optimal $p$', ylim=(0.5, 2.5),
       xlim=(-0.5, len(sets) - 0.5), title='optimal $p$ by pair of $a$')
ax.yaxis.set_major_locator(MultipleLocator(0.5))
ax.legend(frameon=False, loc='upper left', fontsize=9)
# third panel: the energy peak against the large-N optimal clock
ax = axes[2]
POPT = res['all three']['pm']
k_arrays = {}
for a, r in sorted(runs.items()):
    cs = B.run_curves(r)
    t = np.array([c['t'] for c in cs]); k = np.array([kE_mid(c)[0] for c in cs])
    ax.plot(t * (a / 300) ** POPT, k, color=col[a], lw=1.4, ls='--', label=f'large-N, {a:g} $a_0$')
    k_arrays[f'largeN_{a:g}a0__t_ms'], k_arrays[f'largeN_{a:g}a0__kE'] = t, k
rng2 = np.random.default_rng(5)
mad = lambda d: 1.4826 * np.nanmedian(np.abs(d - np.nanmedian(d, axis=0)), axis=0)
for a, cs in data_c.items():
    cs = sorted([c for c in cs if c['t'] * (a / 300) ** POPT <= 330], key=lambda c: c['t'])
    t = np.array([c['t'] for c in cs]); k = np.array([kE_mid(c)[0] for c in cs])
    draws = np.array([[kE_mid(dict(c, n=c['n'] + rng2.standard_normal(len(c['n'])) * c['err']))[0] for c in cs] for _ in range(300)])
    ax.errorbar(t * (a / 300) ** POPT, k, mad(draws), marker='o', ms=6, ls='-', lw=1.4, color=col[a], mfc='white',
                elinewidth=0.9, capsize=0, label=f'measured, {a:g} $a_0$')
    k_arrays[f'measured_{a:g}a0__t_ms'], k_arrays[f'measured_{a:g}a0__kE'] = t, k
ax.set(xlabel=rf'$t\,(a/300\,a_0)^{{{POPT:.1f}}}$ (ms)', ylabel=r'$k_E$, peak of $E_k$ ($\mu$m$^{-1}$)', xlim=(0, 330),
       title=rf'energy peak at the large-N optimum $p = {POPT:.1f}$')
ax.legend(frameon=False, fontsize=8, loc='lower right')
fig.suptitle(r'Clock exponent from the $E_k$ mismatch at equal $t\,(a/300\,a_0)^{p}$'+'\n'+r'large-N (each run from the $t = 0$ state measured at its $a$) and measured', y=1.0)
fig.tight_layout()
save(fig, OUT, 'bidir_p_optimal', {**{f'{n}__p_largeN': res[n]['pm'] for n in sets}, **{f'{n}__p_measured': [res[n]['pd'], res[n]['pd_err']] for n in sets},
                                   **k_arrays, 'p': P, 'cost_largeN_all': res['all three']['cm'], 'cost_measured_all': res['all three']['cd']})

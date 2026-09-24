"""Shared loading and house style for analysis figures.

House style:
  - marker = initial state (ordered by E/N), colour = scattering length a (one ordered scale),
    hollow-looking points: coloured border, light fill of the same hue, error bars without caps;
  - guide lines thin, grey, solid, named on the plot; runs never drawn as grey lines;
  - legends outside the axes: runs (marker, colour) above, guides below;
  - every figure is written as <name>.pdf with <name>.npz beside it holding the plotted arrays.
"""
import json
import glob
import os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, to_rgba

A_SCALE = LinearSegmentedColormap.from_list('a_scale', ['#1b9e77', '#3b6fb6', '#7b3fa0', '#c0392b'])
MARKERS = ['o', 's', '^', 'D', 'v', 'P']
GUIDE = dict(color='0.45', ls='-', lw=0.8, zorder=1)
LABEL = dict(textcoords='offset points', fontsize=8, color='0.3')
plt.rcParams.update({'font.size': 9, 'axes.titlesize': 9, 'pdf.fonttype': 42})


def load_study(study_dir):
    """Study definition (may be absent for migrated legacy studies) and its runs, sorted by E/N then a."""
    path = os.path.join(study_dir, 'study.json')
    study = json.load(open(path)) if os.path.exists(path) else {}
    runs = [json.load(open(f)) for f in glob.glob(os.path.join(study_dir, 'runs', '*.json'))]
    runs.sort(key=lambda r: (r['initial']['EN_nK'], r['settings']['a_a0']))
    return study, runs


HBAR_JS = 1.054571817e-34
KB_JK = 1.380649e-23


def _g(s, z, terms=100000):
    """Bose function g_s(z) = Σ z^j / j^s, z ≤ 1 (tail of ζ(s) added at z = 1)."""
    j = np.arange(1, terms + 1, dtype=float)
    if z < 1:
        return float(np.sum(z ** j / j ** s))
    return float(np.sum(1 / j ** s)) + terms ** (1 - s) / (s - 1)


def eta_eq(r):
    """Condensed fraction of the ideal Bose gas at the run's density and initial kinetic energy per atom,
    the equilibrium of the WKE with the +1 terms: E/N = (3/2) k_B T ζ(5/2)/(n λ_T³), η = 1 − ζ(3/2)/(n λ_T³);
    0 above T_c."""
    n = r['settings']['density_um3'] * 1e18
    hbar_over_m = r['scales']['hbarOverM_um2_per_s'] * 1e-12
    E = r['initial']['EN_nK'] * 1e-9 * KB_JK
    z32, z52 = _g(1.5, 1), _g(2.5, 1)
    # n λ_T³ with λ_T = √(2πħ²/(m k_B T)) = √(2π ħ (ħ/m) / (k_B T))
    nl3 = lambda T: n * (2 * np.pi * HBAR_JS * hbar_over_m / (KB_JK * T)) ** 1.5
    lo, hi = 1e-12, 1e-3
    for _ in range(200):
        T = np.sqrt(lo * hi)
        lo, hi = (T, hi) if 1.5 * KB_JK * T * z52 / nl3(T) < E else (lo, T)
    return max(0.0, 1 - z32 / nl3(T))


def ell_norm(r):
    """Normalisation of ℓ³ = f(k→0)/(η n): η = η_eq for the Bose +1 kernel, 1 for classical runs
    (whose Rayleigh-Jeans equilibrium depends on the grid cutoff)."""
    return eta_eq(r) if r['settings'].get('kernel') == 'quantum' else 1.0


def ell_symbol(runs):
    """How to write the coherence length of a set of runs: ℓ when normalised by η_eq (Bose +1 runs),
    ℓ̄ when η = 1 (classical runs, or run.ts's raw values). Returns (TeX, text, npz key stem).
    Mixed sets are refused so that the two are never drawn under one name."""
    kinds = {ell_norm(r) != 1.0 for r in runs}
    if len(kinds) > 1:
        raise ValueError('runs mix ℓ (η_eq-normalised) and ℓ̄ (η = 1); plot them separately')
    return (r'\ell', 'ℓ', 'ell') if kinds == {True} else (r'\bar{\ell}', 'ℓ̄', 'ellbar')


def run_id(r):
    s = r['settings']
    return f"{s['state']}_{s['a_a0']:g}a0_{s['model']}"


class Style:
    def __init__(self, runs):
        names = []
        for r in runs:
            n = r['settings']['stateName']
            if n not in names:
                names.append(n)
        self.states = names
        self.EN = {r['settings']['stateName']: r['initial']['EN_nK'] for r in runs}
        self.avals = sorted({r['settings']['a_a0'] for r in runs})
        self.marker = {s: MARKERS[i % len(MARKERS)] for i, s in enumerate(self.states)}
        self.colour = {a: to_rgba(A_SCALE(i / max(1, len(self.avals) - 1))) for i, a in enumerate(self.avals)}

    def of(self, r):
        return self.marker[r['settings']['stateName']], self.colour[r['settings']['a_a0']]


def face(c):
    """Light fill of the same hue."""
    return tuple(0.25 * np.array(c[:3]) + 0.75) + (1,)


def point_kw(marker, c, ms=3.6):
    return dict(ls='', marker=marker, ms=ms, mfc=face(c), mec=c, mew=0.9)


def legends(fig, style, guides, x0=0.745):
    from matplotlib.lines import Line2D
    h = [Line2D([], [], color='0.25', marker=style.marker[s], ms=6, mfc='white', mew=1.0, ls='',
                label=f'{s}, E/N = {style.EN[s]:.0f} nK') for s in style.states]
    fig.legend(handles=h, title='Marker: initial state', fontsize=8, title_fontsize=9, loc='upper left',
               bbox_to_anchor=(x0, 0.95), frameon=False)
    ha = [Line2D([], [], color=style.colour[a], marker='o', ms=6, mfc=face(style.colour[a]), mew=1.0, ls='',
                 label=f'a = {a:g} a₀') for a in style.avals]
    ha.append(Line2D([], [], color='0.2', marker='|', ms=8, ls='', label='bars: uncertainty'))
    fig.legend(handles=ha, title='Colour: scattering length', fontsize=8, title_fontsize=9, loc='upper left',
               bbox_to_anchor=(x0, 0.70), frameon=False)
    if guides:
        g = [Line2D([], [], lw=0.8, color='0.45', label=l) for l in guides]
        fig.legend(handles=g, title='Guides', fontsize=8, title_fontsize=9, loc='lower left',
                   bbox_to_anchor=(x0, 0.10), frameon=False)


def log_x(ax):
    ax.set_xscale('log')
    ax.xaxis.set_major_locator(matplotlib.ticker.LogLocator(base=10, subs=(1, 2, 5)))
    ax.xaxis.set_minor_formatter(matplotlib.ticker.NullFormatter())
    ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f'{v:g}'))


def save(fig, study_dir, name, arrays, title_note=''):
    """Write plots/<name>.pdf and plots/<name>.npz (the plotted arrays)."""
    out = os.path.join(study_dir, 'plots')
    os.makedirs(out, exist_ok=True)
    fig.savefig(os.path.join(out, f'{name}.pdf'), bbox_inches='tight')
    np.savez_compressed(os.path.join(out, f'{name}.npz'), **{k: np.asarray(v) for k, v in arrays.items()})
    plt.close(fig)
    print(f'  plots/{name}.pdf (+ .npz){title_note}')

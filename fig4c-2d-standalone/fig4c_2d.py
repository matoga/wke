"""2D Fig 4c analogue: (m/ħ) dℓ²/dt against (ℓ/ξ)², the WKE pooled over the measured series, with the published points.

usage: python3 fig4c_2d.py [out_dir] [--ytop Y] [--pdf path]
writes out_dir/fig4c.pdf, and the plotted arrays as out_dir/fig4c.npz (numpy) and out_dir/fig4c.wl (Wolfram Language,
an Association with the same keys; fig4c_wolfram.wl redraws the figure from it).

Steps:
  1. Each run gives ℓ̄² = f(k→0)/n₂ and (m/ħ) dℓ̄²/dt. There is no condensate rescaling in 2D.
  2. Each series is sampled at its own measured times; samples past the end of a run are dropped.
  3. The default bins span the 2D curve range, with each series contributing its mean rate over the covered part
     of a bin. Error bars show the spread between series. Bins with fewer than two series are dropped.
  4. The simulation has no box, so a run can pass ℓ̄² = A = V^(2/3), where the measured length saturates:
     filled points pool the samples inside that ceiling, open points all samples; curves turn dotted past it.
Guides: exponential growth ℓ² ∝ exp(t/τ), τ = 56 t_ξ, i.e. rate = (ℓ/ξ)²/56 (solid), and D = 3.4 ħ/m (dashed).
Series 8 and 10, the two low-N series, are left out (EXCLUDE).
"""
import glob
import json
import os
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm
from matplotlib.cm import ScalarMappable
from matplotlib.lines import Line2D

HERE = os.path.dirname(os.path.abspath(__file__))
HBAR, KB = 1.054571817e-34, 1.380649e-23
A0_UM = 5.29177210903e-5
ZETA32, ZETA52 = 2.6123753486854883, 1.3414872572509171
TAU_XI, D_GUIDE, XMAX, MIN_SAMPLES = 56, 3.4, 2100, 2
EXCLUDE = {8, 10}
EDGE, FILL = '#2b3f7f', '#c3cadb'
STYLE = {'font.family': 'serif', 'font.serif': ['Times New Roman', 'Times', 'DejaVu Serif'], 'mathtext.fontset': 'stix',
         'font.size': 11, 'axes.titlesize': 10, 'pdf.fonttype': 42}


def wl(v):
    """A number, array or nested list as Wolfram Language input (reals in *^ notation, NaN as Indeterminate)."""
    a = np.asarray(v)
    if a.ndim == 0:
        x = a.item()
        if isinstance(x, (bool, np.bool_)):
            return 'True' if x else 'False'
        if isinstance(x, (int, np.integer)):
            return str(int(x))
        if not np.isfinite(x):
            return 'Indeterminate'
        return repr(float(x)).replace('e', '*^')
    return '{' + ', '.join(wl(e) for e in a) + '}'


def write_wl(path, arrays, meta):
    """The plotted arrays as one Association, same keys as the .npz; load with Get[path]."""
    lines = [f'  "{k}" -> {wl(v)}' for k, v in arrays.items()]
    lines += [f'  "{k}" -> "{v}"' for k, v in meta.items()]
    with open(path, 'w') as fh:
        fh.write('(* 2D Fig 4c analogue: the plotted arrays (same keys as fig4c.npz). Load with data = Get["fig4c.wl"]. *)\n')
        fh.write('<|\n' + ',\n'.join(lines) + '\n|>\n')


def edges_from(centres):
    mid = 0.5 * (centres[1:] + centres[:-1])
    e = np.concatenate([[max(0.0, 2 * centres[0] - mid[0])], mid, [2 * centres[-1] - mid[-1]]])
    step = e[-1] - e[-2]
    return np.concatenate([e, e[-1] + step * np.arange(1, int((XMAX - e[-1]) / step) + 1)])


def binned(x, y, edges):
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (x >= lo) & (x < hi) & np.isfinite(y)
        if m.sum() >= MIN_SAMPLES:
            out.append((x[m].mean(), y[m].mean(), y[m].std(ddof=1) / np.sqrt(m.sum()), m.sum()))
    return np.array(out).reshape(-1, 4).T


def curve_binned(W, edges, inbox_only):
    """Equal-width bins over the curves: each series contributes the mean of its rate curve over the part of the bin it
    covers (at least half the bin; interpolated onto 50 points), and the point is the mean over the series, with their
    standard deviation as error (at least 2 series). inbox_only cuts every curve at its box ceiling."""
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        vals = []
        for d in W.values():
            o = np.argsort(d['x']); x, r = d['x'][o], d['rate'][o]
            a, b = max(lo, x[0]), min(hi, x[-1], d['ceil'] if inbox_only else np.inf)
            if b - a >= 0.5 * (hi - lo):
                vals.append(np.interp(np.linspace(a, b, 50), x, r).mean())
        if len(vals) >= 2:
            out.append((0.5 * (lo + hi), np.mean(vals), np.std(vals, ddof=1), len(vals)))
    return np.array(out).reshape(-1, 4).T


def main(out_dir, ytop=None, pdf=None, equal=None, sqrt_step=None):
    data = json.load(open(os.path.join(HERE, 'data', 'fig4c_data.json')))
    series = {s['series']: s for s in data['series']}
    pub = data['fig4c_published']
    px, py, pe = (np.array(pub[k]) for k in ('ell_over_xi_sq', 'rate', 'rate_err'))
    runs = {}
    for f in sorted(glob.glob(os.path.join(out_dir, 'runs', 's*.json'))):
        r = json.load(open(f))
        if r['settings']['series'] not in EXCLUDE:
            runs[r['settings']['series']] = r
    if not runs:
        sys.exit(f'no runs in {out_dir}/runs')
    kernels = {r['settings']['kernel'] for r in runs.values()}
    if len(kernels) > 1:
        sys.exit('runs mix the quantum and classical kernels; plot them separately')
    quantum = kernels == {'quantum'}
    L, Ltxt = r'\bar{\ell}', 'ℓ̄'

    arrays, xs, ys, inbox, W = {}, [], [], [], {}
    for s, r in sorted(runs.items()):
        p, sc, se = r['points'], r['scales'], series[s]
        t = np.array(p['t_s'])
        ell2 = np.array(p['ell_um']) ** 2
        rate = np.array(p['ellRate'])
        x = ell2 / sc['xi_um'] ** 2
        na = r['settings']['density_um2'] * se['a_a0'] * A0_UM
        ceil = se['V_um3'] ** (2 / 3) / sc['xi_um'] ** 2
        ok = np.isfinite(rate)
        tm = np.array(se['measured_t_s'])
        if not np.any(ok):
            continue
        tm = tm[(tm >= t[ok][0]) & (tm <= t[ok][-1])]
        xm, ym = np.interp(tm, t[ok], x[ok]), np.interp(tm, t[ok], rate[ok])
        xs.append(xm); ys.append(ym); inbox.append(xm <= ceil)
        W[s] = dict(x=x[ok], rate=rate[ok], na=na, ceil=ceil)
        arrays.update({f's{s:02d}__ell_over_xi_sq': x[ok], f's{s:02d}__rate': rate[ok], f's{s:02d}__samples_ell_over_xi_sq': xm,
                       f's{s:02d}__samples_rate': ym, f's{s:02d}__box_ceiling_ell_over_xi_sq': ceil,
                       f's{s:02d}__na_um2': na})
    if not xs:
        sys.exit('no finite run points')
    xs, ys, inbox = np.concatenate(xs), np.concatenate(ys), np.concatenate(inbox)
    if equal or sqrt_step:
        # bins over the curves (equal width, or equal steps in √x: denser early, wider late, like the published
        # bins); errors are the spread between the series
        edges = (np.arange(0, np.sqrt(XMAX) + sqrt_step, sqrt_step) ** 2 if sqrt_step else np.arange(0, XMAX + equal, equal))
        bx, by, be, bn = curve_binned(W, edges, True)
        ax_, ay_, ae_, an_ = curve_binned(W, edges, False)
    else:
        x2max = max(float(np.max(d['x'])) for d in W.values())
        edges = np.linspace(0, 1.05 * x2max, 25)
        bx, by, be, bn = curve_binned(W, edges, True)
        ax_, ay_, ae_, an_ = curve_binned(W, edges, False)
    gx = np.array([0, XMAX])
    arrays.update({'wke__ell_over_xi_sq': bx, 'wke__rate': by, 'wke__rate_err': be, 'wke__n_samples': bn,
                   'wke_all__ell_over_xi_sq': ax_, 'wke_all__rate': ay_, 'wke_all__rate_err': ae_, 'wke_all__n_samples': an_,
                   'bin_edges': edges, 'exp__ell_over_xi_sq': px, 'exp__rate': py, 'exp__rate_err': pe,
                   'guide__exponential_x': gx, 'guide__exponential_rate': gx / TAU_XI, 'guide__D': D_GUIDE})

    suffix = '_sqrt' if sqrt_step else '_equal' if equal else ''
    s0 = next(iter(runs.values()))['settings']
    capped = sum(r['status'] == 'wall-cap' for r in runs.values())
    ytop = ytop or 1.2 * max(float(np.max(by)), 0.1)
    NA = LogNorm(min(d['na'] for d in W.values()) * 0.9, max(d['na'] for d in W.values()) * 1.1)
    cmap = plt.get_cmap('viridis')
    with plt.rc_context(STYLE):
        fig, ax = plt.subplots(figsize=(6.8, 4.6), constrained_layout=True)
        ax.plot(bx, by, 'o', ms=5, color=EDGE, mfc=FILL,
                mec=EDGE, mew=1, zorder=3)
        xlim = 1.08 * max(float(np.max(d['x'])) for d in W.values())
        ax.set_xlim(0, xlim)
        ax.set_ylim(0, ytop)
        ax.set_xlabel(rf'$({L}/\xi)^2$')
        ax.set_ylabel(rf'$\dfrac{{m}}{{\hbar}}\,\dfrac{{\mathrm{{d}}{L}^2}}{{\mathrm{{d}}t}}$', fontsize=13)
        ax.set_title(f'2D WKE · {len(W)} series', loc='left')
        ax.grid(alpha=.15, lw=.5)
        ax.text(.98, .97, 'Pooled means; between-series SD in data file',
                transform=ax.transAxes, ha='right', va='top', fontsize=8, color='.35')
        fig.savefig(pdf or os.path.join(out_dir, f'fig4c{suffix}.pdf'), bbox_inches='tight')
    np.savez_compressed(os.path.join(out_dir, f'fig4c{suffix}.npz'), **{k: np.asarray(v) for k, v in arrays.items()})
    write_wl(os.path.join(out_dir, f'fig4c{suffix}.wl'), arrays,
             {'kernel': s0['kernel'], 'accuracy': s0['accuracy'], 'length': 'ellbar'})
    print(f'{pdf or os.path.join(out_dir, "fig4c" + suffix + ".pdf")} (+ .npz, .wl): {len(W)} series, kernel {s0["kernel"]}, {s0["accuracy"]}; {Ltxt} normalised '
          f'without condensate rescaling')


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description='2D Fig 4c analogue from out_dir/runs')
    ap.add_argument('out_dir', nargs='?', default=os.path.join(HERE, 'out'))
    ap.add_argument('--ytop', type=float, help='top of the y axis (default: from the data)')
    ap.add_argument('--pdf', help='write the figure here instead of out_dir/fig4c.pdf')
    ap.add_argument('--equal', type=float, metavar='W', help='equal-width bins of W over the curves, errors = std between '
                    'series; writes fig4c_equal.pdf, .npz, .wl')
    ap.add_argument('--sqrt', type=float, metavar='D', help='like --equal, but bins of equal step D in sqrt((l/xi)^2), '
                    'denser at small (l/xi)^2; writes fig4c_sqrt.pdf, .npz, .wl')
    a = ap.parse_args()
    main(a.out_dir, a.ytop, a.pdf, a.equal, a.sqrt)

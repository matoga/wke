"""Fig 4c analogue: (m/ħ) dℓ²/dt against (ℓ/ξ)², the WKE pooled over the measured series, with the published points.

usage: python3 fig4c.py [out_dir] [--ytop Y] [--pdf path]   (default out; reads out_dir/runs/s*.json and data/fig4c_data.json)
writes out_dir/fig4c.pdf, and the plotted arrays as out_dir/fig4c.npz (numpy) and out_dir/fig4c.wl (Wolfram Language,
an Association with the same keys; fig4c_wolfram.wl redraws the figure from it).

Steps:
  1. Each run gives ℓ̄³ = f(k→0)/n and (m/ħ) dℓ̄²/dt. With the Bose +1 terms the gas condenses, so the coherence length
     is ℓ³ = f(k→0)/(η_eq n), with η_eq the condensed fraction of the ideal Bose gas at the run's n and E/N, which makes
     ℓ³ = V in equilibrium: ℓ² = ℓ̄² η_eq^(−2/3), and likewise the rate. Classical runs keep η = 1 and are labelled ℓ̄.
  2. Each series is sampled at its own measured times (the clocks start when a is switched on), so the pooling
     weights series and stages as the measurement does; samples past the end of a run are dropped.
  3. The pooled samples are binned with edges halfway between the published (ℓ/ξ)² values (outer edges mirrored),
     continued at the last published spacing up to XMAX; a point is the mean of x and of the rate in its bin, its
     error the standard error of the mean, and bins with fewer than 2 samples are dropped.
  4. The simulation has no box, so a run can pass ℓ³ = V, i.e. (ℓ/ξ)² = 8π na V^(2/3), where the measured ℓ saturates:
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


def eta_eq(density_um3, EN_nK, hbar_over_m):
    """Condensed fraction of the ideal Bose gas with density n and kinetic energy per atom E/N. Below T_c,
    E/N = (3/2) k_B T ζ(5/2)/(n λ_T³) and η = 1 − ζ(3/2)/(n λ_T³), λ_T = √(2πħ²/(m k_B T)); 0 above T_c."""
    n = density_um3 * 1e18
    E = EN_nK * 1e-9 * KB
    nl3 = lambda T: n * (2 * np.pi * HBAR * hbar_over_m * 1e-12 / (KB * T)) ** 1.5
    lo, hi = 1e-12, 1e-3
    for _ in range(200):
        T = np.sqrt(lo * hi)
        lo, hi = (T, hi) if 1.5 * KB * T * ZETA52 / nl3(T) < E else (lo, T)
    return max(0.0, 1 - ZETA32 / nl3(T))


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
        fh.write('(* Fig 4c analogue: the plotted arrays (same keys as fig4c.npz). Load with data = Get["fig4c.wl"]. *)\n')
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
    L, Ltxt = (r'\ell', 'ℓ') if quantum else (r'\bar{\ell}', 'ℓ̄')

    arrays, xs, ys, inbox, W = {}, [], [], [], {}
    for s, r in sorted(runs.items()):
        p, sc, se = r['points'], r['scales'], series[s]
        eta = eta_eq(se['density_um3'], r['initial']['EN_nK'], sc['hbarOverM_um2_per_s']) if quantum else 1.0
        t = np.array(p['t_s'])
        ell2 = np.array(p['ell_um']) ** 2 * eta ** (-2 / 3)
        rate = np.array(p['ellRate']) * eta ** (-2 / 3)
        x = ell2 / sc['xi_um'] ** 2
        na = se['density_um3'] * se['a_a0'] * A0_UM
        ceil = 8 * np.pi * na * se['V_um3'] ** (2 / 3)
        ok = np.isfinite(rate)
        tm = np.array(se['measured_t_s'])
        tm = tm[(tm >= t[ok][0]) & (tm <= t[ok][-1])]
        xm, ym = np.interp(tm, t[ok], x[ok]), np.interp(tm, t[ok], rate[ok])
        xs.append(xm); ys.append(ym); inbox.append(xm <= ceil)
        W[s] = dict(x=x[ok], rate=rate[ok], na=na, ceil=ceil)
        arrays.update({f's{s:02d}__ell_over_xi_sq': x[ok], f's{s:02d}__rate': rate[ok], f's{s:02d}__samples_ell_over_xi_sq': xm,
                       f's{s:02d}__samples_rate': ym, f's{s:02d}__box_ceiling_ell_over_xi_sq': ceil, f's{s:02d}__eta': eta,
                       f's{s:02d}__na_um2': na})
    xs, ys, inbox = np.concatenate(xs), np.concatenate(ys), np.concatenate(inbox)
    if equal or sqrt_step:
        # bins over the curves (equal width, or equal steps in √x: denser early, wider late, like the published
        # bins); errors are the spread between the series
        edges = (np.arange(0, np.sqrt(XMAX) + sqrt_step, sqrt_step) ** 2 if sqrt_step else np.arange(0, XMAX + equal, equal))
        bx, by, be, bn = curve_binned(W, edges, True)
        ax_, ay_, ae_, an_ = curve_binned(W, edges, False)
    else:
        edges = edges_from(px)
        bx, by, be, bn = binned(xs[inbox], ys[inbox], edges)
        ax_, ay_, ae_, an_ = binned(xs, ys, edges)
    gx = np.array([0, XMAX])
    arrays.update({'wke__ell_over_xi_sq': bx, 'wke__rate': by, 'wke__rate_err': be, 'wke__n_samples': bn,
                   'wke_all__ell_over_xi_sq': ax_, 'wke_all__rate': ay_, 'wke_all__rate_err': ae_, 'wke_all__n_samples': an_,
                   'bin_edges': edges, 'exp__ell_over_xi_sq': px, 'exp__rate': py, 'exp__rate_err': pe,
                   'guide__exponential_x': gx, 'guide__exponential_rate': gx / TAU_XI, 'guide__D': D_GUIDE})

    suffix = '_sqrt' if sqrt_step else '_equal' if equal else ''
    s0 = next(iter(runs.values()))['settings']
    ytop = ytop or max(5.5, 1.1 * max(np.nanmax(ay_ + ae_), *(np.nanmax(d['rate'][d['x'] <= XMAX]) for d in W.values())))
    NA = LogNorm(min(d['na'] for d in W.values()) * 0.9, max(d['na'] for d in W.values()) * 1.1)
    cmap = plt.get_cmap('viridis')
    with plt.rc_context(STYLE):
        fig, axes = plt.subplots(1, 2, figsize=(11, 4.6), constrained_layout=True)
        for ax, full in zip(axes, (False, True)):
            if full:
                for s, d in sorted(W.items()):
                    m = d['x'] <= d['ceil']; c = cmap(NA(d['na'])); j = max(m.sum() - 1, 0)
                    ax.plot(d['x'][m], d['rate'][m], '-', color=c, lw=0.8, alpha=0.8, zorder=1)
                    ax.plot(d['x'][j:], d['rate'][j:], ':', color=c, lw=0.8, alpha=0.8, zorder=1)
                ax.errorbar(px, py, pe, fmt='h', ms=6.5, color='0.55', mfc='white', mec='0.55', mew=1.0, elinewidth=0.9, capsize=0, zorder=2)
            ax.plot(gx, gx / TAU_XI, '-', color='k', lw=1.2, zorder=3)
            ax.axhline(D_GUIDE, color='k', ls=(0, (6, 3)), lw=1.2, zorder=3)
            ax.errorbar(ax_, ay_, ae_, fmt='h', ms=7, color=EDGE, mfc='white', mec=EDGE, mew=1.0, elinewidth=0.8, capsize=0, zorder=4)
            ax.errorbar(bx, by, be, fmt='h', ms=7, color=EDGE, mfc=FILL, mec=EDGE, mew=1.3, elinewidth=1.0, capsize=0, zorder=5)
            ax.set_xlim(-0.02 * XMAX, XMAX); ax.set_ylim(0, ytop); ax.set_xticks([0, 600, 1200, 1800])
            ax.set_xlabel(rf'$({L}/\xi)^2$')
            ax.set_ylabel(rf'$\dfrac{{m}}{{\hbar}}\,\dfrac{{\mathrm{{d}}{L}^2}}{{\mathrm{{d}}t}}$', fontsize=13)
            xl = min(0.12 * XMAX, 0.55 * ytop * TAU_XI)
            ax.annotate(rf'$(\ell/\xi)^2/{TAU_XI}$', (xl, xl / TAU_XI), xytext=(-6, 0), textcoords='offset points',
                        fontsize=9, ha='right', va='center')
            ax.annotate(rf'$D = {D_GUIDE}\,\hbar/m$', (XMAX, D_GUIDE), xytext=(-4, 5), textcoords='offset points', fontsize=9, ha='right')
        axes[0].set_title(f'WKE, {len(W)} series pooled at the measured times')
        axes[1].set_title('WKE with the published points and the WKE series')
        h = [Line2D([], [], ls='', marker='h', ms=7, color=EDGE, mfc=FILL, mew=1.3, label=rf'WKE, binned, ${L}^3 \leq V$'),
             Line2D([], [], ls='', marker='h', ms=7, color=EDGE, mfc='white', mew=1.0, label='WKE, binned, all samples'),
             Line2D([], [], ls='', marker='h', ms=6.5, color='0.55', mfc='white', mew=1.0, label='published'),
             Line2D([], [], color=cmap(0.5), lw=0.8, label='WKE, one series'),
             Line2D([], [], color=cmap(0.5), lw=0.8, ls=':', label=rf'same, past ${L}^3 = V$'),
             Line2D([], [], color='k', lw=1.2, label=rf'$\tau = {TAU_XI}\,t_\xi$'),
             Line2D([], [], color='k', ls=(0, (6, 3)), lw=1.2, label=rf'$D = {D_GUIDE}\,\hbar/m$')]
        axes[1].legend(handles=h, fontsize=9, frameon=False, loc='upper left', bbox_to_anchor=(1.02, 1.0))
        fig.colorbar(ScalarMappable(NA, 'viridis'), ax=axes[1], label=r'$na$ (µm$^{-2}$)', shrink=0.55, location='right', anchor=(0, 0))
        norm = (r'$\ell^3 = f_0/(\eta_{\rm eq} n)$' if quantum else r'$\bar{\ell}^3 = f_0/n$')
        fig.suptitle(f'Fig 4c analogue. WKE bubble chain (N → ∞), {"Bose +1" if quantum else "classical"}, {s0["accuracy"]}; '
                     + norm + rf'; the published $\ell$ carries a deconvolution that is not undone', fontsize=10)
        if equal or sqrt_step:
            how = rf'steps of {sqrt_step:g} in $\sqrt{{x}}$' if sqrt_step else f'bins of {equal:g}'
            axes[0].set_title(f'WKE, {len(W)} series: curves in {how}, bars: std between series')
        fig.savefig(pdf or os.path.join(out_dir, f'fig4c{suffix}.pdf'), bbox_inches='tight')
    np.savez_compressed(os.path.join(out_dir, f'fig4c{suffix}.npz'), **{k: np.asarray(v) for k, v in arrays.items()})
    write_wl(os.path.join(out_dir, f'fig4c{suffix}.wl'), arrays,
             {'kernel': s0['kernel'], 'accuracy': s0['accuracy'], 'length': 'ell' if quantum else 'ellbar'})
    print(f'{pdf or os.path.join(out_dir, "fig4c" + suffix + ".pdf")} (+ .npz, .wl): {len(W)} series, kernel {s0["kernel"]}, {s0["accuracy"]}; {Ltxt} normalised '
          f'{"by η_eq" if quantum else "with η = 1"}')


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser(description='Fig 4c analogue from out_dir/runs')
    ap.add_argument('out_dir', nargs='?', default=os.path.join(HERE, 'out'))
    ap.add_argument('--ytop', type=float, help='top of the y axis (default: from the data)')
    ap.add_argument('--pdf', help='write the figure here instead of out_dir/fig4c.pdf')
    ap.add_argument('--equal', type=float, metavar='W', help='equal-width bins of W over the curves, errors = std between '
                    'series; writes fig4c_equal.pdf, .npz, .wl')
    ap.add_argument('--sqrt', type=float, metavar='D', help='like --equal, but bins of equal step D in sqrt((l/xi)^2), '
                    'denser at small (l/xi)^2; writes fig4c_sqrt.pdf, .npz, .wl')
    a = ap.parse_args()
    main(a.out_dir, a.ytop, a.pdf, a.equal, a.sqrt)

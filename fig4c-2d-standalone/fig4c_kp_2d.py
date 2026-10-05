"""2D peak-momentum time gallery and Fig 4c-style derivative figure.

Rates are local quadratic slopes of the plotted 1/kp² versus physical-time curves.
No experimental points or three-dimensional guide lines are used.
"""
import argparse
import glob
import json
import os

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import Normalize
from matplotlib.lines import Line2D

STYLE = {'font.family': 'serif', 'font.serif': ['DejaVu Serif'],
         'mathtext.fontset': 'stix', 'font.size': 9, 'axes.titlesize': 9,
         'pdf.fonttype': 42}
EDGE, FILL = '#2b3f7f', '#c3cadb'
MARKERS = {'P1': 'o', 'P2': 's', 'P3': '^'}
WINDOW = 11


def derivative(t, y, window=WINDOW):
    """Centred local quadratic slope on an irregular physical-time grid.

    Leave the first and last half-window samples out to avoid one-sided fits.
    """
    if len(t) < window:
        raise ValueError(f'need at least {window} time samples to differentiate')
    half = window // 2
    rate = np.full(len(t), np.nan)
    for i in range(half, len(t) - half):
        dt = t[i-half:i+half+1] - t[i]
        scale = np.max(np.abs(dt))
        u = dt / scale
        values = y[i-half:i+half+1]
        co = np.linalg.lstsq(np.stack([np.ones_like(u), u, u*u], axis=1),
                             values, rcond=None)[0]
        rate[i] = co[1] / scale
    return rate


def pooled(curves, edges):
    """One interpolated mean per series and bin; pooled error is between-series SD."""
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        rates = []
        for d in curves.values():
            order = np.argsort(d['x'])
            x, y = d['x'][order], d['rate'][order]
            unique = np.r_[True, np.diff(x) > 1e-12]
            x, y = x[unique], y[unique]
            a, b = max(lo, x[0]), min(hi, x[-1])
            if b-a >= .5*(hi-lo):
                rates.append(np.interp(np.linspace(a, b, 50), x, y).mean())
        if len(rates) >= 2:
            rows.append(((lo+hi)/2, np.mean(rates), np.std(rates, ddof=1), len(rates)))
    return np.asarray(rows, float).reshape(-1, 4).T


def main(out_dir):
    runs = {}
    for path in sorted(glob.glob(os.path.join(out_dir, 'runs', 's*.json'))):
        run = json.load(open(path))
        series = run['settings']['series']
        if series not in (8, 10):
            runs[series] = run
    if not runs:
        raise ValueError(f'no runs in {out_dir}/runs')
    curves, arrays = {}, {}
    gvals = [r['settings']['gtilde'] for r in runs.values()]
    norm = Normalize(min(gvals), max(gvals))
    cmap = plt.get_cmap('viridis')
    with plt.rc_context(STYLE):
        fig_t, axes = plt.subplots(6, 2, figsize=(11, 15), constrained_layout=True)
        for panel, (series, run) in enumerate(sorted(runs.items())):
            p, sc, settings = run['points'], run['scales'], run['settings']
            t = np.asarray(p['t_s'], float)
            ratio = np.asarray(p['X'], float)
            if len(t) < WINDOW or not np.all(np.diff(t) > 0):
                raise ValueError(f'series {series}: insufficient or unordered time samples')
            invkp2 = (ratio / sc['kXi_um_inv'])**2
            rate = derivative(t, invkp2) / sc['hbarOverM_um2_per_s']
            x = ratio**2  # (k_xi/k_p)^2
            valid = np.isfinite(rate) & np.isfinite(x)
            c = cmap(norm(settings['gtilde']))
            marker = MARKERS.get(settings['protocol'], 'D')
            curves[series] = dict(x=x[valid], rate=rate[valid], color=c, marker=marker,
                                  settings=settings)
            arrays.update({f's{series:02d}__t_s': t,
                           f's{series:02d}__inv_kp2_um2': invkp2,
                           f's{series:02d}__x_kxi_over_kp_sq': x[valid],
                           f's{series:02d}__rate': rate[valid],
                           f's{series:02d}__gtilde': settings['gtilde'],
                           f's{series:02d}__n2_um2': settings['density_um2']})
            ax = axes.flat[panel]
            ax.plot(t*1e3, invkp2, '-', color=c, lw=1.0, alpha=.75)
            step = max(1, len(t)//24)
            ax.plot((t*1e3)[::step], invkp2[::step], marker, ms=3, color=c,
                    mfc='white', mew=.7, ls='none')
            ax.axhline(1/sc['kXi_um_inv']**2, color='.5', lw=.7, ls=':')
            ax.set_xlim(0, None); ax.set_ylim(0, None)
            ax.set_xlabel('t (ms)'); ax.set_ylabel(r'$1/k_p^2$ (µm$^2$)')
            ax.set_title(rf'Series {series} ({settings["protocol"]}): '
                         rf'$\tilde{{g}}={settings["gtilde"]:.3f}$, '
                         rf'$n_2={settings["density_um2"]:.2f}\,\mu\mathrm{{m}}^{{-2}}$'
                         f'  [{run["status"]}]')
            ax.grid(alpha=.22)
        for ax in axes.flat[len(runs):]: ax.axis('off')
        fig_t.suptitle(r'2D WKE: $1/k_p^2$ versus time; dotted: $1/k_\xi^2$', fontsize=12)
        fig_t.savefig(os.path.join(out_dir, 'kp_time_gallery.pdf'))
        plt.close(fig_t)

        xmax = max(np.max(d['x']) for d in curves.values())
        edges = np.linspace(0, 1.03*xmax, 25)
        bx, by, be, bn = pooled(curves, edges)
        arrays.update({'pooled__x_kxi_over_kp_sq': bx, 'pooled__rate': by,
                       'pooled__rate_sd': be, 'pooled__n_series': bn, 'bin_edges': edges})
        fig_r, axes = plt.subplots(1, 2, figsize=(11.8, 4.8), constrained_layout=True)
        for ax in axes:
            ax.errorbar(bx, by, be, fmt='h', ms=6, color=EDGE, mfc=FILL,
                        mec=EDGE, mew=1, elinewidth=.85, capsize=0, zorder=5)
            ax.set_xlim(0, 1.03*xmax)
            ax.set_xlabel(r'$(k_\xi/k_p)^2$')
            ax.set_ylabel(r'$(m/\hbar)\,\mathrm{d}(k_p^{-2})/\mathrm{d}t$')
            ax.grid(alpha=.2)
        for series, d in sorted(curves.items()):
            order = np.argsort(d['x'])
            axes[1].plot(d['x'][order], d['rate'][order], color=d['color'],
                         lw=1, alpha=.85, zorder=2)
        pooled_top = np.max(by+be) if len(by) else 0
        axes[0].set_ylim(min(0, np.min(by-be)), max(1e-9, pooled_top)*1.12)
        all_rates = np.concatenate([d['rate'] for d in curves.values()])
        # The series span several decades in rate. Running trajectories can
        # briefly have negative fitted slopes, so use symlog when needed.
        if np.min(all_rates) > 0:
            axes[1].set_yscale('log')
            axes[1].set_ylim(np.min(all_rates)*.8, np.max(all_rates)*1.3)
        else:
            axes[1].set_yscale('symlog', linthresh=.01)
            axes[1].set_ylim(np.min(all_rates)*1.2, np.max(all_rates)*1.3)
        axes[0].set_title('Pooled 2D series; bars: between-series SD')
        axes[1].set_title('Individual 2D series (log or symlog rate) and pooled result')
        handles = [Line2D([], [], color=d['color'], marker=d['marker'], ms=4, lw=1,
                          label=(f's{series:02d} {d["settings"]["protocol"]}: '
                                 f'g̃={d["settings"]["gtilde"]:.3f}, '
                                 f'n₂={d["settings"]["density_um2"]:.2f} µm⁻²'))
                   for series, d in sorted(curves.items())]
        handles.insert(0, Line2D([], [], marker='h', color=EDGE, mfc=FILL,
                                 ls='none', label='Pooled mean ± SD'))
        axes[1].legend(handles=handles, fontsize=7.5, frameon=False,
                       loc='upper left', bbox_to_anchor=(1.02, 1.0))
        fig_r.suptitle(r'2D WKE: derivative of $1/k_p^2(t)$ versus $(k_\xi/k_p)^2$'
                       '\nLocal quadratic derivative; no 3D data', fontsize=11)
        fig_r.savefig(os.path.join(out_dir, 'kp_rate_gallery.pdf'), bbox_inches='tight')
        plt.close(fig_r)
    np.savez_compressed(os.path.join(out_dir, 'kp_galleries.npz'), **arrays)
    print(f'{len(runs)} series; saved {out_dir}/kp_time_gallery.pdf, kp_rate_gallery.pdf, kp_galleries.npz')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('out_dir', nargs='?', default=os.path.join(os.path.dirname(__file__), 'out'))
    main(ap.parse_args().out_dir)

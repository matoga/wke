"""Three rainbow 2D spectrum galleries from the saved occupation snapshots.

2piknk_gallery: 2π k n_k, linear axes.
nk_gallery: n_k, log-log with lower ordinate one atom per mode.
ek_gallery: k³ n_k, linear axes (proportional to shell kinetic energy).
"""
import argparse
import glob
import json
import os

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import Normalize
from matplotlib.cm import ScalarMappable
import numpy as np

STYLE = {'font.family': 'serif', 'font.serif': ['DejaVu Serif'],
         'mathtext.fontset': 'stix', 'font.size': 9,
         'axes.titlesize': 9, 'pdf.fonttype': 42}
KINDS = {
    '2piknk': (r'$N_k=2\pi k n_k$', 'linear'),
    'nk': (r'$n_k$ (atoms per mode)', 'log'),
    'ek': (r'$E_k\propto k^3 n_k$ (arb. units)', 'linear'),
}


def make_gallery(runs, out_dir, kind, cmap):
    ylabel, scale = KINDS[kind]
    arrays = {}
    with plt.rc_context(STYLE):
        fig, axes = plt.subplots(6, 2, figsize=(11, 15), constrained_layout=True)
        for panel, (series, run) in enumerate(sorted(runs.items())):
            snap, settings = run['snapshots'], run['settings']
            k = np.asarray(snap['k_um_inv'], float)
            ts = np.asarray(snap['t_s'], float)
            f = np.asarray(snap['n_k'], float)
            if len(ts) < 2 or f.shape != (len(ts), len(k)):
                raise ValueError(f'series {series}: invalid snapshots')
            selected = np.unique(np.linspace(0, len(ts)-1, min(9, len(ts))).round().astype(int))
            if kind == '2piknk':
                values = 2*np.pi*k[None, :]*f[selected]
            elif kind == 'ek':
                values = k[None, :]**3*f[selected]
            else:
                values = f[selected]
            ax = axes.flat[panel]
            if scale == 'log':
                mask = np.any(values >= 1, axis=0)
                right = min(k[-1], k[mask][-1]*1.05) if np.any(mask) else k[-1]
            else:
                peaks = k[np.argmax(values, axis=1)]
                right = min(k[-1], max(peaks)*3)
            for j, row in zip(selected, values):
                visible = np.isfinite(row) & (k <= right)
                if scale == 'log':
                    visible &= (k > 0) & (row >= 1)
                    ax.loglog(k[visible], row[visible], color=cmap(j/(len(ts)-1)), lw=1.3)
                else:
                    ax.plot(k[visible], row[visible], color=cmap(j/(len(ts)-1)), lw=1.3)
            ax.set_xlim(k[0] if scale == 'log' else 0, right)
            ax.set_ylim(1 if scale == 'log' else 0, max(1.1, np.max(values)*1.12))
            ax.set_title(rf'Series {series} ({settings["protocol"]}): '
                         rf'$\tilde{{g}}={settings["gtilde"]:.3f}$, '
                         rf'$n_2={settings["density_um2"]:.2f}\,\mu\mathrm{{m}}^{{-2}}$')
            ax.set_xlabel(r'$k$ (µm$^{-1}$)')
            ax.set_ylabel(ylabel)
            ax.grid(alpha=.2, which='both' if scale == 'log' else 'major')
            arrays.update({f's{series:02d}__k_um_inv': k,
                           f's{series:02d}__t_s': ts[selected],
                           f's{series:02d}__{kind}': values})
        for ax in axes.flat[len(runs):]: ax.axis('off')
        fig.colorbar(ScalarMappable(Normalize(0, 1), cmap), ax=axes.ravel().tolist(),
                     label=r'Snapshot order: early $\rightarrow$ late', shrink=.45,
                     ticks=[0, .25, .5, .75, 1])
        fig.suptitle(f'2D WKE: {kind} spectrum gallery ({"log–log" if scale == "log" else "linear axes"}); '
                     'rainbow colour follows time', fontsize=12)
        fig.savefig(os.path.join(out_dir, f'{kind}_gallery.pdf'))
        plt.close(fig)
    np.savez_compressed(os.path.join(out_dir, f'{kind}_gallery.npz'), **arrays)
    print(f'{len(runs)} series; saved {out_dir}/{kind}_gallery.pdf and .npz')


def main(out_dir):
    runs = {}
    for path in sorted(glob.glob(os.path.join(out_dir, 'runs', 's*.json'))):
        run = json.load(open(path))
        series = run['settings']['series']
        if series not in (8, 10):
            if 'snapshots' not in run:
                raise ValueError(f'{path} lacks snapshots; rerun with the updated solver')
            runs[series] = run
    if not runs:
        raise ValueError(f'no runs in {out_dir}/runs')
    cmap = plt.get_cmap('turbo')
    for kind in KINDS:
        make_gallery(runs, out_dir, kind, cmap)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('out_dir', nargs='?', default=os.path.join(os.path.dirname(__file__), 'out'))
    main(ap.parse_args().out_dir)

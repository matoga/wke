"""Clock exponent of every model on one figure, from the bidir_clock.npz of each study.

usage: analysis/.venv/bin/python analysis/plots/bidir_models.py <out dir> <study dir> [<study dir> ...]

Writes <out dir>/plots/bidir_models.pdf (+ .npz): p = −d ln t_level/d ln a against the stage of the
evolution, for the IR (level of N_QC/N) and the UV (level of T_peak), each model against the measured
series; and the collapse p per model with the published values.
"""
import json
import os
import sys
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from common import GUIDE, save, log_x
import bidir_fit as B

MODEL_COL = ['#1b9e77', '#7b3fa0', '#d95f02', '#3b6fb6']


def main(out_dir, study_dirs):
    fig, axes = plt.subplots(1, 3, figsize=(12.5, 3.8), gridspec_kw=dict(width_ratios=[1, 1, 0.8]))
    arrays = {}
    measured_drawn = set()
    handles = []
    for i, sd in enumerate(study_dirs):
        path = os.path.join(sd, 'plots', 'bidir_clock.npz')
        if not os.path.exists(path):
            print(f'  {sd}: no bidir_clock.npz, skipped')
            continue
        z = np.load(path)
        summary = json.load(open(os.path.join(sd, 'plots', 'bidir_summary.json')))
        run = json.load(open(os.path.join(sd, 'runs', sorted(os.listdir(os.path.join(sd, 'runs')))[0])))
        s = run['settings']
        label = f"{s['modelLabel']}, {'Bose +1' if s.get('kernel') == 'quantum' else 'classical'}"
        col = MODEL_COL[i % len(MODEL_COL)]
        tag = s['model']
        drew = False
        for j, reg in enumerate(('IR', 'UV')):
            key = f'wke__level_{reg}'
            if key + '__p' in z.files:
                ok = np.isfinite(z[key + '__p'])
                if ok.any():
                    axes[j].plot(z[key + '__stage_ms'][ok], z[key + '__p'][ok], color=col, lw=1.4)
                    arrays[f'{tag}__{reg}__stage_ms'] = z[key + '__stage_ms'][ok]
                    arrays[f'{tag}__{reg}__p'] = z[key + '__p'][ok]
                    drew = True
            for kind, mk in (('series2', 's'), ('series1', 'o')):
                key = f'{kind}__level_{reg}'
                if key + '__p' in z.files and (kind, reg) not in measured_drawn:
                    ok = np.isfinite(z[key + '__p'])
                    axes[j].errorbar(z[key + '__stage_ms'][ok], z[key + '__p'][ok], z[key + '__p_err'][ok], marker=mk, ms=4,
                                     ls='', color='0.25', mfc='white', elinewidth=0.8, capsize=0)
                    arrays[f'measured_{kind}__{reg}__stage_ms'] = z[key + '__stage_ms'][ok]
                    arrays[f'measured_{kind}__{reg}__p'] = z[key + '__p'][ok]
                    arrays[f'measured_{kind}__{reg}__p_err'] = z[key + '__p_err'][ok]
                    measured_drawn.add((kind, reg))
            p = summary.get('p', {}).get(f'wke_{reg}')
            if p:
                axes[2].errorbar([j + 0.12 * (i - 1)], [p[0]], [p[1]], marker='D', ms=5, ls='', color=col, elinewidth=0.8, capsize=0)
                arrays[f'{tag}__collapse_p_{reg}'] = p
                drew = True
        handles.append(Line2D([], [], color=col, lw=1.4, marker='D' if drew else None, label=label if drew else f'{label}: no evolution'))
    for j, reg in enumerate(('IR', 'UV')):
        v, e = B.PUBLISHED[f'p_{reg}']
        axes[2].errorbar([j + 0.3], [v], [e], marker='o', ms=5, ls='', color='0.25', mfc='white', elinewidth=0.8, capsize=0)
    for ax, title in ((axes[0], 'IR: time to reach a level of N_QC/N'), (axes[1], 'UV: time to reach a level of T_peak')):
        for y, name in ((2, 'p = 2 (t ∝ 1/a²)'), (1, 'p = 1'), (0, 'p = 0 (a-independent)')):
            ax.axhline(y, **GUIDE)
            ax.annotate(name, (1.1, y + 0.05), fontsize=7.5, color='0.35')
        log_x(ax)
        ax.set(xlabel='stage: time at 300 a₀ when the level is reached (ms)', ylabel='p = −d ln t_level / d ln a',
               ylim=(-0.6, 2.6), xlim=(1, 3000), title=title)
    axes[2].axhline(2, **GUIDE)
    axes[2].axhline(0, **GUIDE)
    axes[2].set(xticks=[0, 1], xticklabels=['IR', 'UV'], xlim=(-0.5, 1.5), ylim=(-0.6, 2.6),
                ylabel='p (best collapse of all a)', title='Collapse over t ā ∈ [20, 160] ms')
    handles += [Line2D([], [], color='0.25', marker='s', ls='', mfc='white', label='measured, series 2 (N_QC/N)'),
                Line2D([], [], color='0.25', marker='o', ls='', mfc='white', label='measured, series 1 (T_peak); published p (right)')]
    fig.legend(handles=handles, loc='upper left', bbox_to_anchor=(1.0, 0.9), frameon=False, fontsize=8)
    fig.suptitle('Clock exponent p in t → t (a/300 a₀)^p: models against the measurements', y=1.02)
    fig.tight_layout()
    save(fig, out_dir, 'bidir_models', arrays)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:])

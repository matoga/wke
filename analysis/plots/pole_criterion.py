"""Pole criteria on saved states (analysis/pole_criterion.ts writes the data).

pole_weight: per run, against k_ξ/k_p, the largest sampled vertex weight 1/|1 − cL|² (the old stop rule)
next to the averaged dressings M the equation integrates: the largest M carried by any collision and the
M below which 99.9% and 99% of the collision rate lies. Solid: the accuracy level's table cells; dashed:
cells half as wide.

pole_share: per run, the share of the collision rate carried by collisions with M above M* for several M*,
with the breakdown share of the new rule as a guide.

  analysis/.venv/bin/python analysis/plots/pole_criterion.py analysis/results/<folder>
"""
import json
import os
import sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from common import GUIDE, LABEL, log_x, save

LABELS = {'chain': 'Bubble chain', 'heuristic-a': 'Heuristic A', 'heuristic-b': 'Heuristic B', 'heuristic-c': 'Heuristic C'}
FLOOR = 1e-9


def grid_axes(n, ncols=4, w=3.0, h=2.4):
    nrows = (n + ncols - 1) // ncols
    fig, axs = plt.subplots(nrows, ncols, figsize=(w * ncols, h * nrows + 0.6), squeeze=False, layout='constrained')
    for ax in axs.flat[n:]:
        ax.set_visible(False)
    return fig, axs.flat


def title(r):
    stats = ', Bose +1' if r['kernel'] == 'quantum' else ''
    return f"{LABELS.get(r['model'], r['model'])}, {r['state']}, {r['a_a0']:g} a₀ ({r['accuracy']}{stats})"


def main(study_dir):
    d = json.load(open(os.path.join(study_dir, 'pole_criterion.json')))
    runs = d['runs']
    limit = d['poleDressingLimit']
    arrays = {}

    fig, axs = grid_axes(len(runs))
    series = [('weight', 'largest sampled 1/|1 − cL|²', '#222222'), ('mMax', 'largest averaged M', '#c0392b'),
              ('m999', 'M at 99.9% of the rate', '#e67e22'), ('m99', 'M at 99% of the rate', '#3b6fb6')]
    for i, (ax, r) in enumerate(zip(axs, runs)):
        X = np.asarray(r['X'])
        for j, res in enumerate(r['resolutions']):
            for key, lab, c in series:
                y = np.asarray(res[key], dtype=float)
                ax.plot(X, y, color=c, ls='-' if j == 0 else '--', lw=1.1, marker='o' if j == 0 else None, ms=2.5,
                        label=lab if (i == 0 and j == 0) else None)
                arrays[f'run{i}_{key}_res{j}'] = y
        arrays[f'run{i}_X'] = X
        ax.axhline(limit, **GUIDE)
        ax.annotate(f'{limit:g}', (X.min(), limit), xytext=(2, 2), **LABEL)
        ax.set_yscale('log')
        log_x(ax)
        ax.set_title(title(r), fontsize=7.5)
        ax.set_xlabel('k_ξ/k_p')
    axs[0].set_ylabel('weight or dressing M')
    fig.legend(loc='outside lower center', ncols=4, fontsize=8, frameon=False,
               title='solid: standard table cells, dashed: cells half as wide')
    save(fig, study_dir, 'pole_weight', arrays)

    arrays = {}
    fig, axs = grid_axes(len(runs))
    colours = ['#1b9e77', '#3b6fb6', '#c0392b', '#7b3fa0']
    for i, (ax, r) in enumerate(zip(axs, runs)):
        X = np.asarray(r['X'])
        for j, res in enumerate(r['resolutions']):
            for (m, edge), c in zip(zip(d['thresholds'], d['thresholdEdges']), colours):
                y = np.maximum(np.asarray(res['shareByThreshold'][str(m)], dtype=float), FLOOR)
                ax.plot(X, y, color=c, ls='-' if j == 0 else '--', lw=1.1, marker='o' if j == 0 else None, ms=2.5,
                        label=f'M > {edge:g}' if (i == 0 and j == 0) else None)
                arrays[f'run{i}_share_M{m}_res{j}'] = y
        arrays[f'run{i}_X'] = X
        ax.axhline(0.01, **GUIDE)
        ax.annotate('1% of the rate', (X.min(), 0.01), xytext=(2, 2), **LABEL)
        ax.set_yscale('log')
        ax.set_ylim(FLOOR / 2, 1.5)
        log_x(ax)
        ax.set_title(title(r), fontsize=7.5)
        ax.set_xlabel('k_ξ/k_p')
    axs[0].set_ylabel('share of the collision rate')
    fig.legend(loc='outside lower center', ncols=4, fontsize=8, frameon=False,
               title=f'solid: standard table cells, dashed: cells half as wide; shares below {FLOOR:g} drawn at {FLOOR:g}')
    save(fig, study_dir, 'pole_share', arrays)


if __name__ == '__main__':
    main(sys.argv[1])

"""Make every figure of a study and write its README.

usage: analysis/.venv/bin/python analysis/plots/make_all.py analysis/results/<study> [--experiment <data dir>] [--bidir-data <data dir>]

A study with an "experiment" field also gets the comparison figures of experiment.py; the data
folder comes from --experiment or the environment variable WKE_EXPERIMENT_DATA. A study with a
"bidirectional" field gets those of bidirectional.py, with the data folder from --bidir-data or
WKE_BIDIR_DATA.
"""
import json
import os
import sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from common import load_study, run_id
import rate
import kp_gallery
import spectra
import ell
import rate_vs_a
import nk_fixed
import experiment
import bidirectional

study_dir = sys.argv[1].rstrip('/')
study, runs = load_study(study_dir)
print(f'{os.path.basename(study_dir)}: {len(runs)} runs')
for mod in (rate, kp_gallery, spectra, ell, rate_vs_a, nk_fixed):
    mod.make(study_dir, study, runs)
if study.get('experiment'):
    data = sys.argv[sys.argv.index('--experiment') + 1] if '--experiment' in sys.argv else os.environ.get('WKE_EXPERIMENT_DATA')
    if data:
        experiment.make(study_dir, study, runs, data)
    else:
        print('  experiment: no data folder (pass --experiment <dir> or set WKE_EXPERIMENT_DATA); comparison figures skipped')
if study.get('bidirectional'):
    data = sys.argv[sys.argv.index('--bidir-data') + 1] if '--bidir-data' in sys.argv else os.environ.get('WKE_BIDIR_DATA')
    if data:
        summary = bidirectional.make(study_dir, study, runs, data)
        json.dump(summary, open(os.path.join(study_dir, 'plots', 'bidir_summary.json'), 'w'), indent=1,
                  default=lambda v: float(v) if np.ndim(v) == 0 else np.asarray(v).tolist())
        print('  plots/bidir_summary.json')
    else:
        print('  bidirectional: no data folder (pass --bidir-data <dir> or set WKE_BIDIR_DATA); comparison figures skipped')

manifest_path = os.path.join(study_dir, 'manifest.json')
manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
lines = [f"# {os.path.basename(study_dir)}", '']
if study.get('question') or manifest.get('question'):
    lines += [study.get('question') or manifest.get('question'), '']
if manifest.get('note'):
    lines += [manifest['note'], '']
lines += [
    f"- Command: `{manifest.get('command', 'not recorded')}`",
    f"- Solver commit: {manifest.get('gitCommit', 'not recorded')}"
    + (' (with uncommitted solver changes)' if manifest.get('gitDirty') else ''),
    f"- Started {manifest.get('started', 'n/a')}, finished {manifest.get('finished', 'n/a')}",
    '',
    '| Run | Model | Accuracy | E/N (nK) | Status | k_ξ/k_p reached | Wall (s) | Snapshots |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
]
for r in runs:
    s = r['settings']
    X = r['points']['X']
    lines.append(f"| {run_id(r)} | {s['modelLabel']} | {s['accuracy']} | {r['initial']['EN_nK']:.1f} | {r.get('status', '?')} | "
                 f"{(X[-1] if X else float('nan')):.2f} | {r['meta'].get('wall_s', float('nan')):.0f} | {len(r.get('snapshots', {}).get('n_k', []))} |")
msgs = [f"- {run_id(r)}: {r['message']}" for r in runs if r.get('message')]
if msgs:
    lines += ['', 'Stop messages:', ''] + msgs
lines += ['', 'Figures (each with a .npz of the plotted arrays): ' + ', '.join(
    sorted(f for f in os.listdir(os.path.join(study_dir, 'plots')) if f.endswith('.pdf'))) if os.path.isdir(os.path.join(study_dir, 'plots')) else '']
open(os.path.join(study_dir, 'README.md'), 'w').write('\n'.join(lines) + '\n')
print('  README.md')

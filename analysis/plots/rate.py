"""Rate figure: (m/ħ) d(1/k_p²)/dt against k_ξ/k_p, lin-lin (left) and log-log (right).

Points with error bars, one per sample. Guides: the constant rate 0.37 on both panels and
(k_ξ/k_p)² through the median of the data near k_ξ/k_p = 1 on the log-log panel. When the
linear panel's top falls below 0.4, an inset (bottom right, up to 0.5) shows the data against
the 0.37 line; it sits bottom right unless points are there (then top left, then top right
with added headroom), and its height keeps every point centre of the main panel outside it.

Study options (study.json, key "plots"): "rateYmaxLinear" fixes the top of the linear panel;
"thin" maps a state name to n, plotting every n-th point of that state.
"""
import numpy as np
import matplotlib.pyplot as plt
from common import Style, GUIDE, LABEL, point_kw, legends, log_x, save, run_id

GUIDE_RATE = 0.37


def make(study_dir, study, runs):
    opts = study.get('plots', {})
    thin = opts.get('thin', {})
    ymax_fixed = opts.get('rateYmaxLinear')
    style = Style(runs)
    data = []
    for r in runs:
        p = r['points']
        x, y, e = (np.array(p[k], float) for k in ('X', 'rate', 'rateErr'))
        keep = np.isfinite(y) & np.isfinite(e) & (np.arange(len(y)) % thin.get(r['settings']['stateName'], 1) == 0)
        data.append((r, x[keep], y[keep], e[keep]))
    if not any(len(d[1]) for d in data):
        print('  rate: no points'); return
    arrays = {}
    for r, x, y, e in data:
        rid = run_id(r)
        arrays[f'{rid}__kxi_over_kp'] = x; arrays[f'{rid}__rate'] = y; arrays[f'{rid}__rate_err'] = e

    fig, axes = plt.subplots(1, 2, figsize=(14, 5.2))
    xmax = max(d[1].max() for d in data if len(d[1]))
    xmin = min(d[1].min() for d in data if len(d[1]))

    def draw(ax, logy):
        for r, x, y, e in data:
            m, c = style.of(r)
            ok = y > 0 if logy else np.ones_like(y, bool)
            lo = np.minimum(e, y - 1e-12) if logy else e
            ax.errorbar(x[ok], y[ok], yerr=[lo[ok], e[ok]], **point_kw(m, c), ecolor=c, elinewidth=0.8, capsize=0, zorder=3)

    # linear panel
    ax = axes[0]
    draw(ax, False)
    ally = np.concatenate([d[2] for d in data])
    top = ymax_fixed or 1.3 * np.nanpercentile(ally, 99)
    # Inset box: bottom right if no point centre falls there, else top left, else top right with
    # extra headroom. Boxes are in axes fractions: (x0, x1, anchor), height chosen to stay clear.
    MINH, MAXH, PAD = 0.2, 0.32, 0.04
    box = None
    if not ymax_fixed and top < 0.4:
        xw = 1.03 * xmax
        pts = [(xx / xw, yy) for _, x, y, _ in data for xx, yy in zip(x, y)]

        def free(x0, x1, anchor, top_):
            fr = [yy / top_ for xf, yy in pts if x0 - 0.03 <= xf <= x1 + 0.03]
            if anchor == 'bottom':
                return min(fr, default=1.0) - PAD - 0.06
            return 0.97 - PAD - max(fr, default=0.0)

        for x0, x1, anchor in ((0.55, 0.97, 'bottom'), (0.08, 0.50, 'top')):
            h = free(x0, x1, anchor, top)
            if h >= MINH:
                box = (x0, x1, anchor, min(h, MAXH)); break
        while box is None:
            top *= 1.15
            h = free(0.55, 0.97, 'top', top)
            if h >= MINH:
                box = (0.55, 0.97, 'top', min(h, MAXH))
    ax.set_xlim(0, 1.03 * xmax); ax.set_ylim(0, top)
    if top > GUIDE_RATE:
        ax.axhline(GUIDE_RATE, **GUIDE)
        ax.annotate(f'{GUIDE_RATE}', (0, GUIDE_RATE), xytext=(4, 3), va='bottom', ha='left', **LABEL)
    if box is not None:
        x0, x1, anchor, h = box
        y0 = 0.06 if anchor == 'bottom' else 0.97 - h
        ins = ax.inset_axes([x0, y0, x1 - x0, h])
        draw(ins, False)
        ins.set_xlim(0, 1.03 * xmax); ins.set_ylim(0, 0.5)
        ins.axhline(GUIDE_RATE, **GUIDE)
        ins.annotate(f'{GUIDE_RATE}', (0, GUIDE_RATE), xytext=(3, 2), va='bottom', ha='left', **LABEL)
        ins.tick_params(labelsize=7); ins.grid(alpha=.3)

    # log-log panel
    ax = axes[1]
    draw(ax, True)
    log_x(ax); ax.set_yscale('log')
    xs = np.geomspace(xmin, xmax, 200)
    near = [yy for _, x, y, _ in data for xx, yy in zip(x, y) if 0.8 < xx < 1.25 and yy > 0]
    y1 = float(np.median(near)) if near else 0.02
    sq = y1 * xs ** 2
    ax.plot(xs, np.full_like(xs, GUIDE_RATE), **GUIDE)
    ax.annotate(f'{GUIDE_RATE}', (xs[0], GUIDE_RATE), xytext=(4, 3), va='bottom', ha='left', **LABEL)
    ax.plot(xs, sq, **GUIDE)
    j = int(np.searchsorted(sq, 1.5)) if sq[-1] > 1.5 else len(xs) - 1
    ax.annotate(r'$\propto (k_\xi/k_p)^2$', (xs[j], sq[j]), xytext=(-6, 2), va='bottom', ha='right', **LABEL)
    pos = ally[ally > 0]
    ax.set_ylim(max(pos.min() * 0.7, 1e-4), 3)
    arrays['guide__kxi_over_kp'] = xs; arrays['guide__square'] = sq; arrays['guide__constant'] = np.full_like(xs, GUIDE_RATE)

    for a in axes:
        a.set_xlabel(r'$k_\xi/k_p$'); a.set_ylabel(r'$(m/\hbar)\,\mathrm{d}(k_p^{-2})/\mathrm{d}t$'); a.grid(alpha=.3, which='both')
    models = sorted({r['settings']['modelLabel'] for r in runs})
    acc = sorted({r['settings']['accuracy'] for r in runs})
    fig.suptitle(f"{', '.join(models)}; {', '.join(acc)} accuracy; rate from the collision term")
    fig.tight_layout(rect=(0, 0, 0.74, 1))
    legends(fig, style, [f'{GUIDE_RATE} (constant rate)', f'{y1:.3g} (k_ξ/k_p)², log-log only'])
    save(fig, study_dir, 'rate', arrays)

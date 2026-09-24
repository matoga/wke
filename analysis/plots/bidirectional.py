"""Comparison with the published measurements of bidirectional scaling in a quench-cooled box of ³⁹K.

A study with a "bidirectional" field gets these figures; the data folder comes from make_all.py's
--bidir-data or the environment variable WKE_BIDIR_DATA. The analysis (bidir_fit.py) is the same for the
WKE runs and the published n_k, and reproduces the published exponents, temperatures, N_QC and Δ_k.

- bidir_spectra: N_k and E_k at 300 a₀ at the published times, WKE against measured.
- bidir_temps: T_peak and T_low against t at 300 a₀.
- bidir_condensate: N_QC/N and Δ_k against t ā (ā = a/300 a₀), all a.
- bidir_exponents: α_IR/3, β_IR, α_UV/5, β_UV against a, from the collapse over t ā ∈ [20, 160] ms.
- bidir_collapse: IR n_k and UV E_k scaled with the a-averaged exponents and t → t ā.
- bidir_clock: the clock exponent p of t → t ā^p, from the collapse (IR, UV) and from the time at which
  an observable reaches a given level at each a (IR: N_QC/N, UV: T_peak), against the stage of the evolution.
"""
import os
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.colors import to_rgba
from common import A_SCALE, GUIDE, save, face, log_x
import bidir_fit as B

TIMES = [0, 20, 80, 320, 2560]
T_COL = plt.get_cmap('viridis')
K_MIN = 0.028  # first published k bin (µm⁻¹); the collapse uses the WKE from here on, like the data
# the collapse uses the WKE at the times of the published collapse, t ā = 20, 40, 80, 160 ms
COLLAPSE_T_ABAR = (20.0, 40.0, 80.0, 160.0)


def a_colours(avals):
    avals = sorted(avals)
    return {a: to_rgba(A_SCALE(i / max(1, len(avals) - 1))) for i, a in enumerate(avals)}


def at_time(curves, t, tol=1e-3):
    for c in curves:
        if abs(c['t'] - t) <= tol * max(1, t):
            return c
    return None


def model_label(study, runs):
    s = runs[0]['settings']
    return f"{s['modelLabel']}, {'Bose +1' if s.get('kernel') == 'quantum' else 'classical'}"


def by_a(curves):
    out = {}
    for c in curves:
        out.setdefault(c['a'], []).append(c)
    return {a: sorted(v, key=lambda c: c['t']) for a, v in sorted(out.items())}


# ---------------------------------------------------------------- figures

def fig_spectra(study_dir, label, model, data, arrays):
    fig, axes = plt.subplots(1, 2, figsize=(9.5, 3.4))
    m = by_a(model).get(300.0, [])
    d = by_a(data).get(300.0, [])
    for i, t in enumerate(TIMES):
        col = T_COL(i / (len(TIMES) - 1))
        for ax, fn, key in ((axes[0], B.Nk, 'Nk'), (axes[1], B.Ek_nK_um, 'Ek')):
            c = at_time(d, t)
            if c is not None:
                y = fn(c)
                ax.plot(c['k'], y / (1e4 if key == 'Nk' else 1), marker='o', ms=3.2, ls='', mfc=face(col), mec=col, mew=0.8)
                arrays[f'data_300a0_t{t}ms__k'] = c['k']
                arrays[f'data_300a0_t{t}ms__{key}'] = y
            c = at_time(m, t)
            if c is not None:
                y = fn(c)
                sel = c['k'] <= 5.5
                ax.plot(c['k'][sel], y[sel] / (1e4 if key == 'Nk' else 1), color=col, lw=1.2)
                arrays[f'wke_300a0_t{t}ms__k'] = c['k'][sel]
                arrays[f'wke_300a0_t{t}ms__{key}'] = y[sel]
    axes[0].set(xlabel='k (µm⁻¹)', ylabel='N_k = 4πk² n_k (10⁴ µm)', xlim=(0, 5.5))
    axes[1].set(xlabel='k (µm⁻¹)', ylabel='E_k / k_B (nK µm)', xlim=(0, 5.5))
    axes[0].set_ylim(bottom=0)
    axes[1].set_ylim(bottom=0)
    h = [Line2D([], [], color=T_COL(i / (len(TIMES) - 1)), lw=1.2, marker='o', ms=4, mfc=face(T_COL(i / (len(TIMES) - 1))),
                label=f't = {t} ms') for i, t in enumerate(TIMES)]
    h += [Line2D([], [], color='0.3', marker='o', ls='', ms=4, mfc='white', label='measured'),
          Line2D([], [], color='0.3', lw=1.2, label='WKE')]
    fig.legend(handles=h, loc='upper left', bbox_to_anchor=(0.92, 0.9), frameon=False, fontsize=8)
    fig.suptitle(f'Spectra at a = 300 a₀: {label} against the measured n_k (points)', y=1.02)
    fig.tight_layout()
    return fig


def fig_temps(study_dir, label, model, data, arrays):
    fig, ax = plt.subplots(figsize=(5.2, 3.4))
    for curves, kind in ((by_a(data).get(300.0, []), 'data'), (by_a(model).get(300.0, []), 'wke')):
        cs = [c for c in curves if c['t'] > 0]
        if not cs:
            continue
        t = np.array([c['t'] for c in cs])
        T = np.array([B.temperatures(c) for c in cs])
        arrays[f'{kind}_300a0__t_ms'] = t
        arrays[f'{kind}_300a0__T_peak_nK'] = T[:, 0]
        arrays[f'{kind}_300a0__T_low_nK'] = T[:, 1]
        for j, (col, name) in enumerate((('#3b6fb6', 'T_peak'), ('#c0392b', 'T_low'))):
            if kind == 'data':
                ax.plot(t, T[:, j], marker='s' if j else 'D', ms=4, ls='', mfc=face(to_rgba(col)), mec=col, label=f'{name}, measured')
            else:
                ax.plot(t, T[:, j], color=col, lw=1.2, label=f'{name}, WKE')
    ax.axhline(32, **GUIDE)
    ax.annotate('T_eq ≈ 32 nK (published)', (6, 33), fontsize=8, color='0.3')
    log_x(ax)
    ax.set_yscale('log')
    ax.set(xlabel='t (ms)', ylabel='apparent temperature (nK)', title=f'a = 300 a₀: {label}')
    ax.legend(loc='upper left', bbox_to_anchor=(1.02, 1), frameon=False, fontsize=8)
    return fig


def condensate_series(curves):
    out = {}
    for a, cs in by_a(curves).items():
        t, f, dk = [], [], []
        for c in cs:
            if c['t'] <= 0:
                continue
            N = np.trapezoid(B.Nk(c), c['k'])
            nqc, d = B.quasi_condensate(c)
            t.append(c['t']); f.append(nqc / N); dk.append(d)
        out[a] = (np.array(t), np.array(f), np.array(dk))
    return out


def fig_condensate(study_dir, label, model, data, arrays):
    fig, axes = plt.subplots(2, 1, figsize=(5.6, 5.0), sharex=True)
    avals = sorted({c['a'] for c in model} | {c['a'] for c in data})
    col = a_colours(avals)
    for kind, curves in (('data', data), ('wke', model)):
        for a, (t, f, dk) in condensate_series(curves).items():
            x = t * a / B.A_REF
            arrays[f'{kind}_{a:g}a0__t_abar_ms'] = x
            arrays[f'{kind}_{a:g}a0__NQC_over_N'] = f
            arrays[f'{kind}_{a:g}a0__Delta_k'] = dk
            if kind == 'data':
                axes[0].plot(x, f, marker='o', ms=3.5, ls='', mfc=face(col[a]), mec=col[a])
                axes[1].plot(x, dk, marker='o', ms=3.5, ls='', mfc=face(col[a]), mec=col[a])
            else:
                axes[0].plot(x, f, color=col[a], lw=1.1)
                axes[1].plot(x, dk, color=col[a], lw=1.1)
    axes[1].axhline(0.2, **GUIDE)
    axes[1].annotate('Δ_k^H ≈ 0.2 µm⁻¹ (box)', (1.2, 0.21), fontsize=8, color='0.3')
    axes[1].set_xscale('log')
    axes[1].xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f'{v:g}'))
    axes[0].set(ylabel='N_QC / N', title=f'Quasi-condensate: {label} (lines) against measured (points)')
    axes[1].set(xlabel='t ā (ms)', ylabel='Δ_k (µm⁻¹)', ylim=(0, 1))
    h = [Line2D([], [], color=col[a], marker='o', ms=4, mfc=face(col[a]), label=f'a = {a:g} a₀') for a in avals]
    fig.legend(handles=h, loc='upper left', bbox_to_anchor=(0.98, 0.9), frameon=False, fontsize=8, title='Colour: a')
    fig.tight_layout()
    return fig


def exponents(curves, n_sub):
    """Per a: (α_IR, β_IR, α_UV, β_UV) and errors from the collapse over t ā ∈ [20, 160] ms."""
    out = {}
    for a, cs in by_a(curves).items():
        w = B.in_window(cs)
        if len(w) < 3:
            continue
        row = []
        for reg in ('IR', 'UV'):
            r = B.fit_ab(w, B.WINDOW[reg], n_sub=n_sub)
            row += [r['alpha'], r['alpha_err'], r['beta'], r['beta_err']]
        out[a] = row
    return out


def fig_exponents(study_dir, label, model, data, data_dir, arrays, n_sub):
    em, ed = exponents(model, n_sub), exponents(data, n_sub)
    fig, ax = plt.subplots(figsize=(5.8, 3.6))
    # columns of exponents(): α_IR, err, β_IR, err, α_UV, err, β_UV, err
    spec = [(0, 3, 'α_IR/3', 'D', '#c0392b'), (2, 1, 'β_IR', 'o', '#c0392b'), (4, 5, 'α_UV/5', 'D', '#3b6fb6'), (6, 1, 'β_UV', 'o', '#3b6fb6')]
    for kind, e, dx in (('wke', em, 0.97), ('data', ed, 1.03)):
        if not e:
            continue
        a = np.array(sorted(e))
        M = np.array([e[x] for x in a])
        for j, div, name, mk, col in spec:
            y, err = M[:, j] / div, M[:, j + 1] / div
            kw = dict(marker=mk, ms=4.5, ls='', mec=col, mfc=col if kind == 'wke' else 'white', mew=1.0)
            ax.errorbar(a * dx, y, err, ecolor=col, elinewidth=0.8, capsize=0, **kw)
            arrays[f'{kind}__a'] = a
            arrays[f'{kind}__{name}'] = y
            arrays[f'{kind}__{name}_err'] = err
    for v, name in ((0.34, 'β_IR = 0.34'), (-0.14, 'β_UV = −0.14')):
        ax.axhline(v, **GUIDE)
        ax.annotate(f'{name} (published)', (95, v + 0.02), fontsize=8, color='0.3')
    ax.axhline(0, color='0.8', lw=0.6)
    log_x(ax)
    ax.set(xlabel='a (a₀)', ylabel='scaling exponent', title=f'Exponents over t ā ∈ [20, 160] ms: {label}')
    h = [Line2D([], [], marker=mk, ls='', color=col, mfc=col, label=name) for _, _, name, mk, col in spec]
    h += [Line2D([], [], marker='o', ls='', color='0.3', mfc='0.3', label='WKE (filled)'),
          Line2D([], [], marker='o', ls='', color='0.3', mfc='white', label='measured, same fit (open)')]
    ax.legend(handles=h, loc='upper left', bbox_to_anchor=(1.02, 1), frameon=False, fontsize=8)
    return fig, em, ed


def mean_exponents(e):
    if not e:
        return None
    M = np.array(list(e.values()))
    return dict(alpha_IR=M[:, 0].mean(), beta_IR=M[:, 2].mean(), alpha_UV=M[:, 4].mean(), beta_UV=M[:, 6].mean())


def fig_collapse(study_dir, label, model, data, ex_model, arrays):
    fig, axes = plt.subplots(2, 2, figsize=(8.4, 5.6))
    avals = sorted({c['a'] for c in model} | {c['a'] for c in data})
    col = a_colours(avals)
    ex_data = {k: v[0] for k, v in B.PUBLISHED.items()}
    for row, (kind, curves, ex) in enumerate((('wke', model, ex_model), ('data', data, ex_data))):
        if ex is None:
            axes[row, 0].set_title(f'{kind}: no curves in the window')
            continue
        for a, cs in by_a(curves).items():
            for c in B.in_window(cs):
                tb = c['t'] * a / B.A_REF / B.T0_MS
                x_ir = tb ** ex['beta_IR'] * c['k']
                y_ir = tb ** (-ex['alpha_IR']) * c['n']
                x_uv = tb ** ex['beta_UV'] * c['k']
                y_uv = tb ** (4 * ex['beta_UV'] - ex['alpha_UV']) * B.Ek_nK_um(c)
                key = f"{kind}_{a:g}a0_t{c['t']:g}ms"
                arrays[key + '__x_IR'], arrays[key + '__y_IR'] = x_ir, y_ir
                arrays[key + '__x_UV'], arrays[key + '__y_UV'] = x_uv, y_uv
                sel = (c['k'] >= K_MIN) & (x_ir <= 1.0)
                if kind == 'data':
                    axes[row, 0].plot(x_ir[sel], y_ir[sel], marker='o', ms=2.8, ls='', mfc=face(col[a]), mec=col[a], mew=0.7)
                    axes[row, 1].plot(x_uv, y_uv, marker='o', ms=2.8, ls='', mfc=face(col[a]), mec=col[a], mew=0.7)
                else:
                    axes[row, 0].plot(x_ir[sel], y_ir[sel], color=col[a], lw=0.9)
                    s2 = x_uv <= 4.5
                    axes[row, 1].plot(x_uv[s2], y_uv[s2], color=col[a], lw=0.9)
        who = label if kind == 'wke' else 'measured'
        axes[row, 0].set(yscale='log', xlim=(0, 1.0), xlabel='(t ā/t₀)^β k (µm⁻¹)', ylabel='(t ā/t₀)^(−α) n_k (µm³)',
                         title=f"IR, {who}: α = {ex['alpha_IR']:.2f}, β = {ex['beta_IR']:.2f}")
        axes[row, 1].set(xlim=(0, 4.5), xlabel='(t ā/t₀)^β k (µm⁻¹)', ylabel='(t ā/t₀)^(4β−α) E_k/k_B (nK µm)',
                         title=f"UV, {who}: α = {ex['alpha_UV']:.2f}, β = {ex['beta_UV']:.2f}")
        axes[row, 1].set_ylim(bottom=0)
    h = [Line2D([], [], color=col[a], marker='o', ms=4, mfc=face(col[a]), label=f'a = {a:g} a₀') for a in avals]
    fig.legend(handles=h, loc='upper left', bbox_to_anchor=(0.99, 0.95), frameon=False, fontsize=8, title='Colour: a')
    fig.suptitle('Collapse over t ā ∈ [20, 160] ms, t₀ = 40 ms (WKE: its own a-averaged exponents; measured: the published ones)', y=1.0)
    fig.tight_layout()
    return fig


def level_clock(curves, obs, levels):
    """For each level L: the time t_a(L) at which obs first reaches L at each a (log interpolation in t),
    and p, the slope of −ln t_a against ln a over the a that reach it; stage = the fitted t at 300 a₀."""
    per_a = {}
    for a, cs in by_a(curves).items():
        cs = [c for c in cs if c['t'] > 0]
        if len(cs) < 2:
            continue
        per_a[a] = (np.array([c['t'] for c in cs]), np.array([obs(c) for c in cs]))
    rows = []
    for L in levels:
        xs, ys = [], []
        for a, (t, o) in per_a.items():
            j = np.argmax(o >= L) if np.any(o >= L) else -1
            if j <= 0 or not np.isfinite(o[j - 1]):
                continue
            ta = np.exp(np.interp(L, [o[j - 1], o[j]], np.log([t[j - 1], t[j]])))
            xs.append(np.log(a)); ys.append(np.log(ta))
        if len(xs) < 3:
            rows.append((L, np.nan, np.nan, np.nan, len(xs)))
            continue
        (slope, icpt), cov = np.polyfit(xs, ys, 1, cov=True)
        rows.append((L, -slope, np.sqrt(cov[0, 0]), np.exp(icpt + slope * np.log(B.A_REF)), len(xs)))
    return np.array(rows)


def nqc_fraction(c):
    return B.quasi_condensate(c)[0] / np.trapezoid(B.Nk(c), c['k'])


def fig_clock(study_dir, label, model, model_full, data1, data2, ex_model, arrays, n_sub):
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.8))
    # collapse p: WKE (own exponents), measured series 1 and 2 (published exponents)
    ax = axes[0]
    res = {}
    for kind, curves, ex in (('wke', model, ex_model), ('series1', data1, None), ('series2', data2, None)):
        exd = ex or {k: v[0] for k, v in B.PUBLISHED.items()}
        w = B.in_window(curves)
        # a collapse across a needs at least three a with at least three curves each in the window
        if sum(len(v) >= 3 for v in by_a(w).values()) < 3:
            continue
        for j, reg in enumerate(('IR', 'UV')):
            r = B.fit_p(w, B.WINDOW[reg], exd[f'alpha_{reg}'], exd[f'beta_{reg}'], n_sub=n_sub)
            res[(kind, reg)] = r
            arrays[f'{kind}__p_{reg}'] = [r['p'], r['p_err']]
            arrays[f'{kind}__cost_{reg}'] = r['cost_grid']
            arrays['p_grid'] = r['p_grid']
    kinds = [('wke', label, 'D'), ('series1', 'measured, series 1', 'o'), ('series2', 'measured, series 2', 's')]
    for i, (kind, name, mk) in enumerate(kinds):
        for j, (reg, col) in enumerate((('IR', '#c0392b'), ('UV', '#3b6fb6'))):
            if (kind, reg) not in res:
                continue
            r = res[(kind, reg)]
            ax.errorbar([j + 0.15 * (i - 1)], [r['p']], [r['p_err']], marker=mk, ms=5, ls='', color=col,
                        mfc=col if kind == 'wke' else 'white', elinewidth=0.8, capsize=0)
    for j, reg in enumerate(('IR', 'UV')):
        v, e = B.PUBLISHED[f'p_{reg}']
        ax.plot([j - 0.3, j + 0.3], [v, v], **GUIDE)
    for y, name in ((2, 'p = 2: t ∝ 1/a² (bare WKE)'), (0, 'p = 0: independent of a')):
        ax.axhline(y, color='0.75', lw=0.7, ls=':')
        ax.annotate(name, (-0.45, y + 0.05), fontsize=7.5, color='0.4')
    ax.set(xticks=[0, 1], xticklabels=['IR', 'UV'], xlim=(-0.5, 1.5), ylim=(-0.4, 2.4), ylabel='p in t → t (a/300 a₀)^p',
           title='Best collapse of all a, t ā ∈ [20, 160] ms')
    h = [Line2D([], [], marker=mk, ls='', color='0.3', mfc='0.3' if kind == 'wke' else 'white', label=name) for kind, name, mk in kinds]
    h.append(Line2D([], [], lw=0.8, color='0.45', label='published p (grey bars)'))
    ax.legend(handles=h, loc='upper right', frameon=False, fontsize=7.5)
    # level clocks: p against the stage of the evolution
    ax = axes[1]
    for kind, curves, obs, levels, reg, mk in (
            ('wke', model_full, nqc_fraction, np.linspace(0.01, 0.4, 14), 'IR', '-'),
            ('wke', model_full, lambda c: B.temperatures(c)[0], np.linspace(12, 30, 13), 'UV', '-'),
            ('series2', data2, nqc_fraction, np.linspace(0.01, 0.4, 14), 'IR', 's'),
            ('series1', data1, lambda c: B.temperatures(c)[0], np.linspace(13, 24, 7), 'UV', 'o')):
        rows = level_clock(curves, obs, levels)
        if not len(rows):
            continue
        name = f'{kind}__level_{reg}'
        arrays[name + '__level'], arrays[name + '__p'], arrays[name + '__p_err'], arrays[name + '__stage_ms'], arrays[name + '__n_a'] = rows.T
        ok = np.isfinite(rows[:, 1])
        col = '#c0392b' if reg == 'IR' else '#3b6fb6'
        if kind == 'wke':
            ax.plot(rows[ok, 3], rows[ok, 1], color=col, lw=1.3,
                    label=f"{label}: {'N_QC/N' if reg == 'IR' else 'T_peak'} ({reg})")
        else:
            ax.errorbar(rows[ok, 3], rows[ok, 1], rows[ok, 2], marker=mk, ms=4, ls='', color=col, mfc='white',
                        elinewidth=0.8, capsize=0, label=f"measured {kind[-1]}: {'N_QC/N' if reg == 'IR' else 'T_peak'} ({reg})")
    for y in (2, 1, 0):
        ax.axhline(y, color='0.75', lw=0.7, ls=':')
    log_x(ax)
    ax.set(xlabel='stage: time at 300 a₀ when the level is reached (ms)', ylabel='p = −d ln t_level / d ln a', ylim=(-0.6, 2.6),
           title='Clock from the time each a reaches a level')
    ax.legend(loc='upper left', bbox_to_anchor=(1.02, 1), frameon=False, fontsize=7.5)
    fig.suptitle(f'Clock exponent: {label}', y=1.02)
    fig.tight_layout()
    return fig, res


def make(study_dir, study, runs, data_dir, n_sub=40):
    label = model_label(study, runs)
    model = [c for r in runs for c in B.run_curves(r)]
    model_ir = [dict(c, k=c['k'][c['k'] >= K_MIN], n=c['n'][c['k'] >= K_MIN]) for c in model
                if any(abs(c['t'] * c['a'] / B.A_REF - T) <= 1e-3 * T for T in COLLAPSE_T_ABAR)]
    data1, data2 = B.load_series(data_dir, 1), B.load_series(data_dir, 2)
    data = data1 + data2
    arrays = {}
    save(fig_spectra(study_dir, label, model, data1, arrays), study_dir, 'bidir_spectra', arrays)
    arrays = {}
    save(fig_temps(study_dir, label, model, data1, arrays), study_dir, 'bidir_temps', arrays)
    arrays = {}
    save(fig_condensate(study_dir, label, model, data2, arrays), study_dir, 'bidir_condensate', arrays)
    arrays = {}
    fig, em, ed = fig_exponents(study_dir, label, model_ir, data1, data_dir, arrays, n_sub)
    save(fig, study_dir, 'bidir_exponents', arrays)
    ex_model = mean_exponents(em)
    arrays = {}
    save(fig_collapse(study_dir, label, model_ir, data1, ex_model, arrays), study_dir, 'bidir_collapse', arrays)
    arrays = {}
    fig, res = fig_clock(study_dir, label, model_ir, model, data1, data2, ex_model, arrays, n_sub)
    save(fig, study_dir, 'bidir_clock', arrays)
    return dict(exponents_model=em, exponents_data=ed, mean_model=ex_model,
                p={f'{k}_{reg}': (v['p'], v['p_err']) for (k, reg), v in res.items()})

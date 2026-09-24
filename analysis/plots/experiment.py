"""Comparison with the published measurements of coherence spreading in a box of ³⁹K (13 series).

The data folder (not in the repository) holds datasets/overview.txt (series, t*, a, N, V, protocol),
datasets/series<s>.txt (t, n₀, ℓ², (ℓ/ξ)² and more), Fig3/Fig3.txt (D against na), Fig4/Fig4a_*.txt,
Fig4/Fig4c.txt and Fig1/Fig1d_<t>ms_<P>.txt (n_k at t − t*, series 1 to 3). The study's runs carry the
series number in their file name (s01_..., set by the study's run labels) and are the measured initial
states P1, P2, P3 at the series' a and n = N/V.

Conventions:
  - WKE ℓ³ = f₀/(η_eq n), η_eq the ideal-Bose condensed fraction (see ell.py). The published ℓ is
    normalised the same way at early times but carries a deconvolution; it is not undone here.
  - D and t* for both come from the same linear fit ℓ² = D (ħ/m)(t − t*) over (ℓ/ξ)² ∈ FIT_WINDOW,
    which reproduces the published D and t* from the published series.
  - Fig 1d times are t − t*; the published n_k is per volume, n_k = V f/(2π)³.
  - κ from n_k = A/(1 + (k/k₀)^κ), a least-squares fit in log space on k < k_ξ/3; its error is the
    fit error combined with half the spread over the cutoffs k_ξ/4 and k_ξ/2. Fits at the κ bounds, with
    k₀ too close to the cutoff, or with a large error are dropped.

Figures: experiment_rate (Fig 4c analogue: lin-log, log-log, lin-lin), experiment_D (Fig 3 analogue
and onset), experiment_collapse (Fig 4a, 4b analogues), experiment_kappa (IR shape and one n_k at
k_p ≪ k_ξ, matched in ℓ).
"""
import glob
import os
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm
from matplotlib.cm import ScalarMappable
from common import eta_eq, save, GUIDE

A0_UM = 5.29177210903e-5
TP = (2 * np.pi) ** 3
MARK = {'P1': 'o', 'P2': 's', 'P3': '^'}
FIT_WINDOW = (200, 1000)
D_GUIDE = 3.4
CUTS = [1 / 4, 1 / 3, 1 / 2]


def linfit(t, l2, x, hbar_m):
    m = (x >= FIT_WINDOW[0]) & (x <= FIT_WINDOW[1])
    if m.sum() < 3:
        return np.nan, np.nan
    p = np.polyfit(t[m], l2[m], 1)
    return p[0] / hbar_m, -p[1] / p[0]


def wke(r):
    p = r['points']; eta = eta_eq(r); hm = r['scales']['hbarOverM_um2_per_s']; xi = r['scales']['xi_um']
    t = np.array(p['t_s']); ell2 = np.array(p['ell_um']) ** 2 * eta ** (-2 / 3)
    rate = np.array(p['ellRate']) * eta ** (-2 / 3)
    x = ell2 / xi ** 2
    D, ts = linfit(t, ell2, x, hm)
    return dict(t=t, ell2=ell2, rate=rate, x=x, D=D, tstar=ts, eta=eta, xi=xi, txi=xi ** 2 / hm, hm=hm, ok=t > 0, r=r)


def ir_model(p, lk):
    return p[0] - np.logaddexp(0, p[2] * (lk - p[1]))


def lm(lk, y, w, p0, iters=300):
    """Weighted Levenberg-Marquardt for ln n = ln A − ln(1 + (k/k₀)^κ); returns p and its covariance."""
    p = np.array(p0, float); lam = 1e-3
    def jac(p):
        s = 0.5 * (1 + np.tanh(0.5 * p[2] * (lk - p[1])))
        return np.stack([np.ones_like(lk), p[2] * s, -(lk - p[1]) * s], 1)
    r = (y - ir_model(p, lk)) * w; cost = r @ r
    for _ in range(iters):
        J = jac(p) * w[:, None]; H = J.T @ J; g = J.T @ r
        step = np.linalg.lstsq(H + lam * np.diag(np.diag(H)) + 1e-12 * np.eye(3), g, rcond=None)[0]
        pn = p + step; pn[2] = np.clip(pn[2], 0.3, 15); rn = (y - ir_model(pn, lk)) * w; cn = rn @ rn
        if cn < cost:
            p, r, cost, lam = pn, rn, cn, lam / 3
            if np.abs(step).max() < 1e-10:
                break
        else:
            lam *= 5
    J = jac(p) * w[:, None]
    return p, np.linalg.pinv(J.T @ J) * cost / max(1, len(y) - 3)


def kappa(k, n, kxi, sig=None):
    """(κ, error) or None."""
    fits = []
    for c in CUTS:
        m = (k < c * kxi) & (n > 0)
        if m.sum() < 8:
            continue
        lk, y = np.log(k[m]), np.log(n[m])
        w = np.ones_like(y) if sig is None else 1 / np.clip(sig[m] / n[m], 0.02, None)
        try:
            p, cov = lm(lk, y, w, [y[:3].mean(), np.log(k[m][len(y) // 3]), 3.0])
        except np.linalg.LinAlgError:
            continue
        if np.exp(p[1]) < c * kxi / 1.5 and 0.5 < p[2] < 14:
            fits.append((c, p, np.sqrt(max(cov[2, 2], 0))))
    if len(fits) < 2:
        return None
    kaps = np.array([q[1][2] for q in fits])
    c, p, sk = ([q for q in fits if q[0] == 1 / 3] or fits)[0]
    return p[2], float(np.hypot(sk, 0.5 * (kaps.max() - kaps.min())))


def make(study_dir, study, runs, data):
    ov = {int(r[0]): dict(tstar=r[1], a=r[2], N=r[3], V=r[4])
          for r in np.loadtxt(f'{data}/datasets/overview.txt', skiprows=1, usecols=(0, 1, 2, 3, 4))}
    for line in open(f'{data}/datasets/overview.txt').read().splitlines()[1:]:
        ov[int(line.split()[0])]['P'] = line.split()[-1]
    for s in ov:
        ov[s]['na'] = ov[s]['N'] / ov[s]['V'] * ov[s]['a'] * A0_UM
    fig3 = {int(r[0]): (r[1], r[2], r[3]) for r in np.loadtxt(f'{data}/Fig3/Fig3.txt', skiprows=1)}

    def series(s):
        d = np.loadtxt(f'{data}/datasets/series{s}.txt', skiprows=1)
        return dict(t=d[:, 0], ell2=d[:, 7], ell2e=d[:, 8], x=d[:, 9], xe=d[:, 10], trel=d[:, 2])

    W = {}
    for r in runs:
        f = r.get('file', '')
        if f[:1] == 's' and f[1:3].isdigit():
            W[int(f[1:3])] = wke(r)
    if not W:
        print('  experiment: no runs labelled sNN_ (series number); skipped'); return
    label = next(iter(W.values()))['r']['settings']['modelLabel']
    kern = 'Bose +1' if next(iter(W.values()))['r']['settings'].get('kernel') == 'quantum' else 'classical'
    NA = LogNorm(min(v['na'] for v in ov.values()) * 0.9, max(v['na'] for v in ov.values()) * 1.1)
    col = lambda na: plt.get_cmap('viridis')(NA(na))
    cbar = lambda fig, axes: fig.colorbar(ScalarMappable(NA, 'viridis'), ax=axes, label='na (µm⁻²)', shrink=0.8)
    head = f'{label}, {kern}; WKE ℓ³ = f₀/(η_eq n); the published ℓ is deconvolved (not undone here)'

    # ---- rate against (ℓ/ξ)²: Fig 4c ----
    f4c = np.loadtxt(f'{data}/Fig4/Fig4c.txt', skiprows=1)
    arrays = {'exp__ell_over_xi_sq': f4c[:, 0], 'exp__rate': f4c[:, 1], 'exp__rate_err': f4c[:, 2]}
    for s, d in W.items():
        arrays[f's{s:02d}__ell_over_xi_sq'] = d['x'][d['ok']]; arrays[f's{s:02d}__rate'] = d['rate'][d['ok']]
    fig, axes = plt.subplots(1, 3, figsize=(19, 5.4), constrained_layout=True)
    for ax, mode in zip(axes, ('linlog', 'loglog', 'linlin')):
        for s, d in sorted(W.items()):
            ax.plot(d['x'][d['ok']], d['rate'][d['ok']], '-', color=col(ov[s]['na']), lw=1.2)
        ax.errorbar(f4c[:, 0], f4c[:, 1], f4c[:, 2], fmt='o', color='k', mfc='white', ms=5, elinewidth=.8, zorder=4,
                    label='experiment (Fig 4c)')
        ax.axvline(200, **GUIDE); ax.axhline(D_GUIDE, **GUIDE)
        if mode == 'linlin':
            ax.set_xlim(0, 1500); ax.set_ylim(0, 6)
        else:
            ax.set_xscale('log'); ax.set_xlim(1, 6000)
            if mode == 'loglog':
                ax.set_yscale('log'); ax.set_ylim(0.03, 20)
            else:
                ax.set_ylim(0, 6)
        ax.set_xlabel('(ℓ/ξ)²'); ax.set_ylabel('(m/ħ) dℓ²/dt'); ax.grid(alpha=.3, which='both')
        ax.set_title({'linlog': 'log (ℓ/ξ)²', 'loglog': 'log-log', 'linlin': 'lin-lin'}[mode])
    axes[0].plot([], [], '-', color='0.3', label=f'WKE, {len(W)} series')
    axes[0].legend(fontsize=8, frameon=False, loc='upper left')
    cbar(fig, axes)
    fig.suptitle(f'Coherence spreading rate against (ℓ/ξ)² (Fig 4c analogue). {head}. Guides: (ℓ/ξ)² = 200, {D_GUIDE}')
    save(fig, study_dir, 'experiment_rate', arrays)

    # ---- D against na, onset: Fig 3 ----
    arrays = {}
    fig, axes = plt.subplots(1, 3, figsize=(18, 5.2), constrained_layout=True)
    ax = axes[0]
    for s, (na, D, e) in fig3.items():
        ax.errorbar(na, D, e, fmt=MARK[ov[s]['P']], color='k', mfc='white', ms=6, elinewidth=.8)
    rows = []
    for s, d in sorted(W.items()):
        e = series(s)
        xs_exp = np.interp(ov[s]['tstar'], e['t'], e['x'])
        xs_wke = np.interp(d['tstar'], d['t'], d['x']) if np.isfinite(d['tstar']) else np.nan
        pk = np.nanmax(d['rate'][d['ok']]); x90 = d['x'][np.argmax(d['rate'] >= 0.9 * pk)]
        rows.append((s, d['D'], d['tstar'], xs_wke, x90))
        c = col(ov[s]['na'])
        axes[0].plot(ov[s]['na'], d['D'], MARK[ov[s]['P']], color=c, ms=7, mec='k', mew=.5)
        axes[0].annotate(str(s), (ov[s]['na'], d['D']), xytext=(4, 2), textcoords='offset points', fontsize=7)
        axes[1].plot(ov[s]['tstar'], d['tstar'], MARK[ov[s]['P']], color=c, ms=7, mec='k', mew=.5)
        axes[1].annotate(str(s), (ov[s]['tstar'], d['tstar']), xytext=(4, 2), textcoords='offset points', fontsize=7)
        axes[2].plot(ov[s]['na'], xs_exp, MARK[ov[s]['P']], color='k', mfc='white', ms=6)
        axes[2].plot(ov[s]['na'], xs_wke, MARK[ov[s]['P']], color=c, ms=7, mec='k', mew=.5)
        axes[2].plot(ov[s]['na'], x90, 'x', color=c, ms=7)
        for key, v in (('na', ov[s]['na']), ('D_wke', d['D']), ('D_exp', fig3.get(s, (0, np.nan, np.nan))[1]),
                       ('tstar_wke_s', d['tstar']), ('tstar_exp_s', ov[s]['tstar']), ('x_at_tstar_wke', xs_wke),
                       ('x_at_tstar_exp', xs_exp), ('x_rate90_wke', x90)):
            arrays[f's{s:02d}__{key}'] = v
    ax.set_xscale('log'); ax.set_ylim(0, 6); ax.axhline(D_GUIDE, **GUIDE)
    ax.set_xlabel('na (µm⁻²)'); ax.set_ylabel('D (ħ/m)'); ax.grid(alpha=.3, which='both')
    ax.set_title(f'D from ℓ² = D(ħ/m)(t − t*) over (ℓ/ξ)² ∈ {list(FIT_WINDOW)} (Fig 3 analogue)\nopen: experiment (Fig 3), filled: WKE')
    ax = axes[1]; lim = [0.001, 0.5]
    ax.plot(lim, lim, **GUIDE); ax.set_xlim(lim); ax.set_ylim(lim); ax.set_xscale('log'); ax.set_yscale('log')
    ax.grid(alpha=.3, which='both'); ax.set_xlabel('published t* (s)'); ax.set_ylabel('WKE t* (s)')
    ax.set_title('Onset time t* (line: equal)')
    ax = axes[2]
    ax.set_xscale('log'); ax.set_yscale('log'); ax.axhline(200, **GUIDE); ax.grid(alpha=.3, which='both')
    ax.set_xlabel('na (µm⁻²)'); ax.set_ylabel('(ℓ/ξ)²')
    ax.set_title('(ℓ/ξ)² at t* (open: experiment, filled: WKE);\n×: WKE rate reaches 90% of its maximum')
    cbar(fig, axes)
    fig.suptitle(f'{head}. Marker: protocol P1 ○, P2 □, P3 △; numbers: series')
    save(fig, study_dir, 'experiment_D', arrays)

    # ---- Fig 4a, 4b: ℓ² against t − t*, (ℓ/ξ)² against (t − t*)/t_ξ ----
    arrays = {}
    fig, axes = plt.subplots(1, 2, figsize=(15, 5.6), constrained_layout=True)
    ax = axes[0]
    for s, fn in ((9, '70a0'), (1, '100a0'), (5, '400a0')):
        path = f'{data}/Fig4/Fig4a_{fn}.txt'
        if not os.path.exists(path):
            continue
        e = np.loadtxt(path, skiprows=1); c = col(ov[s]['na'])
        ax.errorbar(e[:, 0], e[:, 1], e[:, 2], fmt='o', color=c, mfc='white', ms=4, elinewidth=.7, label=f'experiment {fn[:-2]} a₀ (series {s})')
        if s in W and np.isfinite(W[s]['tstar']):
            d = W[s]; ax.plot(d['t'] - d['tstar'], d['ell2'], '-', color=c, lw=1.4, label=f'WKE {fn[:-2]} a₀')
            arrays[f's{s:02d}__t_minus_tstar_s'] = d['t'] - d['tstar']; arrays[f's{s:02d}__ell2_um2'] = d['ell2']
    ax.set_xlim(-0.15, 0.2); ax.set_ylim(0, 1600); ax.grid(alpha=.3)
    ax.set_xlabel('t − t* (s)'); ax.set_ylabel('ℓ² (µm²)'); ax.legend(fontsize=8, frameon=False)
    ax.set_title('Fig 4a analogue (each curve shifted by its own t*)')
    ax = axes[1]
    for s in sorted(ov):
        e = series(s); c = col(ov[s]['na'])
        ax.plot(e['trel'], e['x'], MARK[ov[s]['P']], color=c, mfc='white', ms=3.5, mew=.8)
        if s in W and np.isfinite(W[s]['tstar']):
            d = W[s]; ax.plot((d['t'] - d['tstar']) / d['txi'], d['x'], '-', color=c, lw=1.2)
            arrays[f's{s:02d}__t_minus_tstar_over_txi'] = (d['t'] - d['tstar']) / d['txi']; arrays[f's{s:02d}__ell_over_xi_sq'] = d['x']
    tt = np.linspace(0, 700, 10); ax.plot(tt, D_GUIDE * tt, color='0.3', lw=.8, ls='--', label=f'(ℓ/ξ)² = {D_GUIDE} (t − t*)/t_ξ')
    ax.set_xlim(-200, 700); ax.set_ylim(0, 2500); ax.grid(alpha=.3)
    ax.set_xlabel('(t − t*)/t_ξ'); ax.set_ylabel('(ℓ/ξ)²'); ax.legend(fontsize=8, frameon=False)
    ax.set_title('Fig 4b analogue, all series: points experiment, lines WKE')
    cbar(fig, axes)
    fig.suptitle(f'{head}. t* from the linear fit of ℓ² over (ℓ/ξ)² ∈ {list(FIT_WINDOW)} for both')
    save(fig, study_dir, 'experiment_collapse', arrays)

    # ---- IR shape κ and one n_k at k_p ≪ k_ξ ----
    arrays = {}
    fig, axes = plt.subplots(1, 3, figsize=(18, 5.4), constrained_layout=True)
    for s, P in ((1, 'P1'), (2, 'P2'), (3, 'P3')):
        if s not in W:
            continue
        e = series(s); d = W[s]; kxi = 1 / d['xi']; c = col(ov[s]['na'])
        xe, ke, ee = [], [], []
        for f in glob.glob(f'{data}/Fig1/Fig1d_*ms_{P}.txt'):
            t = int(os.path.basename(f).split('_')[1][:-2]) / 1e3 + ov[s]['tstar']
            k, n, sg = np.loadtxt(f, skiprows=1).T
            q = kappa(k, n, kxi, sg)
            if q and q[1] < 0.5:
                xe.append(np.interp(t, e['t'], e['x'])); ke.append(q[0]); ee.append(q[1])
        axes[0].errorbar(xe, ke, ee, fmt=MARK[P], color='k', mfc='white', ms=5, elinewidth=.7, label=f'experiment {P} (Fig 1d)')
        sn = d['r']['snapshots']; k = np.array(sn['k_um_inv'])
        xs, ks, es = [], [], []
        for j in range(1, len(sn['n_k'])):
            if sn['X'][j] < 2:
                continue
            q = kappa(k, np.array(sn['n_k'][j]), kxi)
            if q and q[1] < 0.25:
                xs.append(np.interp(sn['t_s'][j], d['t'], d['x'])); ks.append(q[0]); es.append(q[1])
        axes[0].errorbar(xs, ks, es, fmt=MARK[P] + '-', color=c, ms=4, lw=.8, elinewidth=.6, label=f'WKE {P}')
        arrays.update({f'exp_{P}__ell_over_xi_sq': xe, f'exp_{P}__kappa': ke, f'exp_{P}__kappa_err': ee,
                       f's{s:02d}__ell_over_xi_sq': xs, f's{s:02d}__kappa': ks, f's{s:02d}__kappa_err': es})
    ax = axes[0]
    ax.set_xscale('log'); ax.set_ylim(0, 6); ax.grid(alpha=.3, which='both'); ax.legend(fontsize=7, frameon=False, ncol=2)
    ax.set_xlabel('(ℓ/ξ)² (experiment: its series at t* + (t − t*) of Fig 1d)'); ax.set_ylabel('κ')
    ax.set_title('IR shape n_k ∝ 1/(1 + (k/k₀)^κ), 100 a₀; fit on k < k_ξ/3,\nerror ⊕ half the spread over k_ξ/4 to k_ξ/2')
    ax = axes[1]
    for s, d in sorted(W.items()):
        sn = d['r']['snapshots']; q = kappa(np.array(sn['k_um_inv']), np.array(sn['n_k'][-1]), 1 / d['xi'])
        if q and q[1] < 0.25:
            ax.errorbar(ov[s]['na'], q[0], q[1], fmt=MARK[ov[s]['P']], color=col(ov[s]['na']), ms=7, mec='k', mew=.5)
            arrays[f's{s:02d}__kappa_last'] = q[0]; arrays[f's{s:02d}__kappa_last_err'] = q[1]
    for s, P, dx in ((1, 'P1', 1.0), (2, 'P2', 1.04), (3, 'P3', 0.96)):
        fs = sorted(glob.glob(f'{data}/Fig1/Fig1d_*ms_{P}.txt'), key=lambda f: int(os.path.basename(f).split('_')[1][:-2]))
        if s in W and fs:
            k, n, sg = np.loadtxt(fs[-1], skiprows=1).T; q = kappa(k, n, 1 / W[s]['xi'], sg)
            if q:
                ax.errorbar(ov[s]['na'] * dx, q[0], q[1], fmt=MARK[P], color='k', mfc='white', ms=6)
                arrays[f'exp_{P}__kappa_last'] = q[0]; arrays[f'exp_{P}__kappa_last_err'] = q[1]
    ax.set_xscale('log'); ax.set_ylim(0, 6); ax.grid(alpha=.3, which='both')
    ax.set_xlabel('na (µm⁻²)'); ax.set_ylabel('κ at the end')
    ax.set_title('κ at the last WKE snapshot (filled) and the last Fig 1d spectrum (open)')
    ax = axes[2]
    if 1 in W:
        s = 1; d = W[s]; e = series(s)
        f = sorted(glob.glob(f'{data}/Fig1/Fig1d_*ms_P1.txt'), key=lambda f: int(os.path.basename(f).split('_')[1][:-2]))[-1]
        tl = int(os.path.basename(f).split('_')[1][:-2]) / 1e3
        k, n, sg = np.loadtxt(f, skiprows=1).T
        x_exp = np.interp(tl + ov[s]['tstar'], e['t'], e['x'])
        ax.errorbar(k, n, sg, fmt='o', color='k', mfc='white', ms=3.5, elinewidth=.6,
                    label=f'experiment P1 100 a₀, t − t* = {tl*1e3:.0f} ms, (ℓ/ξ)² = {x_exp:.0f}')
        sn = d['r']['snapshots']; kk = np.array(sn['k_um_inv']); ts = np.array(sn['t_s'])
        F = np.log(np.clip(np.array(sn['n_k']), 1e-300, None)); xsn = np.interp(ts, d['t'], d['x'])
        arrays.update({'exp_P1_last__k_um_inv': k, 'exp_P1_last__nk_um3': n, 'exp_P1_last__nk_err': sg})
        if xsn[-1] >= x_exp:
            j = int(np.clip(np.searchsorted(xsn, x_exp), 1, len(ts) - 1))
            w = (np.log(x_exp) - np.log(xsn[j - 1])) / (np.log(xsn[j]) - np.log(xsn[j - 1]))
            fk = np.exp((1 - w) * F[j - 1] + w * F[j]); tm = (1 - w) * ts[j - 1] + w * ts[j]
            V = ov[s]['V']
            ax.plot(kk, V * fk / TP, '-', color=col(ov[s]['na']), lw=1.5, label=f'WKE at the same (ℓ/ξ)² (t − t* = {(tm - d["tstar"])*1e3:.0f} ms)')
            arrays.update({'s01_matched__k_um_inv': kk, 's01_matched__nk_um3': V * fk / TP})
        ax.axvline(1 / d['xi'], **GUIDE)
        ax.annotate('k_ξ', (1 / d['xi'], 2e3), xytext=(3, 0), textcoords='offset points', fontsize=8)
    ax.set_xscale('log'); ax.set_yscale('log'); ax.set_xlim(0.015, 2); ax.set_ylim(1e3, 3e7); ax.grid(alpha=.3, which='both')
    ax.set_xlabel('k (µm⁻¹)'); ax.set_ylabel('n_k = V f/(2π)³ (µm³)'); ax.legend(fontsize=7.5, frameon=False)
    ax.set_title('n_k at k_p ≪ k_ξ, matched in ℓ (not in t)')
    fig.suptitle(f'IR shape against the measured spectra. {head}')
    save(fig, study_dir, 'experiment_kappa', arrays)

    print('   s   D WKE  D exp   t* WKE (ms)  t* exp (ms)')
    for s, D, ts, xw, x90 in rows:
        print(f'  {s:2d}  {D:5.2f}  {fig3.get(s, (0, np.nan))[1]:5.2f}  {ts*1e3:9.1f}  {ov[s]["tstar"]*1e3:9.1f}')

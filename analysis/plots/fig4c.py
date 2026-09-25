"""Fig 4c analogue: (m/ħ) dℓ²/dt against (ℓ/ξ)², pooled over the published series.

Each series' WKE rate (from the collision term) and (ℓ/ξ)² are sampled at that series' own measured
times (datasets/series<s>.txt, column t, counted from the switch-on of a like the WKE clock), so the
pooling weights series and stages as the measurement does; samples past the end of a run are dropped.
The pooled samples are binned with edges halfway between the 15 published (ℓ/ξ)² values of
Fig4/Fig4c.txt (outer edges mirrored); a point is the mean of x and of the rate in its bin, its error
the standard error of the mean. Bins with fewer than MIN_SAMPLES samples are dropped; past the
published range the bins continue at the last published spacing up to XMAX.

The WKE has no box: a run can go past ℓ³ = V, i.e. (ℓ/ξ)² = 8π na V^(2/3), where the measured ℓ saturates.
Filled points pool only samples inside that ceiling, open points all samples; per-series curves turn
dotted past it.

Guides as in the paper: exponential growth ℓ² ∝ exp(t/τ), τ = 56 t_ξ, i.e. rate = (ℓ/ξ)²/56 (solid),
and D = 3.4 (dashed).

Left: WKE only. Right: WKE, the published points and the per-series WKE curves (colour: na).

fig4c_kp is the same figure with ℓ replaced by 1/k_p: (m/ħ) d(1/k_p²)/dt against (1/(k_p ξ))² = (k_ξ/k_p)²,
k_p the wide peak of N_k ∝ k² n_k (run.ts fields kpw_um_inv, kpwRate: a parabola of ln N_k over the
contiguous top N_k ≳ max/2, its rate from the collision term); the bins are uniform.
c in ℓ = c/k_p is fitted on the WKE alone (fit_c: ℓ² = c²/k_p² per series over (ℓ/ξ)² ≥ 200 inside the box,
mean over the series). Everything taken over from the ℓ figure is rescaled with this one c, since k_p = c/ℓ
scales both axes by 1/c²: the published points go to (x/c², rate/c²), D to D/c², the exponential guide
rate = x/56 is unchanged, and the box ceiling is k_p = c/V^(1/3).

fig4_mod is the ℓ figure with the WKE taken through k_p instead of f(k→0): x = c² (k_ξ/k_p)², rate =
c² (m/ħ) d(1/k_p²)/dt, with the same c; the published points and guides are unchanged.
(experiment_kp, the k_p of the measured Fig 1d spectra, is used only by kp_extraction.py.)

fig4c_mod2 is the ℓ figure with η_eq recomputed at every sample from the drifting particle number and
energy (ell_drift_corrected), since the solver does not conserve them exactly (E/N drifts by up to ~40%
at high a); everything else as in fig4c.

Series in EXCLUDE (series 8 and 10, the two low-N series) are left out of every variant, except
fig4c_all_sets, which is fig4c with every series. fig4c_resc is fig4c with the WKE rates divided by
RESCALE; the published points and guides are unchanged.

fig4c_mod3 takes η(t) from the spectra instead (eta_from_tail: a μ = 0 Bose-Einstein fit of the thermal tail
at every snapshot, η = 1 − n_th/n); fig4c_mod3_eta shows η(t), T(t) and the fit quality per series.
"""
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm
from matplotlib.cm import ScalarMappable
from matplotlib.lines import Line2D
import copy
from common import save, eta_eq
from experiment import wke, A0_UM

TAU_XI = 56
D_GUIDE = 3.4
MIN_SAMPLES = 2
XMAX = 2100
EDGE, FILL = '#2b3f7f', '#c3cadb'
STYLE = {'font.family': 'serif', 'font.serif': ['Times New Roman'], 'mathtext.fontset': 'stix', 'font.size': 11,
         'axes.titlesize': 10}


def edges_from(centres):
    mid = 0.5 * (centres[1:] + centres[:-1])
    return np.concatenate([[max(0.0, 2 * centres[0] - mid[0])], mid, [2 * centres[-1] - mid[-1]]])


def binned(x, y, edges):
    """Bin means of x and y, standard error of y, sample count; bins below MIN_SAMPLES dropped."""
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (x >= lo) & (x < hi) & np.isfinite(y)
        if m.sum() >= MIN_SAMPLES:
            out.append((x[m].mean(), y[m].mean(), y[m].std(ddof=1) / np.sqrt(m.sum()), m.sum()))
    return np.array(out).reshape(-1, 4).T


def sampled(d, t_exp):
    """WKE (ℓ/ξ)² and rate at the measured times inside the run."""
    t, ok = d['t'], d['ok'] & np.isfinite(d['rate'])
    ts = t_exp[(t_exp >= t[ok][0]) & (t_exp <= t[ok][-1])]
    return np.interp(ts, t[ok], d['x'][ok]), np.interp(ts, t[ok], d['rate'][ok])


def wide_fit(k, N, frac=0.5):
    """Python twin of run.ts kpWide: k_p, the window (lo, hi) and the parabola coefficients in (ln k, ln N_k)."""
    i = int(np.argmax(N)); floor = (frac - 0.1) * N[i]; lo = hi = i
    while lo > 0 and N[lo - 1] > floor: lo -= 1
    while hi < len(k) - 1 and N[hi + 1] > floor: hi += 1
    x = np.log(k[lo:hi + 1]); y = np.log(N[lo:hi + 1]); w = np.minimum(1, (N[lo:hi + 1] - floor) / (0.2 * N[i]))
    c = np.polyfit(x, y, 2, w=np.sqrt(w))
    kp = np.exp(np.clip(-c[1] / (2 * c[0]), x[0], x[-1])) if c[0] < 0 else k[i]
    return kp, lo, hi, c


def experiment_kp(data):
    """k_p of every Fig 1d spectrum (series 1 to 3), c = median k_p ℓ, and rates from 3-spectrum linear fits."""
    import glob, os
    ov = {int(r[0]): r for r in np.loadtxt(f'{data}/datasets/overview.txt', skiprows=1, usecols=(0, 1, 2, 3, 4))}
    HBAR_M = 1.054571817e-34 / (38.9637064864 * 1.66053906660e-27) * 1e12  # ³⁹K, µm²/s
    spectra, rates = [], []
    for s, P in ((1, 'P1'), (2, 'P2'), (3, 'P3')):
        e = np.loadtxt(f'{data}/datasets/series{s}.txt', skiprows=1)
        xi = 1 / np.sqrt(8 * np.pi * ov[s][3] / ov[s][4] * ov[s][2] * A0_UM)
        fs = sorted(glob.glob(f'{data}/Fig1/Fig1d_*ms_{P}.txt'), key=lambda f: int(os.path.basename(f).split('_')[1][:-2]))
        rows = []
        for f in fs:
            t = int(os.path.basename(f).split('_')[1][:-2]) / 1e3 + ov[s][1]
            k, n, _ = np.loadtxt(f, skiprows=1).T
            N = 4 * np.pi * k ** 2 * np.clip(n, 1e-30, None)
            kp, kp7 = wide_fit(k, N)[0], wide_fit(k, N, 0.7)[0]
            ell = np.sqrt(np.interp(t, e[:, 0], e[:, 7]))
            rows.append((t, kp, abs(kp7 - kp), ell, xi))
        rows = np.array(rows); spectra.append((s, P, rows))
        for j in range(1, len(rows) - 1):
            t, y = rows[j - 1:j + 2, 0], 1 / rows[j - 1:j + 2, 1] ** 2
            p = np.polyfit(t, y, 1)
            # slope error from the scatter about the line (3 points, 1 degree of freedom)
            err = np.sqrt(np.sum((y - np.polyval(p, t)) ** 2) / np.sum((t - t.mean()) ** 2))
            rates.append((np.mean(y) / xi ** 2, p[0] / HBAR_M, err / HBAR_M, s))
    cs = np.concatenate([r[:, 1] * r[:, 3] for _, _, r in spectra])
    return spectra, np.array(rates), float(np.median(cs)), float(np.std(cs) / np.sqrt(len(cs)))


def fit_c(runs, data):
    """c in ℓ = c/k_p, fitted on the WKE alone: per series, least squares ℓ² = c² (1/k_p²) through the origin over the
    samples with (ℓ/ξ)² ≥ 200 inside the box (ℓ³ ≤ V); c is the mean over the series, its error their standard error."""
    ov = {int(r[0]): r for r in np.loadtxt(f'{data}/datasets/overview.txt', skiprows=1, usecols=(0, 1, 2, 3, 4))}
    per = {}
    for r in runs:
        f = r.get('file', '')
        if not (f[:1] == 's' and f[1:3].isdigit()) or 'kpw_um_inv' not in r['points']:
            continue
        s = int(f[1:3]); d = wke(r); u = 1 / np.array(r['points']['kpw_um_inv']) ** 2
        m = d['ok'] & (d['x'] >= 200) & (d['ell2'] <= ov[s][4] ** (2 / 3))
        if m.sum() >= 3:
            per[s] = np.sqrt(np.sum(d['ell2'][m] * u[m]) / np.sum(u[m] ** 2))
    v = np.array(list(per.values()))
    return float(v.mean()), float(v.std(ddof=1) / np.sqrt(len(v))), per


def ell_drift_corrected(r, d):
    """ℓ² and (m/ħ) dℓ²/dt with η_eq recomputed at every sample from the drifting n(t) = n N_rel and
    E/N(t) = E/N · E_rel/N_rel: ℓ³ = f₀/(η_eq(t) n(t)) = ℓ̄³/(η_eq(t) N_rel), and
    (m/ħ) dℓ²/dt = ℓ² [(m/ħ) dℓ̄²/dt / ℓ̄² − (2/3)(m/ħ) d ln(η_eq N_rel)/dt], the first term from the collision
    term (run.ts ellRate), the second by finite differences of the recorded drift."""
    p = r['points']; Nr = np.array(p['N_rel']); Er = np.array(p['E_rel'])
    eta = np.empty(len(Nr))
    for i in range(len(Nr)):
        q = copy.deepcopy({'settings': r['settings'], 'scales': r['scales'], 'initial': r['initial']})
        q['settings']['density_um3'] *= Nr[i]; q['initial']['EN_nK'] *= Er[i] / Nr[i]
        eta[i] = eta_eq(q)
    ellbar2 = np.array(p['ell_um']) ** 2
    ell2 = ellbar2 * (eta * Nr) ** (-2 / 3)
    t = np.array(p['t_s']); hm = r['scales']['hbarOverM_um2_per_s']
    dln = np.gradient(np.log(eta * Nr), t)
    rate = ell2 * (np.array(p['ellRate']) / ellbar2 - (2 / 3) * dln / hm)
    return ell2, rate, eta, Nr, Er


HBAR_JS, KB_JK, ZETA32 = 1.054571817e-34, 1.380649e-23, 2.6123753486854883
TAIL_F = (0.05, 5.0)


def eta_from_tail(r):
    """η(t) from the spectra: at every snapshot, fit a μ = 0 Bose-Einstein tail f = 1/(exp(ħ²k²/(2m k_B T)) − 1),
    i.e. ln(1 + 1/f) = a k² through the origin, over the grid points with TAIL_F[0] < f < TAIL_F[1] (thermal, neither
    Rayleigh-Jeans nor the UV cutoff); T = ħ (ħ/m)/(2 k_B a), n_th = ζ(3/2)/λ_T³, η = 1 − n_th/(n N_rel).
    Returns snapshot times, η, T (nK) and the rms of the fit in ln(1 + 1/f)."""
    sn = r['snapshots']; k = np.array(sn['k_um_inv']); hm = r['scales']['hbarOverM_um2_per_s']
    n = r['settings']['density_um3']; out = []
    for j, t in enumerate(sn['t_s']):
        f = np.array(sn['n_k'][j]); m = (f > TAIL_F[0]) & (f < TAIL_F[1])
        if m.sum() < 4:
            out.append((t, np.nan, np.nan, np.nan)); continue
        y, x = np.log1p(1 / f[m]), k[m] ** 2
        a = np.sum(x * y) / np.sum(x * x)
        T = hm * HBAR_JS / (2 * KB_JK * a)                        # K; a in µm², ħ/m in µm²/s
        lam = np.sqrt(2 * np.pi * HBAR_JS * hm / (KB_JK * T))     # µm
        eta = 1 - ZETA32 / lam ** 3 / (n * sn['N_rel'][j])
        out.append((t, eta, T * 1e9, np.sqrt(np.mean((y - a * x) ** 2))))
    return np.array(out).T


def ell_tail_eta(r, d):
    """ℓ³ = f₀/(η(t) n(t)) with η(t) from the thermal tail (eta_from_tail) interpolated in t between snapshots
    (snapshots before the tail is thermal, η ≤ 0.02 or a poor fit, are dropped); the rate gets
    −(2/3) ℓ² (m/ħ) d ln(η n)/dt with the derivative taken on the snapshot grid and interpolated."""
    ts, eta_s, T_s, rms = eta_from_tail(r)
    good = np.isfinite(eta_s) & (eta_s > 0.02) & (rms < 0.1)
    p = r['points']; t = np.array(p['t_s']); Nr = np.array(p['N_rel'])
    ln_eta = np.interp(t, ts[good], np.log(eta_s[good]), left=np.nan)
    dln_eta = np.interp(t, ts[good], np.gradient(np.log(eta_s[good]), ts[good]), left=np.nan)
    eta = np.exp(ln_eta)
    ellbar2 = np.array(p['ell_um']) ** 2
    ell2 = ellbar2 * (eta * Nr) ** (-2 / 3)
    hm = r['scales']['hbarOverM_um2_per_s']
    rate = ell2 * (np.array(p['ellRate']) / ellbar2 - (2 / 3) * (dln_eta + np.gradient(np.log(Nr), t)) / hm)
    return ell2, rate, eta, (ts, eta_s, T_s, rms, good)


# series left out of every Fig 4 variant: the two low-N series, 8 (N = 7×10⁴ in the standard box, n = 1.26 µm⁻³
# against ≈ 5.4) and 10 (N = 8.5×10⁴ in the small box, V = 15900 µm³)
EXCLUDE = {8, 10}
RESCALE = 3.3


def make(study_dir, study, runs, data):
    # fig4c_all_sets: fig4c with every series, EXCLUDE included
    figure(study_dir, runs, data, 'ell', name_override='fig4c_all_sets')
    runs = [r for r in runs if not (r.get('file', '')[:1] == 's' and r['file'][1:3].isdigit() and int(r['file'][1:3]) in EXCLUDE)]
    fig_kind = ['ell', 'mod2', 'mod3']
    if all('kpw_um_inv' in r['points'] for r in runs if r.get('file', '')[:1] == 's'):
        fig_kind += ['kp', 'mod']
    else:
        print('  fig4c_kp, fig4_mod: runs have no wide peak k_p (kpw_um_inv); skipped')
    for kind in fig_kind:
        figure(study_dir, runs, data, kind)
    # fig4c_resc: fig4c with the WKE rates divided by RESCALE (published points and guides unchanged)
    figure(study_dir, runs, data, 'ell', name_override='fig4c_resc', yscale=RESCALE)
    eta_figure(study_dir, runs, data)


def eta_figure(study_dir, runs, data):
    """fig4c_mod3_eta: η(t) from the thermal tail against η_eq (initial, and recomputed from the drift), T(t),
    and the rms of the tail fit, per series (colour: na)."""
    ov = {int(r[0]): r for r in np.loadtxt(f'{data}/datasets/overview.txt', skiprows=1, usecols=(0, 1, 2, 3, 4))}
    na = {s: o[3] / o[4] * o[2] * A0_UM for s, o in ov.items()}
    NA = LogNorm(min(na.values()) * 0.9, max(na.values()) * 1.1); cmap = plt.get_cmap('viridis')
    arrays = {}
    with plt.rc_context(STYLE):
        fig, axes = plt.subplots(1, 3, figsize=(15, 4.6), constrained_layout=True)
        for r in runs:
            f = r.get('file', '')
            if not (f[:1] == 's' and f[1:3].isdigit()):
                continue
            s = int(f[1:3]); c = cmap(NA(na[s])); d = wke(r)
            ts, es, Ts, rms = eta_from_tail(r)
            good = np.isfinite(es) & (es > 0.02) & (rms < 0.1)
            _, _, eta_drift, _, _ = ell_drift_corrected(r, d)
            t = np.array(r['points']['t_s'])
            axes[0].plot(ts[good] * 1e3, es[good], 'o-', ms=2.5, lw=0.9, color=c)
            axes[0].plot(t * 1e3, eta_drift, ':', lw=0.9, color=c)
            axes[0].plot([0, t[-1] * 1e3], [d['eta']] * 2, '-', lw=0.6, color=c, alpha=0.5)
            axes[1].plot(ts[good] * 1e3, Ts[good], 'o-', ms=2.5, lw=0.9, color=c)
            axes[2].plot(ts * 1e3, rms, 'o-', ms=2.5, lw=0.9, color=c)
            arrays.update({f's{s:02d}__tail_t_s': ts, f's{s:02d}__tail_eta': es, f's{s:02d}__tail_T_nK': Ts, f's{s:02d}__tail_rms': rms,
                           f's{s:02d}__tail_used': good, f's{s:02d}__t_s': t, f's{s:02d}__eta_eq_drift': eta_drift, f's{s:02d}__eta_eq_initial': d['eta']})
        for ax in axes:
            ax.set_xscale('log'); ax.set_xlabel('t (ms)')
        axes[0].set_ylim(0, 1); axes[0].set_ylabel(r'$\eta$')
        axes[0].set_title(r'$\eta(t)$ from the tail (points), $\eta_{\rm eq}$ from the drift (dotted), initial $\eta_{\rm eq}$ (thin)')
        axes[1].set_ylabel(r'$T$ (nK)'); axes[1].set_ylim(0, None); axes[1].set_title(r'$T$ of the $\mu = 0$ Bose-Einstein tail fit')
        axes[2].set_yscale('log'); axes[2].set_ylabel(r'rms of $\ln(1 + 1/f) - a k^2$')
        axes[2].axhline(0.1, color='0.45', lw=0.8); axes[2].set_title('tail fit quality (snapshots above the line are not used)')
        fig.colorbar(ScalarMappable(NA, 'viridis'), ax=axes[2], label=r'$na$ (µm$^{-2}$)', shrink=0.8)
        fig.suptitle(rf'Condensed fraction from the thermal tail: $\mu = 0$ Bose-Einstein fit over ${TAIL_F[0]} < f < {TAIL_F[1]}$', fontsize=10)
        save(fig, study_dir, 'fig4c_mod3_eta', arrays)


def figure(study_dir, runs, data, kind, name_override=None, yscale=1.0):
    """kind 'ell': WKE ℓ; 'kp': WKE k_p against published ℓ rescaled by 1/c²; 'mod': WKE c/k_p against published ℓ."""
    c_fit, c_err, c_per = fit_c(runs, data) if kind in ('kp', 'mod') else (1.0, 0.0, {})
    c2 = c_fit ** 2
    W = {}
    for r in runs:
        f = r.get('file', '')
        if f[:1] == 's' and f[1:3].isdigit():
            d = wke(r)
            if kind == 'mod3':
                ell2, rate, eta_t, tail = ell_tail_eta(r, d)
                d = dict(d, ell2=ell2, rate=rate, x=ell2 / d['xi'] ** 2, eta_t=eta_t, tail=tail,
                         ok=d['ok'] & np.isfinite(ell2) & np.isfinite(rate))
            elif kind == 'mod2':
                ell2, rate, eta_t, Nr, Er = ell_drift_corrected(r, d)
                d = dict(d, ell2=ell2, rate=rate, x=ell2 / d['xi'] ** 2, eta_t=eta_t, N_rel=Nr, E_rel=Er)
            elif kind != 'ell':
                p = r['points']
                # k_p plane: x = (k_ξ/k_p)², rate = (m/ħ) d(1/k_p²)/dt; 'mod' maps it to the ℓ plane with ℓ = c/k_p
                sc_ = 1.0 if kind == 'kp' else c2
                d = dict(d, x=sc_ * (r['scales']['kXi_um_inv'] / np.array(p['kpw_um_inv'])) ** 2, rate=sc_ * np.array(p['kpwRate'], float))
            if yscale != 1.0:
                d = dict(d, rate=d['rate'] / yscale)
            W[int(f[1:3])] = d
    if not W:
        print('  fig4c: no runs labelled sNN_ (series number); skipped'); return
    ov = {int(r[0]): r for r in np.loadtxt(f'{data}/datasets/overview.txt', skiprows=1, usecols=(0, 1, 2, 3, 4))}
    na = {s: o[3] / o[4] * o[2] * A0_UM for s, o in ov.items()}
    f4c = np.loadtxt(f'{data}/Fig4/Fig4c.txt', skiprows=1)
    cnote = rf'$c = {c_fit:.2f} \pm {c_err:.2f}$ from the WKE alone ($\ell^2 = c^2/k_p^2$, $(\ell/\xi)^2 \geq 200$)'
    if kind in ('ell', 'mod', 'mod2', 'mod3'):
        # box ceiling: ℓ³ ≤ V, so (ℓ/ξ)² ≤ 8π na V^(2/3); for 'mod' ℓ = c/k_p
        ceil = {s: 8 * np.pi * na[s] * ov[s][4] ** (2 / 3) for s in ov}
        xmax = XMAX
        edges = edges_from(f4c[:, 0])
        step = edges[-1] - edges[-2]
        edges = np.concatenate([edges, edges[-1] + step * np.arange(1, int((xmax - edges[-1]) / step) + 1)])
        q, ticks = 'ell_over_xi_sq', [0, 600, 1200, 1800]
        xlab, ylab = r'$(\ell/\xi)^2$', r'$\dfrac{m}{\hbar}\,\dfrac{\mathrm{d}\ell^2}{\mathrm{d}t}$'
        box = r'$\ell^3 \leq V$', r'same, past $\ell^3 = V$'
        if kind == 'mod3':
            name, note = 'fig4c_mod3', (r'$\ell^3 = f_0/(\eta(t)\, n(t))$, $\eta(t)$ from a $\mu = 0$ Bose-Einstein fit of the thermal tail '
                                        r'($0.05 < f < 5$) at every snapshot; the published $\ell$ carries a deconvolution that is not undone')
        elif kind == 'mod2':
            name, note = 'fig4c_mod2', (r'$\ell^3 = f_0/(\eta_{\rm eq}(t)\, n(t))$, $\eta_{\rm eq}$ and $n$ recomputed from the drifting '
                                        r'$N$ and $E$ at every sample; the published $\ell$ carries a deconvolution that is not undone')
        elif kind == 'ell':
            name, note = 'fig4c', r'$\ell^3 = f_0/(\eta_{\rm eq} n)$; the published $\ell$ carries a deconvolution that is not undone'
        else:
            name, note = 'fig4_mod', r'WKE through $k_p$: $\ell = c/k_p$, $k_p$ the peak of $N_k \propto k^2 n_k$; ' + cnote
            box = r'$c/k_p \leq V^{1/3}$', r'same, past $c/k_p = V^{1/3}$'
    else:
        # box ceiling: ℓ³ ≤ V with ℓ = c/k_p, so (k_ξ/k_p)² ≤ (V^(1/3)/(c ξ))²
        ceil = {s: (ov[s][4] ** (1 / 3) / (c_fit * W[s]['xi'])) ** 2 for s in W}
        xmax = 1.05 * max(d['x'][d['ok']].max() for d in W.values())
        edges = np.linspace(0, xmax, 17)
        q, name, ticks = 'inv_kp_xi_sq', 'fig4c_kp', None
        xlab, ylab = r'$(1/k_p\xi)^2$', r'$\dfrac{m}{\hbar}\,\dfrac{\mathrm{d}k_p^{-2}}{\mathrm{d}t}$'
        box = rf'$k_p \geq {c_fit:.2f}/V^{{1/3}}$', rf'same, past $k_p = {c_fit:.2f}/V^{{1/3}}$'
        note = r'$k_p$ the peak of $N_k \propto k^2 n_k$; published points and $D$ rescaled by $1/c^2$, ' + cnote

    xs, ys, inbox, arrays = [], [], [], {}
    for s, d in sorted(W.items()):
        t_exp = np.loadtxt(f'{data}/datasets/series{s}.txt', skiprows=1)[:, 0]
        x, y = sampled(d, t_exp)
        xs.append(x); ys.append(y); inbox.append(x <= ceil[s])
        arrays[f's{s:02d}__samples_{q}'] = x; arrays[f's{s:02d}__samples_rate'] = y
        arrays[f's{s:02d}__{q}'] = d['x'][d['ok']]; arrays[f's{s:02d}__rate'] = d['rate'][d['ok']]
        arrays[f's{s:02d}__box_ceiling_{q}'] = ceil[s]
        if kind == 'mod3':
            ts_, es_, Ts_, rms_, good_ = d['tail']
            arrays.update({f's{s:02d}__tail_t_s': ts_, f's{s:02d}__tail_eta': es_, f's{s:02d}__tail_T_nK': Ts_,
                           f's{s:02d}__tail_rms': rms_, f's{s:02d}__tail_used': good_})
        if kind == 'mod2':
            arrays[f's{s:02d}__eta_eq_t'] = d['eta_t'][d['ok']]; arrays[f's{s:02d}__N_rel'] = d['N_rel'][d['ok']]
            arrays[f's{s:02d}__E_rel'] = d['E_rel'][d['ok']]
        if s in c_per:
            arrays[f's{s:02d}__c_fit'] = c_per[s]
    xs, ys, inbox = np.concatenate(xs), np.concatenate(ys), np.concatenate(inbox)
    bx, by, be, bn = binned(xs[inbox], ys[inbox], edges)
    ax_, ay_, ae_, an_ = binned(xs, ys, edges)
    arrays.update({f'wke__{q}': bx, 'wke__rate': by, 'wke__rate_err': be, 'wke__n_samples': bn,
                   f'wke_all__{q}': ax_, 'wke_all__rate': ay_, 'wke_all__rate_err': ae_, 'wke_all__n_samples': an_,
                   'bin_edges': edges})
    Dg, px, py, pe = D_GUIDE, f4c[:, 0], f4c[:, 1], f4c[:, 2]
    if kind == 'kp':
        Dg, px, py, pe = D_GUIDE / c2, px / c2, py / c2, pe / c2
    if kind in ('kp', 'mod'):
        arrays.update({'c_fit': c_fit, 'c_fit_err': c_err})
    arrays.update({f'exp__{q}': px, 'exp__rate': py, 'exp__rate_err': pe})
    gx = np.array([0, xmax])
    arrays.update({'guide__exponential_x': gx, 'guide__exponential_rate': gx / TAU_XI, 'guide__D': Dg})

    label = next(iter(W.values()))['r']['settings']
    kern = 'Bose +1' if label.get('kernel') == 'quantum' else 'classical'
    if kind == 'kp':
        ytop = 1.25 * max(np.nanmax(ay_ + ae_), np.nanmax(py + pe))
        xview = 1.1 * np.nanmax(ax_)
    else:
        ytop = max(5.5, 1.1 * max(np.nanmax(ay_ + ae_), *(np.nanmax(d['rate'][d['ok'] & (d['x'] <= xmax)]) for d in W.values())))
        xview = xmax
    off = int(np.sum(ys > ytop))
    if off:
        note += f'; {off} of {len(ys)} samples above the top of the axes'
    NA = LogNorm(min(na.values()) * 0.9, max(na.values()) * 1.1)
    cmap = plt.get_cmap('viridis')
    with plt.rc_context(STYLE):
        fig, axes = plt.subplots(1, 2, figsize=(11, 4.6) if kind != 'kp' else (12, 5.2), constrained_layout=True)
        for ax, full in zip(axes, (False, True)):
            if full:
                for s, d in sorted(W.items()):
                    x, y = d['x'][d['ok']], d['rate'][d['ok']]; m = x <= ceil[s]; c = cmap(NA(na[s]))
                    ax.plot(x[m], y[m], '-', color=c, lw=0.8, alpha=0.8, zorder=1)
                    ax.plot(x[np.maximum(m.sum() - 1, 0):], y[np.maximum(m.sum() - 1, 0):], ':', color=c, lw=0.8, alpha=0.8, zorder=1)
                ax.errorbar(px, py, pe, fmt='h', ms=6.5, color='0.55', mfc='white', mec='0.55',
                            mew=1.0, elinewidth=0.9, capsize=0, zorder=2)
            ax.plot(gx, gx / TAU_XI, '-', color='k', lw=1.2, zorder=3)
            ax.axhline(Dg, color='k', ls=(0, (6, 3)), lw=1.2, zorder=3)
            ax.errorbar(ax_, ay_, ae_, fmt='h', ms=7, color=EDGE, mfc='white', mec=EDGE, mew=1.0, elinewidth=0.8, capsize=0, zorder=4)
            ax.errorbar(bx, by, be, fmt='h', ms=7, color=EDGE, mfc=FILL, mec=EDGE, mew=1.3, elinewidth=1.0, capsize=0, zorder=5)
            ax.set_xlim(-0.02 * xview, xview); ax.set_ylim(0, ytop)
            if ticks:
                ax.set_xticks(ticks)
            ax.set_xlabel(xlab); ax.set_ylabel(ylab, fontsize=13)
            xl = min(0.12 * xview, 0.55 * ytop * TAU_XI)
            ax.annotate(rf'$x/{TAU_XI}$' if kind == 'kp' else rf'$(\ell/\xi)^2/{TAU_XI}$', (xl, xl / TAU_XI), xytext=(-6, 0),
                        textcoords='offset points', fontsize=9, ha='right', va='center', color='k')
            ax.annotate(rf'$D/c^2 = {Dg:.2f}\,\hbar/m$' if kind == 'kp' else rf'$D = {D_GUIDE}\,\hbar/m$', (xview, Dg), xytext=(-4, 5),
                        textcoords='offset points', fontsize=9, ha='right', color='k')
        axes[0].set_title(f'WKE, {len(W)} series pooled at the measured times' + {'ell': '', 'mod2': r', drift-corrected $\eta_{\rm eq}$', 'mod3': r', $\eta(t)$ from the tail'}.get(kind, r', through $k_p$'))
        axes[1].set_title({'ell': 'WKE with the published points and the WKE series',
                           'kp': r'WKE and the published points rescaled by $1/c^2$',
                           'mod': r'WKE ($\ell = c/k_p$) with the published points',
                           'mod2': 'WKE (drift-corrected) with the published points and the WKE series',
                           'mod3': r'WKE ($\eta(t)$ from the tail) with the published points and the WKE series'}[kind])
        ys_ = '' if yscale == 1.0 else rf', rate $/\,{yscale:g}$'
        h = [Line2D([], [], ls='', marker='h', ms=7, color=EDGE, mfc=FILL, mew=1.3, label=f'WKE, binned, {box[0]}' + ys_),
             Line2D([], [], ls='', marker='h', ms=7, color=EDGE, mfc='white', mew=1.0, label='WKE, binned, all samples' + ys_),
             Line2D([], [], ls='', marker='h', ms=6.5, color='0.55', mfc='white', mew=1.0,
                    label=r'published, $\times 1/c^2$' if kind == 'kp' else 'published'),
             Line2D([], [], color=cmap(0.5), lw=0.8, label='WKE, one series'),
             Line2D([], [], color=cmap(0.5), lw=0.8, ls=':', label=box[1]),
             Line2D([], [], color='k', lw=1.2, label=rf'$\tau = {TAU_XI}\,t_\xi$'),
             Line2D([], [], color='k', ls=(0, (6, 3)), lw=1.2, label=r'$D/c^2$' if kind == 'kp' else rf'$D = {D_GUIDE}\,\hbar/m$')]
        axes[1].legend(handles=h, fontsize=9, frameon=False, loc='upper left', bbox_to_anchor=(1.02, 1.0))
        fig.colorbar(ScalarMappable(NA, 'viridis'), ax=axes[1], label=r'$na$ (µm$^{-2}$)', shrink=0.55, location='right', anchor=(0, 0))
        if yscale != 1.0:
            note += rf'; WKE rates divided by {yscale:g}'
            axes[0].set_title(axes[0].get_title() + rf', rate $/\,{yscale:g}$')
        fig.suptitle(f'Fig 4c analogue. WKE {label["modelLabel"]}, {kern}, {label["accuracy"]}; ' + note, fontsize=10)
        save(fig, study_dir, name_override or name, arrays)

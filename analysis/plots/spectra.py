"""Spectra figures, one panel per run, at the saved snapshots coloured from early (violet) to late
(red) along a rainbow scale, with k_ξ marked and the initial state in black. Runs without saved
snapshots are listed and skipped.

  spectra.pdf     occupation n_k against k, log-log;
  spectra_Nk.pdf  N_k = 4πk² n_k / N = k² n_k/(2π² n) (µm), lin-lin, so ∫N_k dk = 1;
  spectra_Ek.pdf  E_k = (ħ²k²/2m k_B) N_k (nK µm), lin-lin, the spectral kinetic energy per atom,
                  so ∫E_k dk = E/N (nK).
spectra_Nk uses the same axes in every panel, k from 0 to 2.5 (µm⁻¹) and N_k from 0 to 2.1 (µm);
spectra_Ek shows k up to where 99.5% of ∫E_k lies, over all snapshots of the run.
"""
import numpy as np
import matplotlib.pyplot as plt
from common import Style, GUIDE, LABEL, save, run_id

RAINBOW = plt.get_cmap('turbo')
HBAR_JS = 1.054571817e-34
KB_JK = 1.380649e-23

KINDS = {
    'spectra': dict(log=True, ylabel='n_k (occupation)', title='Occupation', key='n_k'),
    'spectra_Nk': dict(log=False, ylabel='N_k (µm)', title='Particle spectrum N_k = 4πk² n_k / N', key='N_k_um',
                       xlim=(0, 2.5), ylim=(0, 2.1)),
    'spectra_Ek': dict(log=False, ylabel='E_k (nK µm)', title='Kinetic energy spectrum E_k = (ħ²k²/2m k_B) N_k', key='E_k_nK_um'),
}


def quantity(name, r, k, nk):
    if name == 'spectra':
        return nk
    Nk = k ** 2 * nk / (2 * np.pi ** 2 * r['settings']['density_um3'])
    if name == 'spectra_Nk':
        return Nk
    # ħ²k²/2m in nK with k in µm⁻¹ and ħ/m in µm²/s
    return HBAR_JS * r['scales']['hbarOverM_um2_per_s'] / (2 * KB_JK) * 1e9 * k ** 2 * Nk


def make(study_dir, study, runs):
    for name in KINDS:
        make_one(name, study_dir, study, runs)


def make_one(name, study_dir, study, runs):
    kind = KINDS[name]
    have = [r for r in runs if len(r.get('snapshots', {}).get('n_k', [])) > 1]
    missing = [run_id(r) for r in runs if r not in have]
    if missing and name == 'spectra':
        print(f"  spectra: no snapshots saved for {len(missing)} run(s): {', '.join(missing)}")
    if not have:
        return
    style = Style(have)
    n = len(have)
    cols = min(n, 4)
    rows = (n + cols - 1) // cols
    fig, axs = plt.subplots(rows, cols, figsize=(3.4 * cols + 1.2, 3.1 * rows), squeeze=False, layout='constrained')
    arrays = {}
    for i, r in enumerate(have):
        ax = axs[i // cols, i % cols]
        s, sn = r['settings'], r['snapshots']
        k = np.array(sn['k_um_inv'], float)
        nk = quantity(name, r, k, np.array(sn['n_k'], float))
        X = np.array(sn['X'], float)
        rid = run_id(r)
        arrays[f'{rid}__k_um_inv'] = k; arrays[f'{rid}__{kind["key"]}'] = nk
        arrays[f'{rid}__t_s'] = np.array(sn['t_s'], float); arrays[f'{rid}__kxi_over_kp'] = X
        m = len(nk)
        for j in range(m):
            c = 'k' if j == 0 else RAINBOW(0.05 + 0.9 * (j - 1) / max(1, m - 2))
            ok = nk[j] > 0 if kind['log'] else np.isfinite(nk[j])
            ax.plot(k[ok], nk[j][ok], color=c, lw=1.2 if j == 0 else 0.9)
        kxi = r['scales']['kXi_um_inv']
        ax.axvline(kxi, **GUIDE)
        ax.annotate('k_ξ', (kxi, 1), xycoords=('data', 'axes fraction'), xytext=(3, -12), **LABEL)
        top = np.nanmax(nk)
        if kind['log']:
            ax.set_xscale('log'); ax.set_yscale('log')
            ax.set_ylim(top * 1e-12, top * 3)
        else:
            # k up to where 99.5% of the integral lies, over all snapshots
            cum = np.cumsum(0.5 * (nk[:, 1:] + nk[:, :-1]) * np.diff(k), axis=1)
            kmax = max(k[1:][np.searchsorted(c, 0.995 * c[-1])] for c in cum if c[-1] > 0)
            ax.set_xlim(*kind.get('xlim', (0, max(kmax, 1.1 * kxi)))); ax.set_ylim(*kind.get('ylim', (0, 1.05 * top)))
        ax.set_title(f"{s['stateName']}, a = {s['a_a0']:g} a₀ (E/N = {r['initial']['EN_nK']:.0f} nK)", fontsize=8.5)
        ax.set_xlabel('k (µm⁻¹)'); ax.set_ylabel(kind['ylabel'])
        ax.grid(alpha=.3, which='both')
    for j in range(n, rows * cols):
        axs[j // cols, j % cols].axis('off')
    sm = plt.cm.ScalarMappable(cmap=RAINBOW, norm=plt.Normalize(0, 1))
    cb = fig.colorbar(sm, ax=axs, fraction=0.025, pad=0.01)
    cb.set_ticks([0, 1]); cb.set_ticklabels(['early', 'late'])
    cb.set_label('snapshot (evenly spaced in log k_ξ/k_p; black: initial state)')
    models = sorted({r['settings']['modelLabel'] for r in have})
    fig.suptitle(f"{kind['title']} at snapshots ({', '.join(models)})", fontsize=10)
    save(fig, study_dir, name, arrays)

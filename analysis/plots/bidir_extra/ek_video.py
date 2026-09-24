"""Video of E_k at one a: large-N snapshots (line) against the measured spectrum nearest in time (points)."""
import sys, os, json, glob
sys.path.insert(0, 'analysis/plots'); sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, FFMpegWriter
import bidir_fit as B
from kE2 import kE_mid
D = os.environ['WKE_BIDIR_DATA']
A0 = float(sys.argv[1])
study = os.environ.get('STUDY', 'analysis/results/2026-09-24_bidir-chain-series1-standard')
run = [json.load(open(f)) for f in glob.glob(study + '/runs/*.json') if json.load(open(f))['settings']['a_a0'] == A0][0]
model = [c for c in B.run_curves(run)]
data = sorted([c for c in B.load_series(D, 1) if c['a'] == A0], key=lambda c: c['t'])
tmax = model[-1]['t']
data = [c for c in data if c['t'] <= max(tmax, 1) * 2.5]
E_rel = run['snapshots']['E_rel']
fig, ax = plt.subplots(figsize=(6.4, 4.4))
line, = ax.plot([], [], color=os.environ.get('COL', '#c0392b'), lw=1.8, label='large-N, Bose +1')
mk, = ax.plot([], [], 'v', color=os.environ.get('COL', '#c0392b'), ms=9)
pts = ax.errorbar([0], [0], [0], fmt='o', color='0.15', mfc='white', ms=5, elinewidth=0.8, capsize=0, label='measured')
dk, = ax.plot([], [], 'v', color='0.15', ms=9, mfc='white')
txt = ax.text(0.98, 0.95, '', transform=ax.transAxes, ha='right', va='top', fontsize=9)
ax.set(xlim=(0, 5), ylim=(0, 230), xlabel='k (µm⁻¹)', ylabel='E_k / k_B (10³ nK µm)', title=f'a = {A0:g} a₀: E_k, triangles = k_E')
ax.legend(loc='upper left', frameon=False, fontsize=8)

def nearest(t):
    return min(data, key=lambda c: abs(np.log((c['t'] + 1) / (t + 1))))

def frame(i):
    global pts
    c = model[i]
    s = c['k'] <= 5
    E = B.Ek_nK_um(c)
    line.set_data(c['k'][s], E[s] / 1e3)
    kE = kE_mid(c)[0]
    mk.set_data([kE], [np.interp(kE, c['k'], E) / 1e3 + 8])
    d = nearest(c['t'])
    pts.remove()
    Ed, sd = B.Ek_nK_um(d), B.Ek_nK_um(dict(k=d['k'], n=d['err']))
    pts = ax.errorbar(d['k'], Ed / 1e3, sd / 1e3, fmt='o', color='0.15', mfc='white', ms=5, elinewidth=0.8, capsize=0)
    kd = kE_mid(d)[0]
    dk.set_data([kd], [np.interp(kd, d['k'], Ed) / 1e3 + 8])
    txt.set_text(f"large-N: t = {c['t']:.1f} ms (t ā = {c['t'] * A0 / 300:.0f} ms), k_E = {kE:.2f}, E/E₀ = {E_rel[i]:.3f}\n"
                 f"measured: t = {d['t']:g} ms, k_E = {kd:.2f}")
    return line, mk, dk, txt

anim = FuncAnimation(fig, frame, frames=len(model), blit=False)
out = f'{study}/plots/bidir_Ek_video_{A0:g}a0.mp4'
anim.save(out, writer=FFMpegWriter(fps=6, bitrate=1800), dpi=150)
print(out, len(model), 'frames')

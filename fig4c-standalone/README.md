# Coherence spreading in a Bose gas: the Fig 4c analogue from a wave kinetic equation

This folder recomputes, from scratch, the analogue of Fig 4c of a measurement of coherence spreading in a box of
³⁹K atoms: the rate at which the coherence length grows, $(m/\hbar)\,\mathrm{d}\ell^2/\mathrm{d}t$, against
$(\ell/\xi)^2$. It takes the three measured initial states (P1, P2, P3) and each measured series' scattering length
and density, evolves them with a wave kinetic equation whose collisions are dressed by the large-$N$ bubble chain,
and compares with the published points. It has no dependencies outside the folder.

```
./run_all.sh                    # 11 series, standard accuracy, Bose +1 terms: about 1 h on 8 cores
ACCURACY=draft ./run_all.sh     # the same at draft accuracy: about 3 min
```

This file is the physics. [`SOLVER.md`](SOLVER.md) explains the numerics of `wke_chain.ts` step by step.

| File | What it is |
| --- | --- |
| `wke_chain.ts` | one simulation of one series (Node 22.6 or newer runs it directly) |
| `fig4c.py` | analysis and figure (python3 with numpy and matplotlib); also writes the plotted arrays for Wolfram. Options: `--ytop Y` (y range), `--pdf path`, and two binnings of the curves with the spread between series as error bars: `--equal W` (bins of width W, writes `fig4c_equal.*`) and `--sqrt D` (bins of equal step D in $\sqrt{(\ell/\xi)^2}$, dense early and wide late, e.g. 2.3; writes `fig4c_sqrt.*`) |
| `fig4c_wolfram.wl` | the same figure redrawn in the Wolfram Language from `out/fig4c.wl` (`wolframscript -file fig4c_wolfram.wl`) |
| `run_all.sh` | runs every series in parallel, then the figure |
| `data/fig4c_data.json` | every input: the measured initial spectra, the series parameters and times, the published Fig 4c points |
| `out/` | results: `runs/sNN.json`, `fig4c.pdf`, the plotted arrays as `fig4c.npz` (numpy) and `fig4c.wl` (a Wolfram Association, `data = Get["out/fig4c.wl"]`), and `fig4c_wolfram.pdf` |

---

## 1. Motivation

A Bose gas brought far from equilibrium, here by a sequence of forcing and interaction pulses that leaves most atoms
at momenta of order 1 µm⁻¹ with an energy of about 20 nK per atom, relaxes towards a Bose-condensed equilibrium.
On the way, occupation piles up at low momenta and the gas becomes coherent over a growing length $\ell(t)$. The
experiment measures $\ell$ from the zero-momentum occupation, $\ell^3 \propto n_{k=0}$, normalised so that in
equilibrium $\ell^3$ equals the volume of the box.

The published observation is that, once $\ell$ exceeds the healing length $\xi$ by a factor of 10 to 15,
$\ell^2$ grows linearly in time with a universal coefficient,

$$\frac{\mathrm{d}\ell^2}{\mathrm{d}t} = D\,\frac{\hbar}{m},\qquad D \approx 3.4,$$

the same for all three initial states, scattering lengths from 50 to 400 $a_0$ and two box sizes; at earlier times
$\ell^2$ grows exponentially with a time constant of about $56\,t_\xi$, $t_\xi = m\xi^2/\hbar$. Plotted as
$(m/\hbar)\,\mathrm{d}\ell^2/\mathrm{d}t$ against $(\ell/\xi)^2$ (Fig 4c), all series collapse onto one curve: a
straight line $(\ell/\xi)^2/56$ that turns over into the plateau $D$.

The question here is whether a kinetic description reproduces this curve: its shape, and the value of the plateau.
The gas is dilute ($na^3 \approx 10^{-7}$ to $5\times10^{-5}$) and the interaction weak, which favours a kinetic equation; but the growing
low-momentum occupation makes the effective interaction strong in the infrared, so the bare collision integral is not
enough (section 4).

## 2. The system and its scales

$N$ bosons of mass $m$ in a volume $V$, density $n = N/V$, interacting through the contact potential

$$\hat H = \sum_{\mathbf k} \frac{\hbar^2 k^2}{2m}\,\hat a^\dagger_{\mathbf k}\hat a_{\mathbf k}
 + \frac{g}{2V}\sum_{\mathbf k_1+\mathbf k_2=\mathbf k_3+\mathbf k_4}\hat a^\dagger_{\mathbf k_3}\hat a^\dagger_{\mathbf k_4}\hat a_{\mathbf k_2}\hat a_{\mathbf k_1},
 \qquad g = \frac{4\pi\hbar^2 a}{m}.$$

The interaction sets one energy, $gn$, and with it the scales used throughout:

| Scale | Definition | Meaning |
| --- | --- | --- |
| healing length | $\xi = \hbar/\sqrt{2mgn} = 1/\sqrt{8\pi n a}$ | length at which kinetic and interaction energy balance |
| $k_\xi$ | $1/\xi$ | momentum of the same balance |
| $t_0$ | $\hbar/(gn)$ | interaction time |
| $t_\xi$ | $m\xi^2/\hbar = t_0/2$ | the time unit of the figure |
| $N_\mathrm{cal}$ | $4\pi^2 n\xi^3$ | atoms in a healing volume, up to $4\pi^2$; the inverse coupling of the kinetic equation |

In the series simulated here $n \approx 5.4$ µm⁻³ and $a = 50$ to $400\,a_0$, so $\xi = 0.6$ to $1.7$ µm and
$N_\mathrm{cal} \approx 45$ to $1000$.

Everything below uses dimensionless momenta and times,

$$p = k\xi,\qquad \tau = t/t_0,\qquad \frac{\varepsilon_k}{gn} = \frac{\hbar^2k^2}{2m\,gn} = p^2,$$

and the occupation per mode $f(p)$, normalised by $n = \int \frac{\mathrm d^3k}{(2\pi)^3} f = \frac{1}{2\pi^2}\int k^2 f\,\mathrm dk$.
The published momentum distributions are per volume, $n_k = V f/(2\pi)^3$.

## 3. The wave kinetic equation

### 3.1 The collision integral

For a homogeneous gas with random phases, second-order perturbation theory in $g$ (Fermi's golden rule for the
two-body collisions $\mathbf k + \mathbf k_3 \leftrightarrow \mathbf k_1 + \mathbf k_2$, with the Bose enhancement of
every final state) gives the kinetic equation

$$\partial_t f_{\mathbf k} = \frac{4\pi g^2}{\hbar}\int\!\frac{\mathrm d^3k_1\,\mathrm d^3k_2\,\mathrm d^3k_3}{(2\pi)^6}\;
 \delta^{3}(\mathbf k+\mathbf k_3-\mathbf k_1-\mathbf k_2)\;\delta(\varepsilon+\varepsilon_3-\varepsilon_1-\varepsilon_2)\;
 \Big[f_1f_2(1+f+f_3) - f f_3(1+f_1+f_2)\Big].$$

The prefactor collects $2\pi/\hbar$ from the golden rule, the squared matrix element $(2g/V)^2$ (direct plus
exchange), a factor $1/2$ for the identical final pair, and $V^{-2}$ against the two free momentum sums. The bracket is
gain minus loss: $f_1f_2(1+f)(1+f_3) - ff_3(1+f_1)(1+f_2)$, in which the quartic terms cancel.

Two limits of the bracket matter:

- **Bose +1 (quantum)**: $f_1f_2(1+f+f_3) - ff_3(1+f_1+f_2)$. Its stationary solution is the Bose-Einstein
  distribution $f = 1/(e^{(\varepsilon-\mu)/k_BT}-1)$, and it conserves $N$ and $E$. This is the physical kernel.
- **classical waves**: $f_1f_2(f+f_3) - ff_3(f_1+f_2)$, the large-$f$ limit (the terms cubic in $f$). Its
  equilibrium is Rayleigh-Jeans, $f = k_BT/(\varepsilon-\mu)$, whose total energy depends on the momentum cutoff. It
  is the limit a classical-field simulation describes, and it is offered as `--kernel classical`.

### 3.2 Reduction to one dimension

For an isotropic $f$ the angles can be integrated out. Write $\delta^3(\mathbf q) = \int\!\frac{\mathrm d^3r}{(2\pi)^3}\,e^{i\mathbf q\cdot\mathbf r}$;
the angular average of $e^{i\mathbf k\cdot\mathbf r}$ is $\sin(kr)/(kr)$, so

$$\int\!\mathrm d^3k_1\mathrm d^3k_2\mathrm d^3k_3\,\delta^3(\cdots)\,F
 = \frac{(4\pi)^4}{(2\pi)^3}\int\!\mathrm dk_1\mathrm dk_2\mathrm dk_3\,\frac{k_1k_2k_3}{k}\,F\;
 \int_0^\infty\!\frac{\sin kr\,\sin k_1r\,\sin k_2r\,\sin k_3r}{r^2}\,\mathrm dr .$$

Writing the product of four sines as a sum of cosines and using $\int_0^\infty (1-\cos ar)/r^2\,\mathrm dr = \pi|a|/2$,
the last integral is, for any quartet that conserves energy ($k^2+k_3^2 = k_1^2+k_2^2$),

$$\int_0^\infty\!\frac{\sin kr\,\sin k_1r\,\sin k_2r\,\sin k_3r}{r^2}\,\mathrm dr = \frac{\pi}{4}\,\min(k,k_1,k_2,k_3).$$

The energy delta then fixes $k_3$, $\delta(k^2+k_3^2-k_1^2-k_2^2) = \delta(k_3 - \sqrt{k_1^2+k_2^2-k^2})/2k_3$. In the
dimensionless units, $\mathrm d^3k = \mathrm d^3p/\xi^3$, $\delta^3(\mathbf k) = \xi^3\delta^3(\mathbf p)$,
$\delta(\Delta\varepsilon) = \delta(\Delta p^2)/gn$ and $\partial_t = \partial_\tau/t_0$, and every factor combines into

$$\boxed{\;\partial_\tau f(p) = \frac{4\pi}{N_\mathrm{cal}^2}\int\!\!\int\mathrm dp_1\,\mathrm dp_2\;
 \frac{p_1p_2\,\min(p,p_1,p_2,p_3)}{p}\;\Big[f_1f_2(1+f+f_3)-ff_3(1+f_1+f_2)\Big],\qquad p_3^2 = p_1^2+p_2^2-p^2\;}$$

over all $p_1, p_2$ with $p_3^2 > 0$. The bookkeeping: the prefactor becomes
$\frac{4\pi g^2}{\hbar}\cdot\frac{t_0}{gn}\cdot\frac{1}{(2\pi)^6\xi^6} = \frac{4\pi}{(2\pi)^6 n^2\xi^6} = \frac{1}{4\pi^2}\,\frac{4\pi}{N_\mathrm{cal}^2}$,
and the angles with the energy delta give $\frac{(4\pi)^4}{(2\pi)^3}\cdot\frac12\cdot\frac{\pi}{4} = 4\pi^2$. The coupling appears only through $N_\mathrm{cal}$: a weaker interaction or a
lower density means a larger $N_\mathrm{cal}$ and a slower evolution in units of $t_0$.

### 3.3 Where the bare equation fails

The collision integral grows like $f^3$. As the gas cascades towards low momenta, $f$ at $p \lesssim 1$ grows far
beyond $N_\mathrm{cal}$, and the perturbative vertex $g$ overestimates the scattering of the highly occupied modes:
in that regime the interaction between them is screened by the medium. The bare equation then runs too fast, and its
low-momentum solution approaches a finite-time singularity. The dressing below cures this.

## 4. The large-$N$ bubble chain

### 4.1 Why large $N$

Generalise the field to $N$ components, $\hat\psi_a$ with $a = 1\ldots N$, and the interaction to
$(g/2N)(\hat\psi^\dagger_a\hat\psi_a)^2$. At large $N$ the leading correction to two-body scattering is the chain of
one-loop bubbles in which the component index runs around each loop: each bubble brings a sum over $N$ components,
which cancels the $1/N$ of the next vertex, so the whole geometric series is of the same order as the bare vertex,
while every other diagram is suppressed by $1/N$. The kinetic equation at this order keeps the structure of section 3
but replaces the bare vertex of every collision by the resummed one. The physical gas has $N = 1$; the large-$N$
resummation is used as a controlled way to include medium screening.

### 4.2 The dressed vertex

In a collision $\mathbf k + \mathbf k_3 \to \mathbf k_1 + \mathbf k_2$, the pair $(\mathbf k, \mathbf k_1)$ exchanges
momentum $\mathbf Q = \mathbf k - \mathbf k_1$ and energy $\omega = \varepsilon - \varepsilon_1$. Summing the bubble
chain in this exchange channel gives

$$g \;\to\; \frac{g}{1 - L_-(Q,\omega)},\qquad
 L_-(Q,\omega) = g\int\!\frac{\mathrm d^3k'}{(2\pi)^3}\;\frac{f_{\mathbf k'} - f_{\mathbf k'+\mathbf Q}}{\omega + \varepsilon_{\mathbf k'} - \varepsilon_{\mathbf k'+\mathbf Q} + i0}.$$

Each collision rate carries $|1-L_-|^{-2}$ instead of $1$. The numerator of the bubble shows why the Bose $+1$ terms do
not change the dressing: with the quantum occupation factors it reads
$f_{\mathbf k'}(1+f_{\mathbf k'+\mathbf Q}) - f_{\mathbf k'+\mathbf Q}(1+f_{\mathbf k'}) = f_{\mathbf k'} - f_{\mathbf k'+\mathbf Q}$,
the same as for classical waves.

### 4.3 The bubble for an isotropic spectrum

In dimensionless units $g\int\frac{\mathrm d^3k'}{(2\pi)^3}\frac{\cdots}{\Delta\varepsilon} = \frac{4\pi^2}{N_\mathrm{cal}}\int\frac{\mathrm d^3p'}{(2\pi)^3}\frac{\cdots}{\Delta(p^2)}$.
Shift $\mathbf k' \to \mathbf k' - \mathbf Q$ in the second term, integrate the angle between $\mathbf p'$ and $\mathbf Q$
(the denominators are linear in its cosine), and the two terms combine into logarithms. With

$$H(x) = \int_0^\infty s f(s)\,\ln\left|\frac{s-x}{s+x}\right|\mathrm ds,\qquad
 J(x) = \int_0^{|x|} s f(s)\,\mathrm ds,\qquad
 x_{a,b} = \frac{|\omega| \pm Q^2}{2Q},$$

the principal value and the delta function of $1/(\cdots + i0)$ give

$$\mathrm{Re}\,L_-(Q,\omega) = \frac{1}{2N_\mathrm{cal}}\,\frac{H(x_a) - H(x_b)}{x_a - x_b},\qquad
 \mathrm{Im}\,L_-(Q,\omega) = -\frac{\pi}{2N_\mathrm{cal}}\,\frac{J(x_a) - J(x_b)}{Q},$$

with $x_a - x_b = Q$. (Only $|\omega|$ enters, because $\mathrm{Re}\,L_-$ is even in $\omega$ and $|1-L_-|^2$ depends on
$\mathrm{Im}\,L_-$ only through its square.) Two checks:

- **Static limit** ($\omega = 0$, $Q \to 0$): $H(x) \simeq -2x\int f\,\mathrm ds$, so
  $L_- \to -\frac{1}{N_\mathrm{cal}}\int_0^\infty f\,\mathrm dp$. For repulsion ($a > 0$) $1 - L_- > 1$: the medium
  screens the interaction, and more so the larger the low-momentum occupation.
- **Weak occupation**: $L_- = O(f/N_\mathrm{cal})$, so $|1-L_-|^{-2} \to 1$ and the bare equation is recovered.

### 4.4 The dressed kinetic equation

For fixed magnitudes $p, p_1, p_2, p_3$ the angular measure of a resonant quartet is uniform in the transfer momentum
$Q = |\mathbf p - \mathbf p_1|$, on the interval $[\max(|p-p_1|, |p_2-p_3|),\ \min(p+p_1, p_2+p_3)]$ of length
$2\min(p,p_1,p_2,p_3)$; this is the geometric content of the $\min$ in section 3.2. The dressed equation therefore
averages the chain weight over that interval:

$$\partial_\tau f(p) = \frac{4\pi}{N_\mathrm{cal}^2}\int\!\!\int\mathrm dp_1\mathrm dp_2\;
 \frac{p_1p_2\min(p,p_1,p_2,p_3)}{p}\;M(p,p_1,p_2)\;\Big[f_1f_2(1+f+f_3) - ff_3(1+f_1+f_2)\Big],$$

$$M = \Big\langle \frac{1}{|1-L_-(Q,\,|p^2-p_1^2|)|^2} \Big\rangle_{Q}.$$

$M$ depends on $f$ through $L_-$, so the equation is no longer cubic in $f$. Deep in the coherent regime
$|L_-| \gg 1$ and the dressing reduces the rate by a large factor; this is what keeps the growth of the low-momentum
occupation finite. The dressing leaves the conservation laws intact: $M$ depends only on $|Q|$ and $|\omega|$, which are
the same for the pair $(p, p_1)$ and for its partner pair $(p_3, p_2)$, so the equation conserves $N$ and $E$ in the
continuum (the discretised version drifts slightly; see SOLVER.md). Its stationary state is still Bose-Einstein, because
the bracket vanishes there whatever $M$ is.

## 5. Equilibrium and the condensed fraction

With the Bose $+1$ terms the equation relaxes to Bose-Einstein at the $n$ and $E/N$ of the initial state. An ideal Bose
gas below $T_c$ has $\mu = 0$ and

$$n_\mathrm{th} = \frac{\zeta(3/2)}{\lambda_T^3},\qquad \frac{E}{N} = \frac{3}{2}k_BT\,\frac{\zeta(5/2)}{n\lambda_T^3},\qquad
 \lambda_T = \sqrt{\frac{2\pi\hbar^2}{mk_BT}},$$

the kinetic energy all carried by the thermal atoms. Solving the second relation for $T$ and inserting it in the first
gives the equilibrium condensed fraction

$$\eta_\mathrm{eq}(n, E/N) = 1 - \frac{\zeta(3/2)}{n\lambda_T^3} = 1 - \left(\frac{T}{T_c}\right)^{3/2},
 \qquad k_BT_c = \frac{2\pi\hbar^2}{m}\left(\frac{n}{\zeta(3/2)}\right)^{2/3}.$$

For the measured states ($E/N \approx 20$ to $22$ nK at $n \approx 5.4$ µm⁻³, $T_c \approx 128$ nK) this gives
$T/T_c \approx 0.54$ and $\eta_\mathrm{eq} \approx 0.60$. The interaction energy is neglected here; it is small for
these parameters. The classical kernel has no such equilibrium: its Rayleigh-Jeans state depends on the momentum cutoff.

## 6. Observables

### 6.1 The coherence length

The occupation of the lowest mode measures how many atoms share one phase. If a region of size $\ell$ is coherent and
holds the condensed fraction $\eta$ of its atoms, $f(k\to0) \simeq \eta n\ell^3$. The coherence length is therefore defined
as

$$\ell^3 = \frac{f(k\to 0)}{\eta_\mathrm{eq}\,n},$$

which gives $\ell^3 = V$ in equilibrium, when all condensed atoms occupy the single lowest mode of the box, and matches
the normalisation of the experiment. $f(k\to0)$ is read off the low-momentum plateau: a fit $\ln f = A + Bk^2$ over
$k \le k_p/5$ gives $f_0 = e^A$. For classical-wave runs the normalisation uses $\eta = 1$, and the length is written
$\bar\ell$ ($\bar\ell^3 = f_0/n$), because there is no cutoff-independent equilibrium to normalise to.

The rate is taken from the collision term itself, not from differences in time:
$(m/\hbar)\,\mathrm d\ell^2/\mathrm dt = \tfrac23\,\ell^2\,\partial_t\ln f_0\,/(\hbar/m)$, with $\partial_t f_0$ from the fit
applied to $f \pm \epsilon\,\partial_t f$.

### 6.2 The box

The kinetic equation describes an infinite homogeneous gas; the experiment is a box of volume $V$. The measured $\ell$
saturates at $\ell^3 = V$, i.e. at $(\ell/\xi)^2 = 8\pi na\,V^{2/3}$, while the simulated one keeps growing. The figure
marks where each series passes this ceiling. A run stops once its spectral peak $k_p$ (the maximum of $k^2 f$) has
reached $\pi/V^{1/3}$, twice past the box scale, or, for the longer runs here, a $k_\xi/k_p$ chosen to reach
$(\ell/\xi)^2 \approx 2000$.

### 6.3 The spectral peak

The peak $k_p$ of $k^2f$ (the maximum of the shell occupation $N_k = 4\pi k^2 n_k$) is a second measure of the coherent
scale. In the self-similar regime the spectrum keeps its shape, $n_k \propto 1/(1+(k/k_0)^\kappa)$ with $\kappa \approx 2$
to $3$, so $k_p$ and $1/\ell$ are proportional; in these simulations $k_p\ell \approx 3.1$.

## 7. The Fig 4c analogue

- **Inputs** (`data/fig4c_data.json`): the three measured initial $n_k$ (P1, P2, P3; cut at $k \le 4$, $4$, $6$ µm⁻¹, where
  they reach the noise floor), and for each of the 13 measured series its protocol, $a$, $N$, $V$, density $N/V$, onset time
  $t^*$ and the times at which $\ell$ was measured. Each series is simulated from its protocol's initial state at its
  own $a$ and $n$; $E/N$ is that of the measured state (21.6, 21.4 and 20.0 nK).
- **Sampling**: each series' simulated rate and $(\ell/\xi)^2$ are read at that series' measured times (the clocks
  start when $a$ is switched on), so the pooled samples weight the series and the stages of the evolution as the
  measurement does.
- **Binning**: the pooled samples are binned at the published $(\ell/\xi)^2$ values (edges halfway between them); each
  point is the bin mean with its standard error. Filled points use only samples inside the box ceiling, open points
  all samples.
- **Guides**, as in the publication: $\ell^2 \propto e^{t/\tau}$ with $\tau = 56\,t_\xi$, i.e. rate $= (\ell/\xi)^2/56$
  (solid), and $D = 3.4$ (dashed).
- **Series left out**: 8 and 10, the two series with a low atom number ($N = 7\times10^4$ and $8.5\times10^4$).

**Caveats.**

- The published $\ell$ includes a deconvolution of the finite momentum resolution
  ($1/\ell'^2 = 1/\ell^2 + 1/\ell_0^2$, $\ell_0 \approx 58$ µm); the simulated $\ell$ needs none, and none is undone.
- The simulation has no box (section 6.2) and no trap inhomogeneity.
- The bubble chain is the leading order of a $1/N$ expansion applied at $N = 1$.
- The result: the simulated rate rises along the exponential guide and turns over into a plateau, but the plateau is
  about $3\times$ the measured $D$ ($\approx 11$ against $3.4$), with a spread of about 20% between scattering lengths.
  The collapse, the shape and the independence of the initial state are reproduced, the value of $D$ is not. Correcting
  $\eta$ for the small numerical drift of $N$ and $E$, or taking $\eta(t)$ from the thermal tail of the spectrum,
  changes the plateau by a few percent only, and draft and standard accuracy agree to within 2%.

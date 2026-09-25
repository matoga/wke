# How `wke_chain.ts` solves the kinetic equation

This note walks through the simulation file in the order of its numbered sections. It assumes the physics of
[`README.md`](README.md) (sections 3 and 4) and no experience with numerical kinetic equations. Formulas are in the
solver's units: momentum $p = k\xi$, time $\tau = t/t_0$, occupation per mode $f$.

The equation being solved is

$$\partial_\tau f(p) = \frac{4\pi}{N_\mathrm{cal}^2}\int\!\!\int\mathrm dp_1\mathrm dp_2\,
\frac{p_1p_2\min(p,p_1,p_2,p_3)}{p}\,M\,\Big[f_1f_2(b+f+f_3) - ff_3(b+f_1+f_2)\Big],$$

with $p_3^2 = p_1^2+p_2^2-p^2$, $b = 1$ with the Bose $+1$ terms or $0$ for classical waves, and
$M = \langle|1-L_-|^{-2}\rangle$ the bubble-chain weight. The plan of the solver:

1. put $f$ on a grid of momenta, so that the equation becomes a large set of coupled ordinary differential equations,
   one per grid point;
2. precompute everything that does not depend on $f$: which collisions exist and with what weight;
3. at every time step, compute the loops $L_-$ from the current $f$, then the weight $M$ of every collision, then the
   collision sum;
4. step in time with an adaptive Runge-Kutta method, and record the observables along the way.

## 1. Constants, units, accuracy

Physical constants, the scales of the series ($\xi$, $t_0$, $N_\mathrm{cal}$, see README section 2), and the accuracy
levels. A level fixes every numerical choice at once, so that only tested combinations run:

| Level | Grid points (per 3.3 decades) | Partner nodes | $r_\mathrm{tol}$ | $a_\mathrm{tol}$ | Loop table | Transfer cells | Typical run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| draft | 300 | 12 × 1 panel | 10⁻⁵ | 10⁻⁸ | 600 | 0.4 wide, ≤ 32 | 0.5 to 2 min |
| standard | 500 | 12 × 2 panels | 10⁻⁷ | 10⁻¹⁰ | 1000 | 0.2 wide, ≤ 64 | 5 to 25 min |
| high | 1000 | 12 × 2 panels | 10⁻⁸ | 10⁻¹¹ | 1400 | 0.12 wide, ≤ 96 | hours |

The standard result differs from draft by less than 2% in the figure, so draft is enough to explore. (The 12 partner
nodes are already converged; the levels refine the state grid, the tolerances and the loop tables.)

## 2. Grids and quadrature

**Why a log grid.** The spectrum spans many decades: the coherent peak moves from $p \approx 1$ down to $p \approx 0.05$,
the thermal tail reaches $p \approx 10$, and the low-momentum plateau must be resolved below all of that. A grid with
equal steps in $\ln p$ gives every decade the same resolution. It runs from $p_\mathrm{min} = 0.001$ to
$p_\mathrm{max} = 20$ (larger if $\xi$ is large, so the physical cutoff never shrinks), with 391 points at draft.

**Gauss-Legendre in $\ln p$.** Integrals over a partner momentum are done by Gauss-Legendre quadrature: $n$ nodes and
weights chosen so that polynomials up to degree $2n-1$ are integrated exactly. The nodes are placed uniformly in
$\ln p$ (weight $\mathrm dp = p\,\mathrm d\ln p$), matching the log grid. Between grid points, $f$ is interpolated
linearly in $\ln p$, and held at $f(p_\mathrm{min})$ below the grid.

## 3. The initial state

The measured $n_k$ (per volume, µm³) of the series' protocol is turned into the shell density
$q(k) = 4\pi k^2 n_k$ on a fixed input grid (held at the first measured $n_k$ below the first point, zero above the
last), normalised to $\int q\,\mathrm dk = 1$. It is then moved onto the solver grid and converted to the occupation
per mode, $f = 2\pi^2 n\,q/k^2$, rescaled so that $n = \frac{1}{2\pi^2}\int k^2 f\,\mathrm dk$ holds exactly on the grid.
The same $q$ gives the kinetic energy per atom $E/N = \hbar^2\langle k^2\rangle/2m$, which the plot needs for the
condensed fraction.

**The peak $k_p$.** The maximum of $k^2 f$ (i.e. of $N_k$) is located by fitting a parabola in
$(\ln k, \ln k^2 f)$ to the top of the peak, which gives a value between grid points. The run stops when $k_\xi/k_p$
reaches the series' target.

## 4. Collision geometry

This is the largest precomputed table. For every target $p$ on the grid, it enumerates the collisions
$p + p_3 \leftrightarrow p_1 + p_2$ that conserve energy and momentum:

- $p_1$ runs over Gauss nodes on $[p_\mathrm{min}, p]$ and $[p, p_\mathrm{coll}]$ (splitting at $p$ puts nodes on
  both sides of the kink of $\min(\ldots)$);
- $p_2$ runs over Gauss nodes from $\sqrt{\max(p^2-p_1^2, 0)}$ (so that $p_3^2 \geq 0$) to $p_\mathrm{coll}$, again
  split at $p$;
- **energy conservation** is used up by solving for $p_3 = \sqrt{p_1^2+p_2^2-p^2}$, so there is no delta function to
  smear out, and **momentum conservation** is already inside the kernel $\min(p,p_1,p_2,p_3)/p$ (README section 3.2);
- each collision ("event") stores its weight $w_1w_2\,p_1p_2\min(\ldots)/p$ and where $p_1, p_2, p_3$ sit on the grid.

The cutoff $p_\mathrm{coll} = p_\mathrm{max}/\sqrt2$ guarantees $p_3 \leq p_\mathrm{max}$. At draft there are about
$2\times10^5$ events. They are grouped by target and, within a target, by $p_1$ (a "pair"), because all events of a pair
share the energy transfer $|p^2 - p_1^2|$.

## 5. Transfer-momentum tables

The weight $M$ of an event is an average over the transfer momentum $Q = |\mathbf p - \mathbf p_1|$, uniform on an
interval fixed by the four magnitudes (README section 4.4). Rather than evaluating the loops separately for every
event, each pair gets one table on $Q \in [|p-p_1|, p+p_1]$, divided into equal cells (at least 16) with nodes at the
cell ends and midpoints. Every event of the pair stores its $Q$ interval in cell units. At each time step the loops are
evaluated once per table node, and every event reads its average off its pair's table.

## 6. The bubble $L_-(Q,\omega)$

The loop needs two integrals over the current spectrum (README section 4.3):

$$H(x) = \int_0^\infty s f(s)\ln\left|\frac{s-x}{s+x}\right|\mathrm ds,\qquad J(x) = \int_0^{|x|} s f(s)\,\mathrm ds.$$

$H$ has logarithmic singularities at $s = \pm x$, where naive quadrature fails. The trick is that $H$ is **linear in
$f$**: with $f$ piecewise linear between grid points (constant below $p_\mathrm{min}$, zero above $p_\mathrm{max}$),
$H(x_m) = \sum_j M^H_{mj} f_j$ at fixed abscissae $x_m$, and the matrix $M^H$ is computed once. Near the singularities
each cell's contribution is integrated in closed form (`logMoments`, `poleMoments`); elsewhere 10-point Gauss suffices.
The same is done for $H'(x)$.

At every time step: two matrix-vector products give $H$ and $H'$ at the 600 table nodes; between nodes $H$ is a cubic
Hermite interpolant in $\ln x$ (values and slopes from the table); outside the table its asymptotes are used. $J$ is
integrated exactly for the piecewise-linear $f$. Then

$$\mathrm{Re}\,L_- = \frac{1}{2N_\mathrm{cal}}\,\frac{H(x_a)-H(x_b)}{x_a-x_b},\qquad
\mathrm{Im}\,L_- = -\frac{\pi}{2N_\mathrm{cal}}\,\frac{J(x_a)-J(x_b)}{Q},\qquad x_{a,b} = \frac{|\omega|\pm Q^2}{2Q}.$$

## 7. The chain weight

At every table node, $U = 1 - \mathrm{Re}\,L_-$ and $V = \mathrm{Im}\,L_-$, so that $|1-L_-|^2 = U^2+V^2$. The weight
$1/(U^2+V^2)$ can be sharply peaked where $1 - \mathrm{Re}\,L_-$ passes through zero (a near-pole), while $U$ and $V$
themselves are smooth. So $U$ and $V$ are interpolated by the quadratic through each cell's three nodes, and
$1/(U^2+V^2)$ is integrated by 6-point Gauss-Legendre on those quadratics; in a cell where $U^2+V^2 < 0.25$ at a node, or
$U$ changes sign, the cell is split into 48 sub-panels to resolve the peak. A running integral $\Phi$ at the cell ends
makes each event's average cheap: the difference of $\Phi$ over the whole cells inside its interval, plus its two
partial end cells, divided by the interval length.

## 8. The right-hand side

For each target $p$: for each of its events, interpolate $f_1, f_2, f_3$, form gain and loss, multiply by the event
weight and the chain weight $M$, and sum; then multiply by $4\pi/N_\mathrm{cal}^2$. This is the whole of
$\partial_\tau f$. It is by far the most expensive part of a run: the table refresh and the sweep over all events
(about $2.2\times10^5$ at draft) are repeated at every one of the thousands of evaluations a run makes.

## 9. Observables

At samples 60 per decade in $t$ (from 10 µs), taken from the smooth interpolation within a time step:

- **$\bar\ell$**: fit $\ln f = A + Bk^2$ over the grid points with $k \leq k_p/5$ (the low-momentum plateau); then
  $f_0 = e^A$ and $\bar\ell^3 = f_0/n$. The plot divides by the condensed fraction to get $\ell$ (README section 6.1).
- **its rate, from the collision term**: compute $C = \partial_\tau f$, apply the same fit to $f \pm \epsilon C$, and take
  $\partial_\tau \ln f_0 = [f_0(f+\epsilon C) - f_0(f-\epsilon C)]/(2\epsilon f_0)$. Then
  $(m/\hbar)\,\mathrm d\bar\ell^2/\mathrm dt = \tfrac23\bar\ell^2\,\partial_\tau\ln f_0/(t_0\,\hbar/m)$. This is the
  instantaneous rate at that moment, with no smoothing over time. Its uncertainty is the largest change over two fit
  windows ($k_p/5$, $k_p/10$) and two steps ($\epsilon$, $2\epsilon$).
- **$k_\xi/k_p$**, and the particle number and kinetic energy relative to the start, **$N_\mathrm{rel}$,
  $E_\mathrm{rel}$**. The continuum equation conserves both; the discretised one drifts, by 0.5 to 7% in $N$ and by up
  to 40% in $E$ at 400 $a_0$ over a whole run. Its effect on the figure is a few percent (README section 7).

## 10. Time integration

The grid turns the equation into $\mathrm df/\mathrm d\tau = R(f)$, a system of about 400 (draft) to 650 (standard)
ordinary differential equations. They are stiff-ish and change timescale by orders of magnitude during a run, so the
step size must adapt.

**Dormand-Prince 5(4).** Each step evaluates $R$ at six intermediate states and combines them into a fifth-order
solution and a fourth-order one; their difference estimates the error of the step. The seventh evaluation, at the end of
the step, is the first of the next step ("first same as last"), so a step costs six evaluations.

**Step control.** The error is measured relative to the tolerance $a_\mathrm{tol} + r_\mathrm{tol}|f|$ at each grid
point and averaged in the root-mean-square sense. If the average exceeds 1, the step is rejected and retried smaller
($h \to h\max(0.2, 0.9\,\mathrm{err}^{-1/5})$); otherwise it is accepted and the next step grows by up to a factor 5.
$r_\mathrm{tol}$ is the relative accuracy per step; $a_\mathrm{tol}$ keeps near-empty grid points from forcing tiny steps.

**Dense output.** Within an accepted step, $f(\tau)$ is a cubic Hermite interpolant from the values and slopes at both
ends; the observables are recorded on it at their fixed sample times, independent of where the steps fall.

**Stopping.** After every accepted step, $k_p$ is computed; the run stops once it has crossed the target. It also stops
at the wall-time cap (status `wall-cap`, the file keeps what was reached) or if the step size collapses (`nonfinite`).

## Output

`out/runs/sNN.json`: `settings` (series, protocol, $a$, $n$, $V$, accuracy, kernel, grid), `scales`
($\xi$, $k_\xi$, $t_0$, $N_\mathrm{cal}$, $\hbar/m$), `initial` ($k_{p,0}$, $E/N$), `status`, `wall_s`, and `points`:
`t_s`, `X` $= k_\xi/k_p$, `ell_um` $= \bar\ell$, `ellRate` $= (m/\hbar)\,\mathrm d\bar\ell^2/\mathrm dt$, `ellRateErr`,
`N_rel`, `E_rel`. The file is rewritten every 30 s during a run.

**Runtimes** (8 cores, 11 series in parallel): draft about 3 min in total, standard about 1 h, with the 400 and 280 $a_0$
series the slowest (their spectra spread over more decades of $p$).

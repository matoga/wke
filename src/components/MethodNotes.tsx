/** The equations each model integrates, how they are solved, and their limits. */

import { Tex } from '../ui/Tex';
import { ACCURACY_LEVELS, LEVEL_EVENTS, PRECISION } from '../physics/precision';
import { MODELS } from '../physics/models';
import { NEGATIVE_WEIGHT_LIMIT, POLE_WEIGHT_LIMIT } from '../physics/rhs';
import { modelColor, modelDashed } from '../ui/runView';
import { LegendItem } from '../ui/primitives';

const MODEL_NOTES: Record<string, string> = {
  bare: 'Leading order in the coupling. Even in a, so attraction and repulsion relax identically.',
  'one-loop': 'Exact next order for a one-component gas. Odd in a: attraction speeds the cascade up, repulsion slows it down. Quantitative while the dressing |M − 1| stays small.',
  chain: 'All-order resummation of the exchange bubble chain, as in the large-N vector model, placed on the one-component tree level. Reduces to 1 + 2 Re L₋ at one loop.',
  heuristic: 'Exchange chain with the one-component rung weight 4. It reproduces the exchange part 8 Re L₋ of the one-loop term, but omits L₊ and all crossed diagrams, and the location of its pole, 4 Re L₋ = 1, is not derived. A mean-field linear-response argument would place it at 2 Re L₋ = 1 instead.',
};

export function MethodNotes() {
  return (
    <section className="card notes" aria-label="Method">
      <span className="label">Method</span>

      <h3>The kinetic equation</h3>
      <p>
        A weakly interacting Bose gas with contact coupling <Tex math="g = 4\pi\hbar^2 a/m" /> is described, for
        occupations much larger than one, by the four-wave kinetic equation for the isotropic momentum distribution. In
        units where <Tex math="\omega_p = p^2" />, time <Tex math="\tau = \hbar t/2m" /> and <Tex math="\lambda = 4\pi a" />,
      </p>
      <Tex block math={String.raw`\partial_\tau n_1 = 16\pi\lambda^2 \int d^3p_2\, d^3p_3\, d^3p_4\; n_1n_2n_3n_4\left(\dfrac{1}{n_1}+\dfrac{1}{n_2}-\dfrac{1}{n_3}-\dfrac{1}{n_4}\right)\, M_{1234}\;\delta(\omega_1+\omega_2-\omega_3-\omega_4)\,\delta^3(\mathbf p_1+\mathbf p_2-\mathbf p_3-\mathbf p_4)`} />
      <p>
        with <Tex math="\int d^3p\, n_p" /> equal to the density. The models differ only in the dressing{' '}
        <Tex math="M_{1234}" /> of each collision, built from two one-loop bubbles of the current spectrum: the
        particle-particle bubble <Tex math="L_+" /> at total momentum <Tex math="p_+ = |\mathbf p_1 + \mathbf p_2|" /> and
        the exchange bubble <Tex math="L_-" /> at transfer <Tex math="p_- = |\mathbf p_4 - \mathbf p_2|" />,{' '}
        <Tex math="\omega_- = \omega_4 - \omega_2" />:
      </p>
      <Tex block math={String.raw`\mathrm{Re}\,L_+ = \frac{4\pi\lambda}{p_+}\int_0^\infty dq\, q\, n_q \ln\left|\frac{q^2 - q p_+ + \mathbf p_1\!\cdot\mathbf p_2}{q^2 + q p_+ + \mathbf p_1\!\cdot\mathbf p_2}\right|`} />
      <Tex block math={String.raw`L_- = \frac{2\pi\lambda}{p_-}\int_0^\infty dq\, q\, n_q \ln\left|\frac{(p_-^2 - 2p_-q)^2 - \omega_-^2}{(p_-^2 + 2p_-q)^2 - \omega_-^2}\right| \;-\; i\,\frac{2\pi^2\lambda}{p_-}\int_{|p_-^2-\omega_-|/2p_-}^{(p_-^2+\omega_-)/2p_-} dq\, q\, n_q`} />
      <p>
        Both are odd in <Tex math="a" />. For a fixed spectral shape they scale as{' '}
        <Tex math="(k_\xi/k_p)^2" /> with <Tex math="k_\xi = \sqrt{8\pi n|a|}" />, so the classical dynamics depend on{' '}
        <Tex math="n" /> and <Tex math="a" /> only through <Tex math="na" /> and the sign of <Tex math="a" />.
      </p>

      <h3>Models</h3>
      <div className="tablewrap">
        <table className="models-table">
          <colgroup><col className="model-col" /><col className="dressing-col" /><col className="contains-col" /></colgroup>
          <thead><tr><th>Model</th><th>Dressing</th><th>What it contains</th></tr></thead>
          <tbody>
            {MODELS.map((m) => (
              <tr key={m.id}>
                <td><LegendItem color={modelColor(m.id)} dashed={modelDashed(m.id, 'classical')} label={m.label} /></td>
                <td><Tex math={m.bracket} /></td>
                <td>{MODEL_NOTES[m.id]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        The brackets <Tex math="\langle\cdot\rangle_s" /> and <Tex math="\langle\cdot\rangle_t" /> are averages over the
        angular configurations of the particle-particle (<Tex math="s" />) and exchange (<Tex math="t" />) channels. For
        fixed magnitudes, momentum conservation leaves the total and the transferred momentum uniformly distributed over
        an interval of length <Tex math="2\min(p_1,p_2,p_3,p_4)" />; the dressing of the resummed models is averaged
        there as a whole, not built from an averaged loop. Crossed (non-bubble) diagrams beyond one loop are in none of
        the models.
      </p>

      <h3>Numerics</h3>
      <p>
        The distribution lives on a logarithmic grid in <Tex math="p = k\xi" />. For every grid momentum the angular
        integrals are done exactly and the two partner momenta are integrated with composite Gauss-Legendre rules,
        which gives a fixed table of collision events. The loops reduce to two one-dimensional functionals of the
        spectrum; their logarithmic singularities are integrated in closed form against the piecewise-linear
        distribution, and they are rebuilt at every evaluation of the right-hand side. Time stepping is adaptive
        Dormand-Prince 5(4), and the stop time is located on its dense output. The peak <Tex math="k_p" /> is the vertex
        of a least-squares parabola through the top 2% of <Tex math="\ln(k^2 n_k)" /> against <Tex math="\ln k" />, which
        keeps it stable when a broad peak is sampled on a grid. The collision sum is split across the processor's cores.
      </p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Accuracy</th><th className="n">grid points</th><th className="n">nodes per partner</th><th className="n">collision events</th><th className="n">rel. tolerance</th></tr></thead>
          <tbody>
            {ACCURACY_LEVELS.map((l) => (
              <tr key={l}>
                <td>{PRECISION[l].label}</td>
                <td className="n">{PRECISION[l].nGrid}</td>
                <td className="n">{2 * PRECISION[l].panels * PRECISION[l].nqLow}</td>
                <td className="n">{(LEVEL_EVENTS[l] / 1e6).toFixed(2)} M</td>
                <td className="n">{PRECISION[l].rtol.toExponential(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Validation: the loop functionals agree with an independent continuum evaluation to better than 10⁻³ and
        converge at second order in the grid spacing. The dressing of every loop model agrees with it to 4 × 10⁻³ at Standard accuracy and 4 × 10⁻⁴ at High.
        At Standard accuracy the stop time of a smooth shell is within 0.05% of the converged value and that of a
        structured measured spectrum within 0.5%; at High, 0.02% and 0.1%. Tick{' '}
        <b>Check convergence</b> to measure the error of any run by rerunning it one level higher.
      </p>

      <h3>Limits</h3>
      <p>
        The loop models use classical wave statistics; only the bare equation offers the Bose <Tex math="f \to f + 1" />{' '}
        terms. A one-loop run stops when its bracket <Tex math="M" /> turns negative on more than{' '}
        {NEGATIVE_WEIGHT_LIMIT * 100}% of the collision weight, and a resummed run stops when{' '}
        <Tex math="1/|1 - cL_-|^2" /> reaches {POLE_WEIGHT_LIMIT}: past these points the models say nothing
        quantitative. The resummed vertices can approach their pole for repulsive gases too, because{' '}
        <Tex math="\mathrm{Re}\,L_-" /> changes sign across the resonant configurations. Particle number and energy are
        conserved by the equation; their small drift is the discretisation error of the truncated grid and is shown with
        every run.
      </p>
    </section>
  );
}

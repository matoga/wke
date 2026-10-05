/**
 * ±a pairs (slow: several full bubble-chain runs; part of `npm run test:full`).
 *
 * The two signs of a pair integrate concurrently on views of one backend and share its tables. Each must come
 * out as if it had run alone, and a held pair must end at the common time, whichever run is faster.
 */

import { interpolateQ } from '../src/physics/grid';
import { INPUT_GRID } from '../src/physics/descriptors';
import { localBackend, runSimulation } from '../src/physics/simulate';
import { PairRegistry } from '../src/physics/pairHold';
import type { WKEResult, WKERunRequest } from '../src/types/wke';
import { check, loadData, note, relClose, report, section } from './harness';

const fixtures = loadData('fixtures.json');
const META = fixtures.metadata;
const gaussian: { raw_k: number[]; raw_q: number[] } = fixtures.profiles[0];

section('±a pair: two runs at once on shared tables');
{
  // The two signs of a pair integrate concurrently on two views of one backend, interleaving their steps on
  // shared grids and tables. Each must come out exactly as if it had run alone.
  const request = (a_a0: number, runId: string): WKERunRequest => ({
    type: 'run', runId, model: 'chain', kernel: 'classical', accuracy: 'draft',
    q: Array.from(interpolateQ(gaussian.raw_k, gaussian.raw_q, INPUT_GRID)),
    density_um3: META.density_um3, a_a0, speciesKey: 'K39', stopKpFraction: 0.8, stopAtBreakdown: true, tauMax: 4000, nSnapshots: 20,
  });
  const solo = localBackend();
  const alonePlus = (await runSimulation(request(50, 'p'), solo.view())).result;
  const aloneMinus = (await runSimulation(request(-50, 'm'), solo.view())).result;
  const shared = localBackend();
  const [plus, minus] = (await Promise.all([
    runSimulation(request(50, 'p'), shared.view()), runSimulation(request(-50, 'm'), shared.view()),
  ])).map((x) => x.result);
  const same = (x: WKEResult, y: WKEResult) => x.dtTarget_s === y.dtTarget_s && x.nSteps === y.nSteps
    && x.kpTrack.kp.every((v, i) => v === y.kpTrack.kp[i]);
  check('concurrent +a run equals the run alone, bit for bit', same(plus, alonePlus), `${plus.dtTarget_s} vs ${alonePlus.dtTarget_s}`);
  check('concurrent −a run equals the run alone, bit for bit', same(minus, aloneMinus), `${minus.dtTarget_s} vs ${aloneMinus.dtTarget_s}`);
  check('the two signs differ (the chain is odd in a at one loop)', plus.dtTarget_s !== minus.dtTarget_s,
    `${plus.dtTarget_s} vs ${minus.dtTarget_s}`);
  check('the pair keeps its runs apart: keys end in + and −', plus.runKey.endsWith(':+') && minus.runKey.endsWith(':-'),
    `${plus.runKey}, ${minus.runKey}`);
  note(`  chain at ±50 a₀, Draft: t₊ = ${(plus.dtTarget_s! * 1e3).toFixed(3)} ms, t₋ = ${(minus.dtTarget_s! * 1e3).toFixed(3)} ms`);

  // Held as a pair, the run that reaches its target first goes on evolving until the other gets there too.
  const registry = new PairRegistry();
  const held = await Promise.all([request(50, 'hp'), request(-50, 'hm')].map(async (req) => {
    const { hold, end } = registry.join(req.runId, { id: 'pair', size: 2 });
    try { return (await runSimulation({ ...req, pair: { id: 'pair', size: 2 } }, shared.view(), undefined, undefined, hold)).result; }
    finally { end(); }
  }));
  const [hp, hm] = held;
  const tEndOf = (r: WKEResult) => r.snapshots.at(-1)!.t_s;
  const common = Math.max(alonePlus.dtTarget_s!, aloneMinus.dtTarget_s!);
  check('held pair: each target time is the one it has alone', hp.dtTarget_s === alonePlus.dtTarget_s && hm.dtTarget_s === aloneMinus.dtTarget_s,
    `${hp.dtTarget_s} / ${hm.dtTarget_s}`);
  relClose('held pair: both runs end together, at the later target time (+a)', tEndOf(hp), common, 1e-9);
  relClose('held pair: both runs end together, at the later target time (−a)', tEndOf(hm), common, 1e-9);
  // The same with one side slowed down, so the runs cross their targets in the other wall-clock order and the
  // crossing step of one passes the common end before that end is known.
  for (const slowSign of [1, -1]) {
    const reg = new PairRegistry();
    const [sp, sm] = await Promise.all([request(50, 'sp'), request(-50, 'sm')].map(async (req) => {
      const { hold, end } = reg.join(req.runId, { id: 'slow', size: 2 });
      const view = shared.view();
      const slowed = Math.sign(req.a_a0) === slowSign
        ? { ...view, rhs: async (f: Float64Array, out: Float64Array) => {
          for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
          return view.rhs(f, out);
        } }
        : view;
      try { return (await runSimulation(req, slowed, undefined, undefined, hold)).result; } finally { end(); }
    }));
    check(`held pair with ${slowSign > 0 ? '+a' : '−a'} slowed: both end at the common time`,
      Math.abs(tEndOf(sp) / common - 1) < 1e-9 && Math.abs(tEndOf(sm) / common - 1) < 1e-9, `${tEndOf(sp)}, ${tEndOf(sm)} vs ${common}`);
  }
  const early = hp.dtTarget_s! < hm.dtTarget_s! ? hp : hm;
  check('the run that got there first kept evolving past its target', early.snapshots.at(-1)!.kp_um_inv < early.stopKpFraction * early.kp0_um_inv * 0.999,
    `k_p/k_p0 at the end: ${(early.snapshots.at(-1)!.kp_um_inv / early.kp0_um_inv).toFixed(4)}`);
}

report();

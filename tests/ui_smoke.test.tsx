/**
 * Headless UI smoke test: mounts the whole app in jsdom and drives it, with a
 * stub in place of the solver worker (the solver is covered by the physics
 * suites).
 */

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true });
for (const k of ['HTMLElement', 'Node', 'Element', 'Event', 'MouseEvent', 'MutationObserver', 'HTMLInputElement']) {
  g[k] = (dom.window as unknown as Record<string, unknown>)[k];
}
g.getComputedStyle = dom.window.getComputedStyle;
g.localStorage = dom.window.localStorage;
g.devicePixelRatio = 1;
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
(dom.window as unknown as Record<string, unknown>).matchMedia = () => ({
  matches: false, media: '', onchange: null, addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
});

const MODEL_FACTOR: Record<string, number> = { bare: 1, 'one-loop': 1.19, chain: 1.03, 'heuristic-b': 1.13 };
const posted: Array<Record<string, unknown>> = [];

class WorkerStub {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: unknown = null;
  postMessage(req: Record<string, unknown>) {
    posted.push(req);
    setTimeout(() => this.respond(req), 1);
  }
  respond(req: Record<string, unknown>) {
    const n = 500;
    const k = Array.from({ length: n }, (_, i) => 0.01 * Math.pow(868, i / (n - 1)));
    const q = k.map((kk) => Math.exp(-0.5 * ((kk - 2) / 0.28) ** 2) / 0.7);
    const model = (req.model as string) ?? 'bare';
    const a = (req.a_a0 as number) ?? 25;
    // attraction speeds the loop models up a little, so a pair has a ratio to show; bare is even in a
    const f = (MODEL_FACTOR[model] ?? 1) * (a < 0 && model !== 'bare' ? 0.9 : 1);
    const pole = model === 'heuristic-b' && a < 0;
    const dt = pole ? null : 0.3136 * f;
    const tEnd = dt ?? 0.1;
    const track = { t_s: [0, tEnd / 2, tEnd], kp: [2, 1.5, pole ? 1.7 : 1], loop: [0, -0.1, -0.12], pole: [NaN, NaN, NaN] };
    if (model !== 'bare') track.pole = model === 'one-loop' ? [0.8, 0.78, 0.76] : [1.1, 1.2, pole ? 11 : 1.3];
    const tEval = (req.tEval_s as number[] | undefined) ?? [];
    const kpAt = (t: number) => (t <= tEnd / 2 ? 2 - (t / (tEnd / 2)) * 0.5 : 1.5 - ((t - tEnd / 2) / (tEnd / 2)) * 0.5);
    const accuracy = (req.accuracy as string) ?? 'standard';
    const continuation = req.type === 'continue';
    const runKey = continuation ? req.runKey : `${model}:${req.kernel}:${accuracy}:${a < 0 ? '-' : '+'}`;
    this.onmessage?.({
      data: {
        type: 'result', runId: req.runId, runKey, model: continuation ? String(runKey).split(':')[0] : model,
        kernel: continuation ? 'classical' : req.kernel, accuracy: continuation ? String(runKey).split(':')[2] : accuracy,
        continuation,
        k_um_inv: k, kp0_um_inv: 2, stopKpFraction: req.stopKpFraction ?? 0.5,
        reachedTarget: !pole && !continuation, tauTarget: dt, dtTarget_s: continuation ? null : dt,
        termination: pole ? 'pole' : continuation ? 'steps' : 'target',
        terminationMessage: pole ? 'The resummed vertex reached its pole: collisions with a dressing above 10 carry 2.4% of the collision rate.' : null,
        snapshots: [
          { tau: 0, t_s: 0, kp_um_inv: 2, q, dN_over_N: 0, dE_over_E: 0, stage: 'initial' },
          { tau: 1, t_s: tEnd, kp_um_inv: 1, q, dN_over_N: 0, dE_over_E: 0, stage: 'final' },
        ],
        kpTrack: track,
        evalTrack: { t_s: tEval, kp: tEval.map(kpAt) },
        scales: { xi_um: 3.3, t0_s: 0.02, ncal: 3000, na_um2: 1e-3, density_um3: 2.8331, sign: a < 0 ? -1 : 1 },
        nSteps: 30, nRhs: 180, nRejected: 0, wallTime_ms: 1500, setup_ms: 200, nEvents: 1.1e6, threads: 7,
        gridCoverage: 1, maxDN: 0.002, maxDE: 0.004,
      },
    } as MessageEvent);
  }
  terminate() {}
}
g.Worker = WorkerStub;
g.URL = dom.window.URL;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
g.IS_REACT_ACT_ENVIRONMENT = true;
const App = (await import('../src/App')).default;

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`PASS  ${name}`); } else { failures.push(`${name}${detail ? `: ${detail}` : ''}`); console.log(`FAIL  ${name}  ${detail}`); }
}

// A setting stored before the sign control held a signed a.
dom.window.localStorage.setItem('wke-sim-v2:system', JSON.stringify({
  mode: 'N_V', speciesKey: 'K39', N: 250000, V_um3: 88243, L_um: 48.3, aspect: 0.5, density_um3: 2.8331, a_a0: -30,
}));

const container = dom.window.document.getElementById('root')!;
const root = createRoot(container);
await act(async () => { root.render(React.createElement(App)); });

const text = () => container.textContent ?? '';
const buttons = () => Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
const byText = (t: string) => buttons().find((b) => (b.textContent ?? '').trim().startsWith(t));
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const click = async (el: Element | undefined, name = '') => {
  if (!el) throw new Error(`element not found: ${name}`);
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
};
const setInput = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};
const fieldInput = (labelStart: string) => {
  const label = Array.from(container.querySelectorAll('label.field')).find((l) =>
    (l.querySelector('.label')?.textContent ?? '').includes(labelStart));
  return label?.querySelector('input') as HTMLInputElement | undefined;
};

check('app mounts', container.children.length > 0);
check('title renders', text().includes('Bose Gas') && text().includes('kinetic equation solver'));
for (const banned of ['Calibrat', 'κ', 'Δt₁ᐟ₂', 'calibration']) {
  check(`no calibration wording ("${banned}")`, !text().includes(banned));
}

const modelList = () => Array.from(container.querySelectorAll('.models .model')) as HTMLButtonElement[];
check('three controlled models offered by default', modelList().length === 3, `${modelList().length}`);
const heuristicsBox = Array.from(container.querySelectorAll('label.check')).find((l) => (l.textContent ?? '').includes('Show heuristic models'))!
  .querySelector('input') as HTMLInputElement;
await click(heuristicsBox, 'show heuristics');
check('the heuristics join the list on request', modelList().length === 6, `${modelList().length}`);
check('heuristic B carries a "very slow" pill', (modelList().find((b) => (b.textContent ?? '').includes('Heuristic B'))?.querySelector('.pill')?.textContent ?? '') === 'very slow');
const modelButtons = modelList();
check('exactly one model selected', modelButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').length === 1);
const accuracy = container.querySelector('[aria-label="Accuracy"]');
check('accuracy is a four-level segmented control', accuracy?.querySelectorAll('button').length === 4);

// A stored signed a becomes |a| and a sign.
const aInput = container.querySelector('input[aria-label="Scattering length |a| (a₀)"]') as HTMLInputElement;
const signButton = (label: string) => Array.from(container.querySelectorAll('[aria-label="Sign of the scattering length"] button'))
  .find((b) => (b.textContent ?? '').startsWith(label)) as HTMLButtonElement | undefined;
check('stored a = −30 migrates to |a| = 30, attractive', aInput.value === '30' && signButton('Attractive')?.getAttribute('aria-pressed') === 'true',
  `${aInput.value}, ${signButton('Attractive')?.getAttribute('aria-pressed')}`);
await click(signButton('Repulsive'), 'repulsive');

// Attractive interactions are accepted; a = 0 is not.
await setInput(aInput, '0');
check('a = 0 blocks the run', byText('Run simulation (One loop)')?.disabled === true && text().includes('non-zero'));
await setInput(aInput, '-27');
check('negative a is accepted', byText('Run simulation (One loop)')?.disabled === false && !text().includes('non-zero'));
check('a negative |a| switches the sign to attractive', aInput.value === '27' && signButton('Attractive')?.getAttribute('aria-pressed') === 'true');
await click(signButton('Repulsive'), 'repulsive');
await setInput(aInput, '25');

// Cylinder geometry.
await click(byText('N and cylinder'), 'cylinder mode');
check('cylinder volume is derived', text().includes('Cylinder volume'));
await click(byText('N and V'), 'N and V mode');

// A single run.
await click(byText('Run simulation (One loop)'), 'run');
await settle();
check('hero shows the stop time', (container.querySelector('.hero-num')?.textContent ?? '').includes('373.2'),
  container.querySelector('.hero-num')?.textContent ?? '');
check('hero names the model', text().includes('One loop, N = 1'));
check('run is recorded for comparison', container.querySelectorAll('tbody tr').length >= 1);
check('loop verdict badge shown', text().includes('perturbative') || text().includes('marginal'));

// All models on the same setup.
await click(byText('Run all models'), 'run all');
for (let i = 0; i < 10; i++) await settle();
const rows = Array.from(container.querySelectorAll('section[aria-label="Peak momentum against time"] tbody tr'));
check('all six models appear in the comparison table', rows.length === 6, `${rows.length}`);
check('comparison reports ratios to bare', text().includes('1.1900'));

// Heuristic model with attraction runs into the pole.
await click(modelButtons.find((b) => (b.textContent ?? '').includes('Heuristic B')), 'heuristic');
await setInput(aInput, '-25');
await click(byText('Run simulation (Heuristic B)'), 'run heuristic');
await settle();
check('pole stop is reported', text().includes('reached its pole') && text().includes('stopped at the pole'));
await click(signButton('Repulsive'), 'repulsive');
await setInput(aInput, '25');

// ±a pair: both signs from the same state, side by side.
await click(modelButtons.find((b) => (b.textContent ?? '').includes('Bubble chain')), 'chain');
await click(signButton('Both'), 'both signs');
check('pair mode explains itself', text().includes('side by side from the same initial state'));
const before = posted.length;
await click(byText('Run ±a (N → ∞)'), 'run pair');
for (let i = 0; i < 4; i++) await settle();
const pairRuns = posted.slice(before).filter((p) => p.type === 'run');
check('a pair posts two runs at ±|a|, otherwise identical', pairRuns.length === 2
  && pairRuns.map((p) => p.a_a0).sort().join() === '-25,25'
  && pairRuns[0].model === pairRuns[1].model && pairRuns[0].accuracy === pairRuns[1].accuracy
  && JSON.stringify(pairRuns[0].q) === JSON.stringify(pairRuns[1].q), JSON.stringify(pairRuns.map((p) => p.a_a0)));
const cols = Array.from(container.querySelectorAll('.pair-col'));
check('the headline has one column per sign', cols.length === 2
  && (cols[0].querySelector('.hero-num')?.textContent ?? '').includes('323.0')
  && (cols[1].querySelector('.hero-num')?.textContent ?? '').includes('290.7'),
  cols.map((c) => c.querySelector('.hero-num')?.textContent).join(' | '));
check('the ratio of the stop times is shown', (container.querySelector('.pair-ratio')?.textContent ?? '').includes('0.9000')
  && text().includes('attraction 10.0% faster'), container.querySelector('.pair-ratio')?.textContent ?? '');
check('the comparison table pairs the signs', text().includes('t₋/t₊') && text().includes('0.9000'));
check('the spectrum overlays both signs with a difference strip', text().includes('−a minus +a'));
await click(byText('Continue'), 'continue pair');
await settle();
const conts = posted.slice(-2);
check('continue extends both runs', conts.every((p) => p.type === 'continue') && new Set(conts.map((p) => p.runKey)).size === 2,
  conts.map((p) => `${p.type}:${p.runKey}`).join(', '));
await click(modelButtons.find((b) => (b.textContent ?? '').includes('Bare')), 'bare');
const beforeBare = posted.length;
await click(byText('Run ±a (Bare)'), 'run bare pair');
for (let i = 0; i < 4; i++) await settle();
check('the bare pair runs once: the equation is even in a', posted.slice(beforeBare).filter((p) => p.type === 'run').length === 1
  && text().includes('even in'), String(posted.slice(beforeBare).filter((p) => p.type === 'run').length));
await click(signButton('Repulsive'), 'repulsive');

// Convergence check.
const convergence = Array.from(container.querySelectorAll('label.check')).find((l) => (l.textContent ?? '').includes('Check convergence'))!
  .querySelector('input') as HTMLInputElement;
await click(convergence, 'convergence toggle');
await click(modelButtons.find((b) => (b.textContent ?? '').includes('Bare')), 'bare');
await click(byText('Run simulation (Bare)'), 'run bare');
for (let i = 0; i < 6; i++) await settle();
const checkRun = posted.filter((p) => p.type === 'run').at(-1)!;
check('convergence rerun goes one level up', checkRun.accuracy === 'high' && Array.isArray(checkRun.tEval_s), String(checkRun.accuracy));
check('convergence verdict shown', text().includes('converged to 0.00%'), text().match(/converged[^.]*/)?.[0] ?? '');
check('hero carries the error estimate', (container.querySelector('.hero-num')?.textContent ?? '').includes('±'));

// Continue the selected run.
await click(byText('Continue'), 'continue');
await settle();
check('continue request names the run', posted.at(-1)?.type === 'continue' && typeof posted.at(-1)?.runKey === 'string');

// Style rules.
check('no em dash anywhere in the rendered text', !text().includes('\u2014'));
const axisTitles = Array.from(container.querySelectorAll('text.axis-title')).map((t) => t.textContent ?? '');
check('axis units use round brackets', axisTitles.some((t) => t.includes('(μm⁻¹)')) && !axisTitles.some((t) => /\[[^\]]*\]/.test(t)),
  axisTitles.join(' | '));
check('field units use round brackets', !Array.from(container.querySelectorAll('.unit')).some((u) => /\[[^\]]*\]/.test(u.textContent ?? '')));
check('no inline fixed-width font styling', !container.innerHTML.includes('mono' + 'space'));
check('equations are typeset', container.querySelectorAll('.katex').length > 10);

await act(async () => { root.unmount(); });
{
  // Pure helpers: verdicts of a run that went on past its target.
  const { loopVerdict, terminationVerdict } = await import('../src/ui/runView');
  const { mergeContinuation } = await import('../src/state/useRunLibrary');
  type R = import('../src/types/wke').WKEResult;
  const track = (share: number[]) => ({
    t_s: share.map((_, i) => i), kp: share.map(() => 1), loop: share.map(() => 0), pole: share.map(() => 1), share,
  });
  const base = {
    model: 'chain', stopKpFraction: 0.5, kp0_um_inv: 2, reachedTarget: true, tauTarget: 2, dtTarget_s: 2,
    termination: 'target', terminationMessage: null, breakdown: null, latticeStride: 1,
    snapshots: [{ tau: 0, t_s: 0, stage: 'initial' }, { tau: 3, t_s: 3, stage: 'final' }],
    kpTrack: track([0, 0, 0, 0.5]), nSteps: 3, nRhs: 9, nRejected: 0, wallTime_ms: 1, maxDN: 0, maxDE: 0,
  } as unknown as R;
  const lv = loopVerdict(base)!;
  check('loop verdict is judged up to the target', lv.tone === 'ok', lv.text);
  check('loop verdict names a breakdown past the target', /past the target at the pole/.test(lv.text), lv.text);
  const seg = { ...base, reachedTarget: false, tauTarget: null, dtTarget_s: null, termination: 'tauMax',
    snapshots: [{ tau: 0, t_s: 0, stage: 'initial' }, { tau: 3, t_s: 3, stage: 'final' }], kpTrack: track([0.5, 0.5]) } as unknown as R;
  const merged = mergeContinuation(base, seg);
  check('a pair continuation past the target keeps its target verdict', terminationVerdict(merged).tone === 'ok', merged.termination);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
process.exit(0);

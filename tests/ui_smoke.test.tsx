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

const MODEL_FACTOR: Record<string, number> = { bare: 1, 'one-loop': 1.19, chain: 1.03, heuristic: 1.13 };
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
    const f = MODEL_FACTOR[model] ?? 1;
    const pole = model === 'heuristic' && a < 0;
    const dt = pole ? null : 0.3136 * f;
    const tEnd = dt ?? 0.1;
    const track = { t_s: [0, tEnd / 2, tEnd], kp: [2, 1.5, pole ? 1.7 : 1], loop: [0, -0.1, -0.12], pole: [NaN, NaN, NaN] };
    if (model !== 'bare') track.pole = model === 'one-loop' ? [0.8, 0.78, 0.76] : [1.1, 1.2, pole ? 11 : 1.3];
    const tEval = (req.tEval_s as number[] | undefined) ?? [];
    const kpAt = (t: number) => (t <= tEnd / 2 ? 2 - (t / (tEnd / 2)) * 0.5 : 1.5 - ((t - tEnd / 2) / (tEnd / 2)) * 0.5);
    const accuracy = (req.accuracy as string) ?? 'standard';
    const continuation = req.type === 'continue';
    const runKey = continuation ? req.runKey : `${model}:${req.kernel}:${accuracy}`;
    this.onmessage?.({
      data: {
        type: 'result', runId: req.runId, runKey, model: continuation ? String(runKey).split(':')[0] : model,
        kernel: continuation ? 'classical' : req.kernel, accuracy: continuation ? String(runKey).split(':')[2] : accuracy,
        continuation,
        k_um_inv: k, kp0_um_inv: 2, stopKpFraction: req.stopKpFraction ?? 0.5,
        reachedTarget: !pole && !continuation, tauTarget: dt, dtTarget_s: continuation ? null : dt,
        termination: pole ? 'pole' : continuation ? 'steps' : 'target',
        terminationMessage: pole ? 'The resummed vertex approached its pole: 1/|1 − 4L₋|² reached 11.0.' : null,
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
check('title renders', text().includes('Bose Gas Kinetics'));
for (const banned of ['Calibrat', 'κ', 'Δt₁ᐟ₂', 'calibration']) {
  check(`no calibration wording ("${banned}")`, !text().includes(banned));
}

const modelButtons = Array.from(container.querySelectorAll('.models .model')) as HTMLButtonElement[];
check('five kinetic models offered', modelButtons.length === 5, `${modelButtons.length}`);
check('exactly one model selected', modelButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').length === 1);
const accuracy = container.querySelector('[aria-label="Accuracy"]');
check('accuracy is a four-level segmented control', accuracy?.querySelectorAll('button').length === 4);

// Attractive interactions are accepted; a = 0 is not.
const aInput = fieldInput('Scattering length')!;
await setInput(aInput, '0');
check('a = 0 blocks the run', byText('Run simulation (One loop)')?.disabled === true && text().includes('non-zero'));
await setInput(aInput, '-27');
check('negative a is accepted', byText('Run simulation (One loop)')?.disabled === false && !text().includes('non-zero'));
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
check('all five models appear in the comparison table', rows.length === 5, `${rows.length}`);
check('comparison reports ratios to bare', text().includes('1.1900'));

// Heuristic model with attraction runs into the pole.
await click(modelButtons.find((b) => (b.textContent ?? '').includes('Heuristic B')), 'heuristic');
await setInput(aInput, '-25');
await click(byText('Run simulation (Heuristic B)'), 'run heuristic');
await settle();
check('pole stop is reported', text().includes('approached its pole') && text().includes('stopped at the pole'));
await setInput(aInput, '25');

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
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
process.exit(0);

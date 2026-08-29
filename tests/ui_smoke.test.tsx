/**
 * Headless UI smoke test.
 *
 * Mounts the full app in jsdom and drives the parameter modes, so the wiring
 * between the physics layer and the components is exercised without a browser.
 * The Web Worker is stubbed — the solver itself is covered by
 * `cross_validation.test.ts`.
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
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.Element = dom.window.Element;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.getComputedStyle = dom.window.getComputedStyle;
g.localStorage = dom.window.localStorage;
g.MutationObserver = dom.window.MutationObserver;
g.devicePixelRatio = 1;
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
g.cancelAnimationFrame = (id: number) => clearTimeout(id);

// jsdom implements neither of these; the app only reads them.
class ResizeObserverStub {
  observe() { /* no layout in jsdom */ }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
}
g.ResizeObserver = ResizeObserverStub;
dom.window.matchMedia ??= (() => ({
  matches: false, media: '', addEventListener() {}, removeEventListener() {},
})) as unknown as typeof dom.window.matchMedia;
(dom.window as unknown as Record<string, unknown>).matchMedia = () => ({
  matches: false, media: '', onchange: null,
  addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
});
// The solver itself is covered by cross_validation.test.ts; this stub answers
// a run request with a minimal but shape-correct WKEResult so the UI branches
// that only render after a run (the log-log panel, the linear k_p(t) panel)
// get exercised without spinning up a real worker in jsdom.
class WorkerStub {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: unknown = null;
  postMessage(req: { type: string; runId: string; kernel: string; q?: number[] }) {
    if (req.type === 'run') {
      setTimeout(() => {
        const n = req.q!.length;
        const k = Array.from({ length: n }, (_, i) => 0.05 + (i / (n - 1)) * 8);
        const snapshot = (frac: number, stage: string) => ({
          tau: 1 - frac, t_s: (1 - frac) * 0.3, kp_um_inv: 2 * frac,
          q: req.q, dN_over_N: 0, dE_over_E: 0, stage,
        });
        this.onmessage?.({
          data: {
            type: 'result', runId: req.runId, kernel: req.kernel,
            k_um_inv: k, kp0_um_inv: 2,
            reachedHalf: true, tauHalf: 0.3, dtHalf_s: 0.3,
            snapshots: [snapshot(1, 'initial'), snapshot(0.5, 'final')],
            kpTrack: { t_s: [0, 0.3], kp: [2, 1] },
            scales: { xi_um: 2.3, t0_s: 6.5e-3, ncal: 1367.7, na_um2: 7.5e-3, density_um3: 2.8331 },
            nSteps: 10, nRhs: 60, nRejected: 0, wallTime_ms: 5,
            geometry_ms: 5, nEvents: 1000, gridCoverage: 1, maxDN: 0, maxDE: 0,
          },
        } as MessageEvent);
      }, 0);
      return;
    }
    if (req.type === 'continue') {
      setTimeout(() => {
        const n = 500;
        const k = Array.from({ length: n }, (_, i) => 0.05 + (i / (n - 1)) * 8);
        const q = new Array(n).fill(0.01);
        this.onmessage?.({
          data: {
            type: 'result', runId: req.runId, kernel: req.kernel, continuation: true,
            k_um_inv: k, kp0_um_inv: 2,
            reachedHalf: false, tauHalf: null, dtHalf_s: null,
            snapshots: [
              { tau: 0, t_s: 0, kp_um_inv: 1, q, dN_over_N: 0, dE_over_E: 0, stage: 'initial' },
              { tau: 1, t_s: 0.3, kp_um_inv: 0.6, q, dN_over_N: 0, dE_over_E: 0, stage: 'final' },
            ],
            kpTrack: { t_s: [0, 0.3], kp: [1, 0.6] },
            scales: { xi_um: 2.3, t0_s: 6.5e-3, ncal: 1367.7, na_um2: 7.5e-3, density_um3: 2.8331 },
            nSteps: 10, nRhs: 60, nRejected: 0, wallTime_ms: 5,
            geometry_ms: 0, nEvents: 1000, gridCoverage: 1, maxDN: 0, maxDE: 0,
          },
        } as MessageEvent);
      }, 0);
    }
  }
  terminate() { /* no-op */ }
  addEventListener(_: string, fn: (e: MessageEvent) => void) { this.onmessage = fn; }
  removeEventListener() { this.onmessage = null; }
}
g.Worker = WorkerStub;
// import.meta.url resolution inside the hook needs a URL implementation
g.URL = dom.window.URL;

const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
(g as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const App = (await import('../src/App')).default;

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`PASS  ${name}`); }
  else { failures.push(`${name}${detail ? `: ${detail}` : ''}`); console.log(`FAIL  ${name}  ${detail}`); }
}

const container = dom.window.document.getElementById('root')!;
const root = createRoot(container);

await act(async () => { root.render(React.createElement(App)); });

const text = () => container.textContent ?? '';
const buttons = () => Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
const byText = (t: string) => buttons().find((b) => (b.textContent ?? '').includes(t));

const click = async (el: Element | undefined) => {
  if (!el) throw new Error('element not found');
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
};

const setInput = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};

const numberInputs = () => Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
const selects = () => Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
const setSelect = async (el: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
};

check('app mounts', container.children.length > 0);
check('header renders', text().includes('WKE Solver'));

// --- Simulate tab (the default) ---
check('four workflow tabs present',
  ['Play', 'Solve', 'Calibrate volume', 'Export'].every((t) => byText(t) != null));
check('Simon preset loaded by default', text().includes('Simon Set 93'));
check('descriptors computed', text().includes('1.858'), 'expected k_p,0 ≈ 1.858');
check('formula-domain verdict absent from state import', !text().includes('inside validated domain'));

const cards = () => Array.from(container.querySelectorAll('section'));
const initialCard = cards().find((c) => (c.textContent ?? '').includes('Initial state'));
check('spectrum and descriptors merged into one panel', initialCard != null);
check('merged panel holds the import controls', (initialCard?.textContent ?? '').includes('Example'));
check('merged panel holds the descriptors', initialCard?.querySelector('.katex') != null);
const drawSource = byText('Draw');
check('draw source available', drawSource != null);
if (drawSource) {
  await click(drawSource);
  check('draw mode reuses the main spectrum plot', text().includes('Draw directly on the spectrum plot'));
  check('draw mode does not show CSV import', !text().includes('Drop a CSV here'));
  check('draw mode applies automatically', byText('Use this shape') == null && text().includes('applied automatically'));
  await click(byText('Examples')!);
}
check('initial state has shape controls', byText('Smooth') != null && byText('Sharpen') != null);

check('initial state panel on top',
  (cards()[0]?.textContent ?? '').includes('Initial state'),
  `first panel was: ${(cards()[0]?.textContent ?? '').slice(0, 40)}`);
check('simulation is locked before accepting the state',
  text().includes('Accept the initial state above to continue.'));
await click(byText('Accept initial state'));
check('accepted state collapses to a summary',
  text().includes('Simon Set 93') && byText('Edit state') != null);
check('simulation unlocks after acceptance', byText('Run') != null);
await click(cards()[0]);
check('clicking the collapsed initial-state card reopens it for editing', byText('Smooth') != null);
await click(byText('Accept initial state'));

check('no bare q(k) label on the Simulate tab', !/\bq\(k/.test(text()), 'found a q(k) label');
check('spectra labelled N_k', text().includes('N_k'));

await click(byText('Play'));
check('playground tab opens as a single card', cards().length === 1 && (cards()[0]?.textContent ?? '').includes('Play'));
check('playground has a preset selector', selects().some((select) => select.getAttribute('aria-label') === 'Preset state'));
check('playground can run the current state', byText('Run') != null);
await click(byText('Solve'));

await click(byText('Run'));
await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
check('log-log spectrum panel present', text().includes('log-log'));
check('log-log panel plots occupation number, not shell density', text().includes('atoms / mode'));
check('linear k_p(t) panel present', text().includes('Peak wavevector') && text().includes('linear'));
check('new solve starts at first frame and autoplays', byText('Pause') != null);
check('completed solve does not offer a redundant re-run', byText('Re-run') == null);
check('playback is time-based, not a snapshot index', /Playback: 0 to/.test(text()));
check('no snapshot-count scrubber label remains', !text().includes('saved snapshots'), 'still calls them "saved snapshots"');

const continueBtn = byText('Simulate further');
check('continue control present once a run exists', continueBtn != null);
if (continueBtn) {
  const totalBefore = /Playback: 0 to ([0-9.]+ ?\w*)/.exec(text())?.[1];
  await click(continueBtn);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const totalAfter = /Playback: 0 to ([0-9.]+ ?\w*)/.exec(text())?.[1];
  check('continue extends the playback range', totalBefore != null && totalAfter != null && totalBefore !== totalAfter,
    `before=${totalBefore} after=${totalAfter}`);
  check('resume point is marked on the timeline', byText('resumed here') != null);

check('no snapshot-granularity selector remains', byText('Very fine timeline') == null && byText('Coarse timeline') == null);
const allTimesBtn = byText('Rainbow');
check('rainbow view mode present', allTimesBtn != null);
check('background-free animation mode present', byText('Solo') != null);
check('rainbow-backed animation is the default',
  buttons().some((button) => (button.textContent ?? '').trim() === 'Animate' && button.getAttribute('aria-selected') === 'true'));
if (allTimesBtn) {
  await click(allTimesBtn);
  check('rainbow legend shown in all-times mode', text().includes('t = 0') && /All \d+/.test(text()));
  check('play control hidden in all-times mode', byText('▶ Play') == null);
  await click(byText('Animate')!);
  check('play control returns in animate mode', byText('▶ Play') != null);
}
}

const normButtons = () => buttons().filter((b) => ['N_k / N', 'N_k'].includes((b.textContent ?? '').trim()));
check('normalization switch present', normButtons().length === 2, `found ${normButtons().length} options`);
check('unit norm is the default', text().includes('∫ dk = 1') || text().includes('normalized to'));
await click(normButtons().find((b) => (b.textContent ?? '').trim() === 'N_k'));
check('experimental norm explains its scale',
  text().includes('imported column') || text().includes('scaled to N ='));
await click(normButtons().find((b) => (b.textContent ?? '').trim() === 'N_k / N'));

// Formula certification belongs to formula evaluation, not state import.
await click(byText('Edit state'));
const presetSelect = selects().find((sel) =>
  Array.from(sel.options).some((o) => o.value === 'canonical_gaussian'))!;
const highKp = Array.from(presetSelect.options).find((o) => o.value === 'prepared_state_7');
check('high-k_p preset present', highKp != null);
if (highKp) {
  await setSelect(presetSelect, 'prepared_state_7');
  check('state import does not show formula extrapolation', !text().includes('above the certified upper bound'));
}

// --- Calibrate tab ---
await click(byText('Calibrate volume'));
check('formula extrapolation shown where formula is used', text().includes('above the certified upper bound'));
const volumeMode = () => buttons().find((b) =>
  (b.textContent ?? '').trim() === 'Calibrate volume' &&
  (b.closest('section')?.textContent ?? '').includes('System parameters'));
check('spectrum summary strip shown', text().includes('Using') && text().includes('Prepared State 7'));
check('no bare q(k) label on the Calibrate tab', !/\bq\(k/.test(text()), 'found a q(k) label');
check('volume-calibration result shown', text().includes('Inferred interaction parameter') && text().includes('derived V'));

await click(byText('Known volume'));
check('cylinder geometry toggle present', byText('from R, L →') != null);
await click(byText('from R, L →'));
check('cylinder geometry fields shown', text().includes('Cylinder geometry') && text().includes('ratio R/L'));
await click(byText('Known density'));

await click(volumeMode());
check('inverse mode renders', text().includes('inferred na'));
check('inverse mode explains missing V', text().includes('needs a and N') || text().includes('derived V'));
check('refine-with-simulation control present', byText('Refine with simulation') != null);

const aField = numberInputs().find((i) => i.placeholder === 'Required for volume');
if (aField) {
  await setInput(aField, '');
  check('na-only mode hides n', text().includes('needs a'));
} else {
  check('na-only mode hides n', false, 'scattering-length input not found');
}

// --- Export tab ---
await click(byText('Export'));
check('export panel renders', byText('Download CSV') != null);
check('export offers the radial n_k convention', text().includes('radial density'));

await act(async () => { root.unmount(); });

console.log('');
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}

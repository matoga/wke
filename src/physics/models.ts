/**
 * Kinetic models. All share the resonant four-wave manifold and the bare
 * tree-level rate; they differ in how each collision is dressed by loops.
 */

export type ModelId = 'bare' | 'one-loop' | 'chain' | 'heuristic';

/** Right-hand side integrated for each model. */
export type SolverModel = 'bare' | 'one-loop' | 'chain' | 'heuristic';

export interface ModelInfo {
  id: ModelId;
  label: string;
  short: string;
  /** KaTeX expression of the collision dressing M */
  bracket: string;
  /** one-sentence description for the UI */
  blurb: string;
  solver: SolverModel;
  /** true when the model can hit a pole of the resummed vertex */
  hasPole: boolean;
  /** true when the Bose +1 kernel may be combined with the model */
  allowsQuantum: boolean;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'bare',
    label: 'Bare WKE',
    short: 'Bare',
    bracket: 'M = 1',
    blurb: 'Standard four-wave kinetic equation at order g². Blind to the sign of a.',
    solver: 'bare',
    hasPole: false,
    allowsQuantum: true,
  },
  {
    id: 'one-loop',
    label: 'One loop, N = 1',
    short: 'One loop',
    bracket: 'M = 1 + 2\\,\\langle \\mathrm{Re}\\,L_+\\rangle_s + 8\\,\\langle \\mathrm{Re}\\,L_-\\rangle_t',
    blurb: 'Exact next order in g for a one-component gas: particle-particle and exchange bubbles.',
    solver: 'one-loop',
    hasPole: false,
    allowsQuantum: false,
  },
  {
    id: 'chain',
    label: 'Bubble chain, N → ∞',
    short: 'N → ∞',
    bracket: 'M = \\left\\langle \\dfrac{1}{|1 - L_-|^2} \\right\\rangle_t',
    blurb: 'Large-N resummation of the exchange-bubble chain, on the one-component tree level.',
    solver: 'chain',
    hasPole: true,
    allowsQuantum: false,
  },
  {
    id: 'heuristic',
    label: 'Heuristic resummation, N = 1',
    short: 'Heuristic',
    bracket: 'M = \\left\\langle \\dfrac{1}{|1 - L_+|^2} \\right\\rangle_s \\left\\langle \\dfrac{1}{|1 - 4L_-|^2} \\right\\rangle_t',
    blurb: 'Particle-particle and exchange chains with the one-component rung weights. Matches the full one-loop term; omits crossed diagrams.',
    solver: 'heuristic',
    hasPole: true,
    allowsQuantum: false,
  },
];

export const MODEL_BY_ID: Record<ModelId, ModelInfo> = Object.fromEntries(
  MODELS.map((m) => [m.id, m]),
) as Record<ModelId, ModelInfo>;

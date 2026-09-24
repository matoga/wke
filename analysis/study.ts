/**
 * Run a named study: every run in parallel (one core each), each under its wall-time
 * cap, then the plots.
 *
 *   npx tsx analysis/study.ts analysis/studies/<name>.json [--parallel 8] [--no-plots]
 *
 * Output goes to analysis/results/<date>_<name>/ (gitignored):
 *   study.json      the definition, as run
 *   manifest.json   git commit, command, timings and the status of every run
 *   runs/*.json     one file per run (see analysis/run.ts)
 *   plots/*.pdf     each with a .npz beside it holding exactly the plotted arrays
 * Promote a finished study to the committed reports with analysis/promote.ts.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

interface Study {
  name: string;
  question: string;
  model: string;
  accuracy: string;
  target: number;
  pMin?: number;
  wallCap_s: number;
  snapshots?: number;
  /** 'classical' (default) or 'quantum' (the WKE with the +1 terms) */
  kernel?: string;
  /** density n (µm⁻³), default run.ts's 2.8331 */
  density?: number;
  species?: string;
  /** per-a override of target, keyed by a in a₀ (e.g. a box-size stop that scales with k_ξ) */
  targetByA?: Record<string, number>;
  /** per-run overrides: density (µm⁻³), target k_ξ/k_p, and a label that names the run file */
  runs: { state: string; a: number[]; density?: number; target?: number; label?: string }[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const studyPath = argv[0];
if (!studyPath) throw new Error('usage: npx tsx analysis/study.ts analysis/studies/<name>.json');
const parallel = Number(argv[argv.indexOf('--parallel') + 1] || 0) || Math.min(8, cpus().length);
const study: Study = JSON.parse(readFileSync(studyPath, 'utf8'));

const date = new Date().toISOString().slice(0, 10);
const dir = join(HERE, 'results', `${date}_${study.name}`);
mkdirSync(join(dir, 'runs'), { recursive: true });
copyFileSync(studyPath, join(dir, 'study.json'));

const git = (cmd: string) => { try { return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim(); } catch { return ''; } };
const jobs = study.runs.flatMap((r) => r.a.map((a) => ({ state: r.state, a, density: r.density, target: r.target, label: r.label })));
const manifest = {
  study: study.name,
  question: study.question,
  command: `npx tsx analysis/study.ts ${argv.join(' ')}`,
  gitCommit: git('rev-parse --short HEAD'),
  gitDirty: git('status --porcelain -- src') !== '',
  started: new Date().toISOString(),
  finished: '',
  runs: [] as { file: string; state: string; a: number; exitCode: number | null; wall_s: number }[],
};
const writeManifest = () => writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeManifest();

function runOne(job: { state: string; a: number; density?: number; target?: number; label?: string }): Promise<void> {
  const file = `runs/${job.label ? `${job.label}_` : ''}${job.state}_${job.a}a0_${study.model}.json`;
  const density = job.density ?? study.density;
  const t0 = Date.now();
  const cmd = ['tsx', join(HERE, 'run.ts'), '--state', job.state, '--a', String(job.a), '--model', study.model,
    '--accuracy', study.accuracy, '--target', String(job.target ?? study.targetByA?.[String(job.a)] ?? study.target), '--pmin', String(study.pMin ?? 0.001),
    '--wall', String(study.wallCap_s), '--snapshots', String(study.snapshots ?? 16), '--kernel', study.kernel ?? 'classical', '--out', join(dir, file),
    ...(density ? ['--density', String(density)] : []), ...(study.species ? ['--species', study.species] : [])];
  return new Promise((resolve) => {
    const p = spawn('npx', cmd, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (code) => {
      manifest.runs.push({ file, state: job.state, a: job.a, exitCode: code, wall_s: (Date.now() - t0) / 1000 });
      writeManifest();
      resolve();
    });
  });
}

console.log(`${jobs.length} runs, ${parallel} at a time, cap ${study.wallCap_s} s each -> ${dir}`);
const queue = [...jobs];
await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, async () => {
  while (queue.length) await runOne(queue.shift()!);
}));
manifest.finished = new Date().toISOString();
writeManifest();

if (!argv.includes('--no-plots')) {
  const py = join(HERE, '.venv', 'bin', 'python');
  if (!existsSync(py)) {
    console.log(`no plotting environment; create it with: python3 -m venv analysis/.venv && analysis/.venv/bin/pip install -r analysis/requirements.txt`);
  } else {
    execSync(`"${py}" "${join(HERE, 'plots', 'make_all.py')}" "${dir}"`, { stdio: 'inherit' });
  }
}
console.log(`done: ${basename(dir)}`);

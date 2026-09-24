/**
 * Promote a finished study from analysis/results/ (gitignored) to analysis/reports/ (committed).
 *
 *   npx tsx analysis/promote.ts <study-folder-name> [--with-runs]
 *
 * Copies README.md, study.json, manifest.json and plots/ (every PDF with its .npz).
 * --with-runs also copies runs/*.json (larger: they hold the spectrum snapshots).
 * Run `npm run test:audit` afterwards: reports are published with the repository.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
if (!name) throw new Error('usage: npx tsx analysis/promote.ts <study-folder-name> [--with-runs]');
const src = join(HERE, 'results', name);
const dst = join(HERE, 'reports', name);
if (!existsSync(join(src, 'plots'))) throw new Error(`${src} has no plots; run the plots first`);
mkdirSync(dst, { recursive: true });
for (const f of ['README.md', 'study.json', 'manifest.json']) {
  if (existsSync(join(src, f))) cpSync(join(src, f), join(dst, f));
}
cpSync(join(src, 'plots'), join(dst, 'plots'), { recursive: true });
if (process.argv.includes('--with-runs')) cpSync(join(src, 'runs'), join(dst, 'runs'), { recursive: true });
console.log(`promoted ${name}: ${readdirSync(join(dst, 'plots')).length} plot files -> analysis/reports/${name}`);

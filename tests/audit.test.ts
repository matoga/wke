/**
 * Provenance and style audit of everything that ships or is published: the
 * sources, tests, scripts, docs, data files and, when present, the built
 * bundle.
 *
 * - no identifiers from a private list (stored only as SHA-256 hashes of
 *   lowercase word tokens, so the list itself never enters the repository);
 * - no preprint identifiers, local absolute paths or references to scripts
 *   outside this app;
 * - no em dashes and no monospace fonts in anything a reader sees.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, relative, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = relative(ROOT, fileURLToPath(import.meta.url));

const FORBIDDEN = new Set([
  '331f359f144ec970f17975417b43fefe026247e992bf7e279b0cf5f48eb6f944',
  'db6dadc135357f0115dc85e9004dc5bc5cf00c5909ed0f7c0edf62bfa2ce974b',
  'b7d05d233931d43e852a97d83b73f241e2860f26f1ca8c6c77764d74ceaf14e8',
  'c4da477af5de3cd93f31784540f4c51a56dac7262f3e188d18b7593e40684700',
  '2f684da2a727e1c49e48764b0c284c4835123ab7a330758066ed9b2b8721b810',
  'bb5e4773b2a13eece12f21ea33ce082553cc39025725830d349f3d0522276d5c',
  '22bc60111197a28e636335dbe3f75573a82113ad46afb8f865b2c527443e6303',
  'ce487c80fddba1e9d22930b3ffd231c93a809f17d2ef3554dac8fe3d3ed1ba22',
  'a07713be967ca40cb4714414a9392c881a421fec96272b0879cbae50a60bfbaf',
  '0a5d17d3b19f82f8340d3977609aa9e86b4ad8b9bd71bd9eced9271f1d5b2e4a',
  'b6f8d434a847fb0f0c1a8d9b936b8ca952e224f205a55f4ba9b2c20f88fdc9e7',
  '5697abca7a318e6871d9519dbc0742f13935d3fbfe4939d140eedd83696f765b',
  'e839e162d8106fe35160d44676559cc5b7cd62284058792011d52976e8a2a0e1',
  '734078687c0314b6533d2996981ee236e6d89d79aa4e235f428b9044621bdb82',
  '5d72436256ada53828b51895a94bb8489e9f1ac4fe937a8024ef1594e7045ff6',
  '25f11bc52e3009a517196114d6c926490ec6d273b22d76cc0a1ca10168f073e3',
]);

const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.html', '.md', '.json', '.svg', '.txt']);
const SCAN = ['src', 'tests', 'scripts', 'docs', 'shared-data', 'public', 'dist', 'README.md', 'index.html', 'package.json', 'vite.config.ts', 'tsconfig.json'];

function walk(p: string, out: string[]): void {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) walk(join(p, e), out);
  } else if (TEXT_EXT.has(extname(p))) {
    out.push(p);
  }
}

const files: string[] = [];
for (const s of SCAN) walk(join(ROOT, s), files);

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const failures: string[] = [];
let checked = 0;

for (const file of files) {
  const rel = relative(ROOT, file);
  if (rel === SELF) continue;
  checked++;
  const text = readFileSync(file, 'utf8');
  const isData = rel.startsWith('shared-data') || rel === 'package.json';
  const isBundle = rel.startsWith('dist');

  // File names are published too.
  for (const token of rel.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (FORBIDDEN.has(hash(token))) failures.push(`${rel}: file name contains a forbidden identifier`);
  }
  const seen = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (FORBIDDEN.has(hash(token))) failures.push(`${rel}: contains a forbidden identifier (hash ${hash(token).slice(0, 10)})`);
  }
  if (/\/Users\/|~\/|[A-Z]:\\Users\\/.test(text)) failures.push(`${rel}: contains a local absolute path`);
  if (!isData && !isBundle && /\barxiv\b|\b\d{4}\.\d{5}\b/i.test(text)) failures.push(`${rel}: contains a preprint identifier`);
  if (!isBundle && /\b[\w-]+\.py\b/.test(text)) failures.push(`${rel}: refers to a script outside this app`);
  // Library code in the bundle carries its own symbol tables (the typesetter
  // maps "---" to an em dash); the rendered text is checked by the UI test.
  if (text.includes('\u2014') && !(isBundle && extname(file) === '.js')) failures.push(`${rel}: contains an em dash`);
  if (!isData && /font-mono|monospace|ui-monospace|Plex Mono|Menlo|Consolas/.test(text) && !(isBundle && extname(file) === '.js')) {
    failures.push(`${rel}: sets a monospace font`);
  }
}

console.log(`audited ${checked} files`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL  ${f}`);
  process.exit(1);
}
console.log('audit passed');

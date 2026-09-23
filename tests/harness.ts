/** Minimal assertion harness shared by the physics suites. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const loadData = (name: string) =>
  JSON.parse(readFileSync(resolve(HERE, '..', 'shared-data', name), 'utf8'));

let passed = 0;
const failures: string[] = [];
const rows: string[] = [];

export function check(name: string, ok: boolean, detail: string): void {
  if (ok) passed++; else failures.push(`${name}: ${detail}`);
  rows.push(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)} ${detail}`);
}

export function relClose(name: string, got: number, want: number, tol: number): void {
  const rel = want === 0 ? Math.abs(got) : Math.abs(got - want) / Math.abs(want);
  check(name, rel <= tol, `rel=${rel.toExponential(2)} (tol ${tol.toExponential(1)})`);
}

export function absClose(name: string, got: number, want: number, tol: number): void {
  const d = Math.abs(got - want);
  check(name, d <= tol, `|Δ|=${d.toExponential(2)} (tol ${tol.toExponential(1)})`);
}

export function section(title: string): void {
  rows.push('', `── ${title} ${'─'.repeat(Math.max(0, 72 - title.length))}`);
}

export function note(line: string): void {
  rows.push(line);
}

export function report(): void {
  console.log(rows.join('\n'));
  console.log('');
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log('');
    for (const f of failures) console.log(`  FAIL  ${f}`);
    process.exit(1);
  }
}

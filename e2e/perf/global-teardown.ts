import { readFileSync } from 'node:fs';
import path from 'node:path';
import { perfDir } from './fixtures';

type Row = { project: string; mode: string; metric: string; ms: number };

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Prints the median (and run count) per project / mode / metric from build/perf/results.jsonl. */
export default function globalTeardown() {
  const rows = readFileSync(path.join(perfDir, 'results.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.project} / ${r.mode} / ${r.metric}`;
    groups.set(key, [...(groups.get(key) ?? []), r.ms]);
  }
  console.log('\nPerf summary (median ms of n runs)');
  for (const [key, v] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key.padEnd(70)} ${median(v).toFixed(0).padStart(6)}  (n=${v.length})`);
  }
}

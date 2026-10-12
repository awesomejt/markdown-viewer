import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Generates the perf fixtures under build/perf/ (git-ignored). Existing files are kept.
export const perfDir = path.resolve(import.meta.dirname, '../../build/perf');
export const LISTING_COUNT = 10_000;
export const DOC_COPIES = 12;

const words =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore'.split(
    ' ',
  );
const mermaid = [
  'graph TD\n  A[Start] --> B{Check}\n  B -->|yes| C[Do]\n  B -->|no| D[Skip]\n  C --> E[End]\n  D --> E\n',
  'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi\n  Alice->>Carol: Ping\n  Carol-->>Alice: Pong\n',
  'classDiagram\n  Animal <|-- Duck\n  Animal <|-- Fish\n  Animal : +int age\n  Duck : +swim()\n',
  'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy\n  Busy --> Idle\n  Busy --> [*]\n',
  'flowchart LR\n' + range(15, (i) => `  n${i} --> n${i + 1}\n`),
];
const d2 = [
  'server -> db: query\nclient -> server: http\n',
  'a: {shape: circle}\nb: {shape: rectangle}\na -> b -> c -> d\nd -> a\n',
  'net: {\n  lb -> web1\n  lb -> web2\n}\nnet.web1 -> store\nnet.web2 -> store\n',
  'x -> y: one\ny -> z: two\nz -> x: three\nw -> x\n',
  range(12, (i) => `n${i} -> n${i + 1}\n`),
];

function range(n: number, f: (i: number) => string): string {
  return Array.from({ length: n }, (_, i) => f(i)).join('');
}

/** The "typical large document" for NFR-3: ~470 KB, 10 sections, 5 Mermaid + 5 D2 diagrams (each right after its section's first paragraph). */
function buildDoc(run: number | null): string {
  let seed = 1;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const para = (n: number) =>
    Array.from({ length: n }, () => words[Math.floor(rand() * words.length)]).join(' ') + '.\n\n';
  // A unique D2 comment per copy keeps the server D2 cache cold for every measurement.
  const comment = run === null ? '' : `# run ${run}\n`;
  const out = ['# Perf Doc\n\nTypical large document for NFR-3.\n'];
  for (let k = 0; k < 10; k++) {
    out.push(`\n## Section ${k}\n\n`);
    out.push(para(60));
    const body = k % 2 === 0 ? 'mermaid\n' + mermaid[k >> 1] : 'd2\n' + d2[k >> 1] + comment;
    out.push('```' + body + '```\n\n');
    for (let i = 0; i < 109; i++) out.push(para(60));
    out.push(
      '| a | b | c | d |\n| --- | --- | --- | --- |\n' +
        range(40, (i) => `| ${i} | ${i * 2} | x${i} | y${i} |\n`) +
        '\n',
    );
    out.push(
      '```go\n' +
        range(60, (i) => `func f${k}_${i}(x int) int { return x * ${i} + ${k} }\n`) +
        '```\n\n',
    );
  }
  return out.join('');
}

function writeMissing(file: string, content: () => string) {
  if (!existsSync(file)) writeFileSync(file, content());
}

export function generateFixtures() {
  const big = path.join(perfDir, 'big');
  mkdirSync(big, { recursive: true });
  for (let i = 0; i < LISTING_COUNT; i++) {
    writeMissing(path.join(big, `f${String(i).padStart(5, '0')}.md`), () => `# ${i}\n`);
  }
  for (let i = 0; i < DOC_COPIES; i++) {
    writeMissing(path.join(perfDir, `doc-${String(i).padStart(2, '0')}.md`), () => buildDoc(i));
  }
}

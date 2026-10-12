import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateFixtures, perfDir } from './fixtures';

export default function globalSetup() {
  generateFixtures();
  mkdirSync(perfDir, { recursive: true });
  writeFileSync(path.join(perfDir, 'results.jsonl'), '');
}

import 'katex/dist/katex.min.css';
import rehypeKatex from 'rehype-katex';
import type { RehypePlugin } from './pipeline';

/**
 * Loaded on demand by `math.ts` (its own chunk with the KaTeX CSS and fonts). Runs after
 * rehype-sanitize: the Markdown is sanitized first and KaTeX's own output is trusted, with
 * `trust: false` so `\href`, `\url` and `\html*` stay disabled. Parse errors render inline.
 * `maxSize` caps positive sizes only; negative ones (`\kern{-5000em}`) are contained by
 * `overflow: clip` on `.markdown-body`.
 */
export const katexPlugin: RehypePlugin = [
  rehypeKatex,
  { trust: false, strict: 'ignore', maxSize: 20 },
];

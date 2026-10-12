import type { Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkAlerts, { ALERT_CLASSES, ALERT_TITLE_CLASS } from './alerts';

export type RehypePlugin = NonNullable<Options['rehypePlugins']>[number];

/**
 * Default GitHub schema plus: a `language-*` class on `code` (diagram detection, ```` ```math ````)
 * and remark-math's `math-inline`/`math-display` (read by rehype-katex), and the alert classes.
 */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-./, 'math-inline', 'math-display']],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', ...ALERT_CLASSES]],
    p: [...(defaultSchema.attributes?.p ?? []), ['className', ALERT_TITLE_CLASS]],
  },
};

/** Order matters: front matter is parsed (and hidden) before rendering. */
export const remarkPlugins: NonNullable<Options['remarkPlugins']> = [
  remarkGfm,
  remarkFrontmatter,
  remarkMath,
  remarkAlerts,
];

/**
 * Order matters: raw HTML is parsed, then sanitized, then headings get slugs (unprefixed, from the
 * TeX source). KaTeX (`math.ts`) is appended last, after sanitize, when the document needs it.
 */
export const rehypePlugins: NonNullable<Options['rehypePlugins']> = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeSlug,
];

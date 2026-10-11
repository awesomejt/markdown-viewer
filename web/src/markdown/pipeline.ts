import type { Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';

/** Default GitHub schema plus a `language-*` class on `code` (needed for diagram detection). */
export const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./]],
  },
};

/** Order matters: front matter is parsed (and hidden) before rendering. */
export const remarkPlugins: NonNullable<Options['remarkPlugins']> = [remarkGfm, remarkFrontmatter];

/** Order matters: raw HTML is parsed, then sanitized, then headings get slugs (unprefixed). */
export const rehypePlugins: NonNullable<Options['rehypePlugins']> = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeSlug,
];

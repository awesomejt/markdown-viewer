/**
 * Returns the YAML front matter of a Markdown document, or null when it has none.
 * Mirrors remark-frontmatter's `yaml` preset: a `---` fence on the first line and a closing `---`
 * line (trailing spaces or tabs allowed). Without a closing fence the `---` is a thematic break.
 */
export function extractFrontMatter(text: string): string | null {
  const m = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? (m[1] ?? '') : null;
}

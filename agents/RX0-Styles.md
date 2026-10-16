<!-- RX0 survey and proposal (Phase 2c). Owner picks are recorded in agents/Decisions.md. -->
# RX0: Reading styles and fonts

Survey and proposal for FR-9.1 to FR-9.3. Styles are mdv's own token CSS, inspired by these tools and not copied from them (D-31). Status: final; owner picks in section 5 (D-35). Font sizes below are real woff2 byte counts from the Fontsource packages (v5.3.x) via the jsDelivr data API.

## 1. Survey

The web search tool returned little theme-specific detail. The entries below combine the sources listed at the end with general knowledge of each tool, so exact values are approximate and are inspiration, not specification.

| Tool | Distinctive look |
| --- | --- |
| Typora Github | GitHub-like: system sans, 16px, line-height about 1.6, narrow centered column (about 860px), underlined H1 and H2, light grey code blocks, striped tables. |
| Typora Newsprint | Newspaper feel: serif body and headings, tight columns, small caps and rules for headings, plain tables. |
| Typora Night | Dark counterpart: soft dark grey background, muted light text, blue links, subtle code panels. |
| Typora Pixyll | Blog look (from the Pixyll Jekyll theme): serif body at a large size, generous line-height, narrow measure, light-weight headings, quote with a left rule. |
| Typora Whitey | Plain white page, system sans, wide margins, very quiet headings with no rules, minimal chrome. |
| Typora Academic and Paper-style themes | Serif body in a paper-like column, numbered or centered headings, thin-ruled tables, and justified text. Obsidian LaTeX theme is a similar idea. |
| Typora community (Sonnet, Ursine, Tailwind) | Sonnet: Georgia body with system sans headings. Ursine: humanist sans pair (Avenir Next, Adelle). Tailwind: the Tailwind Typography prose scale (about 1.75 line-height, 65ch measure). |
| Obsidian default | Sans UI font for text, readable line width about 700px (a setting), muted headings with small size steps, soft code backgrounds. |
| Obsidian Minimal | System sans, restrained color, compact headings, a line-width setting, tables with light rules and no stripes. Fonts, sizes and widths are settings. |
| Obsidian Things | A Minimal color scheme inspired by Things app: soft blues, rounded tags, light borders. Color, not typography. |
| VS Code Markdown preview | System sans at 14px, line-height 1.6, full-width content, underlined H1 and H2, code in editor font, translucent blockquote with a left bar. Themed from the editor. |
| Markdown Preview Enhanced | Ships several presets (GitHub light and dark, Atom, Solarized, Monokai, Vue). Mostly GitHub-like sans; code themes are the main variety. |
| Markdown Preview GitHub Styling (bierner) | Reuses GitHub's markdown CSS (MIT, from github-markdown-css) with light and dark variants. This is what mdv's current look resembles. |
| Reading-focused extensions | Read-time badges and reading views (for example Obsidian Reading Time and Reader mode extensions) favor a single narrow column of 60 to 70 characters, a larger body size of 18 to 20px, line-height 1.7 to 1.8, and no ornament. |

Licensing: Typora themes are mostly MIT or per-theme licenses, and GitHub's CSS is MIT. mdv copies none of them, so only the ideas carry over.

### Current mdv `github` look

- Body: `system-ui`, `-apple-system`, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif.
- Defaults: 16px, line-height 1.6, content width 50rem.
- H1 and H2 have a bottom border. Code has a tinted background and a 4px radius. Pre blocks have a 1px border and 6px radius.
- Tables have 1px borders and striped even rows. Blockquotes have a 4px left rule and muted text.
- Tokens: `--bg`, `--bg-alt`, `--fg`, `--muted`, `--border`, `--accent`, with a dark variant on `html[data-theme='dark']`.

## 2. Proposed mdv styles

Four styles, each with light and dark variants. `github` stays the default and uses system fonts, so it costs no font download.

| Name | Intent | Body font | Size / line-height | Measure | Headings |
| --- | --- | --- | --- | --- | --- |
| `github` | Current look, default. | system sans | 16px / 1.6 | 50rem | Bottom rule on H1 and H2, bold, medium steps. |
| `clean` | Quiet modern docs reading. | bundled sans (Inter) | 16px / 1.65 | 46rem | No rules, semibold, tighter size steps, more space above. |
| `book` | Long-form prose, book feel. | bundled serif (Literata) | 18px / 1.7 | 38rem (about 65ch) | Serif, regular to semibold, no rules, small-caps H6, first paragraph after a heading not indented. |
| `script` | Large airy text for reading aloud. | bundled high-legibility sans (Atkinson Hyperlegible Next) | 22px / 1.85 | 44rem | Plain, bold, generous spacing between paragraphs (1.1em), no rules. |

Per-style details:

- `github`: code in the mono stack at 0.9em, tinted inline code, bordered pre, striped tables with full borders, left-rule muted quotes. Light and dark are the current tokens.
- `clean`: code in bundled mono with a soft tint and no border. Tables have horizontal rules only, no stripes, tight padding. Quotes use a thin accent rule with normal text color. Dark uses a slightly warmer grey (not pure black) to reduce glare.
- `book`: inline code is a quiet tint, pre blocks have a left border instead of a box. Tables use top, header and bottom rules (booktabs style), no verticals. Quotes are italic with an indent and no rule. Dark uses off-white text (about #d8d4cc) on a dark warm grey. A paper-tinted light background (about #fbf8f1) is optional.
- `script`: code blocks are large (0.85em) because scripts may be read from them, with a clear border. Tables use generous padding. Quotes are indented with a thick accent rule. Dark is high contrast and not pure white on pure black, for comfortable recording in low light. Best used with focus mode (FR-9.4).

Tokens each style sets (all scoped by `html[data-style="<name>"]`):

- Text: `--mdv-font-body`, `--mdv-font-heading`, `--mdv-font-size`, `--mdv-line-height`, `--mdv-content-width`.
- Rhythm: `--mdv-para-gap`, `--mdv-h1-size` to `--mdv-h6-size` (as ratios), `--mdv-heading-weight`, `--mdv-heading-rule` (border or none), `--mdv-heading-gap-top`.
- Blocks: `--mdv-code-bg`, `--mdv-code-border`, `--mdv-code-radius`, `--mdv-table-stripe`, `--mdv-table-rule`, `--mdv-quote-rule`, `--mdv-quote-style`.
- Colors: `--bg`, `--bg-alt`, `--fg`, `--muted`, `--border`, `--accent` for both themes.

The `font` and `codeFont` settings still override the style's body and code fonts. Shipping `github` first means Phase 2c can land the token plumbing with no new font bytes.

## 3. OFL font shortlist

All are SIL OFL 1.1, verified from each Fontsource `package.json` (`license: OFL-1.1`). Each `OFL.txt` ships beside the font (NFR-10). Variable axes are `wght` only in every case. Italics are a separate file in every case (the Fontsource variable packages have no `ital` axis). Sizes are woff2 bytes for the Latin subset plus the Latin Extended subset.

| Category | Family | Latin + Ext normal | Latin + Ext italic | Notes |
| --- | --- | --- | --- | --- |
| sans | **Inter Variable (pick)** | 133,324 (48,256 + 85,068) | 143,732 (51,832 + 91,900) | Neutral UI sans, very readable on iPad. Large Latin Ext. |
| sans | Source Sans 3 Variable | 88,960 (28,872 + 60,088) | 87,956 (28,460 + 59,496) | Smaller, humanist, a bit narrower. |
| serif | **Literata Variable (pick)** | 95,152 (52,496 + 42,656) | 96,984 (53,728 + 43,256) | Made for long-form screen reading. |
| serif | Source Serif 4 Variable | 93,148 (50,936 + 42,212) | 95,996 (51,576 + 44,420) | Classic, slightly lighter color. |
| serif | Lora Variable | 57,876 (37,788 + 20,088) | 61,900 (40,772 + 21,128) | Smallest, calligraphic, more decorative. |
| mono | **JetBrains Mono Variable (pick)** | 55,600 (40,404 + 15,196) | 59,484 (42,964 + 16,520) | Tall x-height, clear `0 O 1 l`. Ligatures can be disabled in CSS. |
| mono | Source Code Pro Variable | 55,612 (22,044 + 33,568) | 56,460 (22,448 + 34,012) | Conservative, no ligatures. |
| mono | Fira Code Variable | 49,548 (36,276 + 13,272) | none | Smallest, no italic file. |
| script | **Atkinson Hyperlegible Next Variable (pick)** | 53,088 (33,996 + 19,092) | 57,776 (37,644 + 20,132) | Designed by the Braille Institute for distinguishable letterforms. Static 400 and 700 normal is only about 39 KB. |
| script | Lexend Variable | 74,156 (39,680 + 34,476) | none | Tuned for reading fluency, wide spacing, no italic file. |
| script | Atkinson Hyperlegible (original, static) | 53,488 for 400 and 700 (17,208 + 17,524 + 9,384 + 9,372) | 56,492 for 400 and 700 (18,292 + 18,484 + 9,796 + 9,920) | Older version, static only. Prefer Next. |

Recommended set and payload (bytes, Latin + Latin Extended):

| Set | Bytes | KiB |
| --- | --- | --- |
| Normal only: Inter, Literata, JetBrains Mono, Atkinson Next | 337,164 | 329 |
| Italics for all four | 357,976 | 350 |
| Recommended set with italics | 695,140 | 679 |
| Every shortlisted family, normal and italic | about 1,615,000 | about 1,577 |

- The recommended set is about 0.68 MB, so it is far below the 3 MB cap of FR-9.2. Even bundling every shortlisted family stays near 1.6 MB.
- A device downloads only the active style's body font, the code font if code appears, and the italic file only if italic text appears. For example `book` costs about 95 KB (Literata normal) plus 56 KB (mono) on first use, and the browser caches both. `github` costs 0 bytes.
- The KaTeX fonts already add about 1.2 MB to the bundle and binary. That is separate from this cap, so the binary grows by roughly 0.7 MB for fonts plus the existing 1.2 MB.
- The Latin Extended files are loaded by `unicode-range`, so a document with only English text fetches the Latin file alone (for example Inter normal is 48 KB, not 133 KB).

## 4. Fallback stacks

Each category resolves to the bundled family first, then to local fonts per OS (FR-9.3). Apple devices use San Francisco, New York and Menlo or SF Mono, Windows uses Segoe UI and Consolas, and Linux uses what is typically installed.

| Category | Stack |
| --- | --- |
| `sans` | "Inter Variable", system-ui, -apple-system (Apple), "Segoe UI" (Windows), Roboto, "Noto Sans", "DejaVu Sans" (Linux), "Helvetica Neue", Arial, sans-serif |
| `serif` | "Literata Variable", Charter, "Iowan Old Style", "Palatino Linotype", Georgia (Apple and Windows), "Noto Serif", "DejaVu Serif" (Linux), serif |
| `mono` | "JetBrains Mono Variable", ui-monospace, "SF Mono", Menlo (Apple), Consolas (Windows), "DejaVu Sans Mono", "Liberation Mono" (Linux), monospace |
| `system` | system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif (no bundled font) |
| `script` (style font only) | "Atkinson Hyperlegible Next Variable", "Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif |

A specific bundled family named in `font` becomes that family followed by its category stack.

## 5. Owner decisions (2026-10-16, D-35)

The owner took the recommended option for every question:

1. Styles: `github` (default), `clean`, `book`, `script`.
2. Sans: Inter. Serif: Literata. Mono: JetBrains Mono. Script font: Atkinson Hyperlegible Next.
3. Italics: shipped for all four families (Latin and Latin Extended, about 0.68 MB in total).
4. Budget: the 3 MB cap of FR-9.2 stays; no other families are bundled.
5. `font` and `codeFont` settings override the style's fonts on any style.

## Sources

- <https://support.typora.io/About-Themes/> (Typora theme structure)
- <https://theme.typora.io/theme/Whitey> (Whitey)
- <https://theme.typora.io/theme/sonnet/> (Sonnet)
- <https://github.com/typora/typora-theme-ursine> (Ursine)
- <https://theme.typoraio.cn/theme/Tailwind/> (Tailwind Typography for Typora)
- <https://cdn.jsdelivr.net/gh/kepano/obsidian-minimal@master/README.md> (Obsidian Minimal)
- <https://community.obsidian.md/themes/minimal> (Obsidian Minimal listing)
- <https://github.com/sindresorhus/github-markdown-css> (GitHub markdown CSS, MIT)
- <https://data.jsdelivr.com/v1/packages/npm/@fontsource-variable/inter> and the matching `@fontsource-variable/*` and `@fontsource/*` packages (font sizes and licenses)

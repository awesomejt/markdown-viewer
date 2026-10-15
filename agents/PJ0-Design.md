<!-- Detailed PJ0 design for PJ1-PJ7 implementers. The agreed contract is in docs/Architecture.md (Projects And Settings, Phase 2b contract); if they differ, Architecture wins. -->

# PJ0 final design: project files, preferences, layered settings

Status: final (after the Opus challenge and owner answers of 2026-10-14). The agreed contract is in `docs/Architecture.md` ("Projects And Settings (Phase 2b contract)"); this file is the implementer reference for PJ1 to PJ7 and holds the detail that does not belong there. Fixed owner decisions: D-30, D-31, D-32, plus the answers: device choices are per project inside a project; stay in the project within the same root; keep the last good project on a broken live edit; both `.mdv.yaml` and `.mdv.yml` are accepted.

## 1. YAML library

**`go.yaml.in/yaml/v3` v3.0.4** (the YAML org's maintained successor of the archived `gopkg.in/yaml.v3`; same API). It is in the module cache (`~/go/pkg/mod/go.yaml.in/yaml/v3@v3.0.4`, zip and `.mod` under `cache/download/`), and so is its only dependency `gopkg.in/check.v1`. PJ1 runs `GOFLAGS=-mod=mod GOPROXY=off go get go.yaml.in/yaml/v3@v3.0.4`, verifies offline, and commits `go.mod`/`go.sum`. `github.com/goccy/go-yaml` is not in the cache and has no advantage here.

Verified in the v3.0.4 source:

| Need | API / location |
| --- | --- |
| Parse to a tree, no alias expansion | `yaml.NewDecoder(bytes.NewReader(b)).Decode(&node)`, `node yaml.Node`: `decode.go` `unmarshal` copies the parsed node when `out.Type() == nodeType` (~line 492); `parser.alias()` only links `n.Alias`. |
| Aliases/anchors | `Node.Kind == yaml.AliasNode` or `Node.Anchor != ""`. |
| Merge keys | `<<` does **not** need aliases: a key scalar with `ShortTag() == "!!merge"` is rejected explicitly. |
| Tags | `Node.Style & yaml.TaggedStyle`. |
| Warning lines | `Node.Line`/`Column`, 1-based. |
| Syntax-error line | text `yaml: line N: <problem>` from `parser.fail` (`decode.go` ~104). There is no error struct; extract by regex. `fail` omits the line when the mark is 0, and `failf` messages (for example "unknown anchor") have none. |
| Own depth guards | `max_flow_level`, `max_indents` 10000 (`scannerc.go:956,990`). |
| Panics | `handleErr` (`yaml.go:296-303`) recovers only `yamlError` and re-panics anything else. |

### Parsing rules (`settings.ParseProject`, `settings.ParsePrefs`)

Input is `[]byte`. **Never hand a `Reader` to the decoder**: `readerc.go:104` embeds reader errors, which can contain host paths, into parse problems. Callers do `io.ReadAll` first (read errors go through `fsError` for projects, `prefs_unreadable` for prefs) and the decoder reads `bytes.NewReader`.

1. `defer recover()` around everything: any panic (including the library's re-panic) becomes a fatal `ParseError{Msg: "could not parse the file"}` and a 422, never a 500.
2. `Decode(&doc)`. `io.EOF` on the first call: project = fatal "file is empty"; preferences = valid, no settings (a comment-only file is also valid). A second `Decode` must return `io.EOF`, else fatal "multiple documents".
3. `precheck` walks the whole tree once; fatal on an alias or anchor, an explicit tag, a `!!merge` key, depth over 8, or more than 2000 nodes.
4. Top level must be a mapping. Typed helpers (`str`, `enum`, `number(min,max)`, `integer(min,max)`, `bool`, `list`) append a `Warning` with the key's line on a miss. Unknown key: `unknown_key`; repeated key: `duplicate_key` (first wins). A non-string or complex key is `unknown_key` with the key text `(non-string key)` (never echoed). A `null` value means "unset" with no warning, except a `null` or empty `include` item (`invalid_path`).
5. Scalars are typed by `ShortTag()` (`!!str`, `!!int`, `!!float`, `!!bool`; YAML 1.2, so `yes`/`on` are strings and give `invalid_value "must be true or false"`). Numbers decode via `n.Decode(&float64)`; NaN and Inf fail the range check.
6. `version`: project required and must be integer 1 (fatal otherwise; line of the key, or absent); preferences optional, 1 when present (else the file is invalid).

`ParseError{Line int, Msg string}`: `Line` is optional (0 = absent, omitted from JSON), clamped to `[1, lineCount]` when present. **Every library message is sanitized** before it leaves the package: strip the leading `yaml:` prefix (and its space), cap at 200 runes, replace controls and bidi characters (reuse the `fsroot` `isControl` rule). Error classes to table-test: scanner vs parser off-by-one, no-line messages, unknown anchor, depth bomb, tab indentation, invalid UTF-8, NUL.

**Resource bounds:** the node tree is built before `precheck`, so memory is bounded by the size cap only. Size cap 32 KiB, and at most **4 concurrent parses** server-wide (a small semaphore in the api package; waiting is bounded by the request context). A test pins worst-case allocations for a 32 KiB flow-collection document. `FuzzParseProject` and `FuzzParsePrefs` (real Go fuzz tests, seed corpus committed): no panic, bounded time, at most 100 warnings, every message at most 200 runes with no controls.

## 2. Schema v1

Layers are **sparse**: the server returns only valid keys that were set; built-in defaults live in the client (`DEFAULT_SETTINGS`), so RX0 changes defaults without a server change. An invalid value drops that key and adds `invalid_value`.

| Key | Type | Allowed | Default |
| --- | --- | --- | --- |
| `theme` | enum | `system` `light` `dark` | `system` |
| `style` | string | `^[a-z][a-z0-9-]{0,31}$` | `github` |
| `font`, `codeFont` | string | same pattern (category or bundled family) | RX0/DS1 |
| `fontSize` | number | 12 to 32 px | 16 |
| `lineHeight` | number | 1.0 to 2.5 | 1.6 |
| `contentWidth` | enum | `narrow` `normal` `wide` `full` | `normal` |
| `markdownOnly`, `showHidden` | bool | | false |
| `sort` | enum | `name` `date` | `name` |
| `readTime.wpm` | integer | 60 to 600 | 160 |
| `readTime.includeHeadings`, `readTime.includeCode` | bool | | false |

**Open-ended names:** the server checks only the pattern. The client owns `KNOWN_STYLES`/`KNOWN_FONTS` (RX0/DS1 edit them) and applies names only through `data-style`/`data-font`/`data-code-font` attributes. An unknown name **falls back to the built-in default for that key** (not down the layers) and produces a client warning `unknown_style`/`unknown_font` (project panel, or the preferences banner).

**Project file** keys: `version` (required, 1), `name` (1 to 100 runes, no controls, trimmed), `open`, `include` (list of at most 200 strings), `settings`. **Preferences** keys: `version` (optional) and `settings`; anything else is `unknown_key` ("not allowed in preferences").

**References** (`include` items, `open`):

- Local: relative to the project file's folder, `/` separators, at most 1024 bytes. A trailing `/` is only a hint (the stat decides; a `foo/` that is a file gives `not_a_dir`). `.` means the project's folder (wire path `""` at the root). Leading `../` segments are allowed; `..` after another segment, a leading `/`, a backslash, controls, an empty/null/non-string item give `invalid_path`. The lexical join is `path.Join(dir, ref)`; **escape test: `p == ".." || strings.HasPrefix(p, "../")`** (a name like `..notes.md` is valid; test it). Escaping gives `outside_root` with no fs call. The cleaned path then goes through `h.Stat`.
- Cross-root (not built; FR-7.8): `<root>:<path>` where the text before the first `:` matches `^[a-z0-9][a-z0-9_-]{0,31}$` and has no `/`. Gives `cross_root_unsupported`; the item is dropped. There is **no drive-letter rule**: `c:foo` is cross-root syntax because root names may be one letter (`config.go` `nameRE`); an uppercase `C:foo` does not match, is treated as local, and `fsroot.Resolve` rejects the drive letter, which maps to `invalid_path`. Write `./a:b/c` to force a local path whose first segment has a colon.
- Duplicate resolved paths are **silently de-duplicated** (first wins; no warning code).
- `open` must resolve to a file of kind markdown, diagram or text (`ClassifyName`); an image, project or other file gives `not_a_file` ("open must be a Markdown, diagram or text file") and `open` is treated as unset. `open` need not be inside `include` (no warning).

## 3. Limits

| Limit | Value | Violation |
| --- | --- | --- |
| File size | 32 KiB (from `FileStat`, before reading; `timedReader` stops at the fstat size, so a file that grows mid-read is simply truncated by the reader) | project 422 `project_invalid`; prefs `error.code = prefs_invalid` |
| Documents / nodes / depth | 1 / 2000 / 8 | fatal |
| `include` | 200 items | the rest dropped, one `too_many_includes` |
| Strings | `name` 100 runes, reference 1024 bytes, style/font 32 | `invalid_value` / `invalid_path` |
| Warnings per response | 100 | list cut, last item `warnings_truncated` |
| Echoed text | `ref` 80 runes; messages 200 runes; controls replaced by `?` | |
| Anchors, aliases, tags, merge keys | none | fatal |

A file truncated mid-write by an editor surfaces as a syntax error or a shorter list; the next live event fixes it (the client keeps the last good project meanwhile, section 6).

## 4. API

**Error model:** one new code, **422 `project_invalid`** (project unreadable as a project). `errorDetail` gains optional `line` (`json:"line,omitempty"`, additive; `ParseError` and this field land in PJ1 because PJ2 and PJ3 share them). All else reuses existing codes: 400 (missing params, path not a project file, path is a directory), 403, 404, 504 via `fsError`. **No ETag** on either endpoint; both send `Cache-Control: no-cache`. Both are `s.get`, registered before the `/api/` catch-all.

**Warning object:** `{code, message, key?, ref?, line?}`; `key` is a dotted path (`settings.fontSize`, `include[2]`, `open`), `line` is 1-based. Codes: `unknown_key`, `duplicate_key`, `invalid_value`, `invalid_path`, `missing`, `not_a_dir`, `not_a_file`, `outside_root`, `forbidden`, `cross_root_unsupported`, `unavailable`, `too_many_includes`, `warnings_truncated`. Client-only: `unknown_style`, `unknown_font`.

**fsroot error to warning code (total; one table-test row per Kind):**

| `PathError` Kind | Code |
| --- | --- |
| `KindBadRequest` | `invalid_path` |
| `KindForbidden` | `forbidden` if the chain has `fs.ErrPermission`, else `outside_root` (os.Root escape) |
| `KindNotFound` (includes ENOTDIR, ELOOP, dangling) | `missing` |
| `KindTimeout` | `unavailable` |
| `KindInternal` | `unavailable` |
| success, wrong type | `not_a_dir` (a file where a folder was hinted by `/`) / `not_a_file` (`open` is a directory or a disallowed kind) |

`outside_root` on an escaping symlink reveals only that an in-root symlink of that name exists, while `/api/list` omits such links; acceptable (the name is the owner's own YAML text).

### `GET /api/prefs`

Always 200, no parameters: `{"configured":bool,"settings":{...},"warnings":[...],"error":null|{"code","message","line?"}}`.

| State | Response |
| --- | --- |
| `MDV_PREFS` unset | `configured:false`, empty settings |
| file missing | `configured:true`, empty settings, no error, no banner; WARN log on state change |
| empty or comment-only file | valid: empty settings, no error |
| unreadable (EACCES, EISDIR, not a regular file, I/O error, timeout) | empty settings, `error.code = prefs_unreadable` |
| invalid (size, syntax, version, forbidden construct) | empty settings, `error.code = prefs_invalid` + line |
| valid with bad keys | good keys in `settings`, `warnings` |

**Read policy:** re-read and re-parse on every request (at most 32 KiB, under 1 ms; no mtime cache). The path is operator config outside every root, so it is opened directly, but: `O_RDONLY|O_NONBLOCK`, then `fstat` must be a regular file (a FIFO at `MDV_PREFS` must not block), and **at most one read is outstanding**: while a read is pending, concurrent requests wait up to `FSTimeout` for it and otherwise get the last result (a hung mount costs one goroutine, not one per request). Logging is de-duplicated by a hash of (state, content): WARN on missing, unreadable, invalid or warned content, INFO on first successful load, once per change. Never logged: contents, host paths.

### `GET /api/project?root=&path=`

`path` must be a regular file whose lower-cased base ends in `.mdv.yaml` or `.mdv.yml` (the base may be exactly `.mdv.yaml`/`.mdv.yml`).

```json
{"root":"markdown","path":"courses/docker.mdv.yaml","name":"Docker course",
 "open":{"root":"markdown","path":"courses/outlines/README.md","kind":"markdown"},
 "entries":[{"root":"markdown","path":"courses/notes","type":"dir","kind":"other","ref":"notes/","line":6}],
 "settings":{"theme":"dark","fontSize":18},
 "warnings":[{"code":"missing","message":"outlines/ was not found","key":"include[1]","ref":"outlines/","line":7}]}
```

`name` and `open` are `null` when absent/unresolved. `entries` hold only resolved items, in YAML order; unresolved ones exist only as warnings. `kind` is the `/api/list` classifier (dirs `other`).

**Resolution and load control** (the stat phase must stay bounded across requests, not just per request):

1. Read the project file: `h.Open`, `h.FileStat` (size over 32 KiB = fatal before reading), `io.ReadAll` of `h.Reader`. Failures use the normal `fsError` path (404/403/504). Parse under the 4-slot parse semaphore.
2. Stats: one `h.Stat` per distinct reference (at most 201). Every stat goes through **one limiter per `Handle`** (not per request) of `min(2, MaxInflight-1)` concurrent stats, minimum 1, so the page's other requests and `/api/file` keep slots. Slot-wait timeouts do not mark the root unavailable (`access.go:212-216`) and `withRetry` (`ops.go:48`) doubles stats for missing non-ASCII names, so the cap is on stats, not on references.
3. **Singleflight** per `(root, path, sha256(project bytes))` for the stat phase, with a result TTL of `MDV_POLL_INTERVAL` (the content hash in the key means a live edit never gets a stale answer). N tabs or rapid refetches cost one fan-out per interval.
4. The stat phase runs under `context.WithTimeout(ctx, 2*FSTimeout)`. Unchecked items become `unavailable`; the first timeout marks the root unavailable, so the rest fail fast. Test: slow/blocking fake FS plus concurrent requests: the response arrives within the deadline, at most the limiter's stats are in flight, and a concurrent `/api/file` still obtains a slot.

## 5. Listing classification

`FileKindProject = "project"`; `ClassifyName` checks `HasSuffix(lower(base), ".mdv.yaml" || ".mdv.yml")` before the extension map (so the `.yaml` text rule does not win, and the exact dotfile names qualify). `KindForExt` is unchanged. `/api/file` is unchanged (`.yaml`/`.yml` are text: the source stays viewable, subject to `MaxFileBytes`). The same rule goes into the client `fileKind`.

**PJ3 includes the client kind plumbing**, so `main` never regresses between PJ3 and PJ5: `EntryKind` gains `project`; `fileKind` mirrors the suffix rule; `KindIcon` gets a `project` glyph; `ViewFileView` renders `project` files as `CodeFile` text until PJ5a; md-only keeps projects (`markdown`, `diagram`, `project`). A test that fails without it: a listing with a `*.mdv.yaml` entry renders the project icon and opens as text, and md-only keeps it.

The md-only label stays "Markdown/diagrams only" with a `title` that mentions projects. "Projects only" (PJ6) is a non-persisted toolbar checkbox in `BrowseView`; it keeps folders and hides other files.

## 6. Client

### URL and navigation (owner decision: stay in the project)

- `?project=<root>:<path>`, built as `encodeURIComponent(root) + ':' + encodePath(path)` (same form as SSE `sub`). Parse: split at the first `:`; root must match the root-name pattern; path must end `.mdv.yaml`/`.mdv.yml` (case-insensitive) with no `..` segment; otherwise the param is ignored.
- `NavScope = {ws?: string; project?: ProjectRef}`; `browseHref`/`viewHref` take it. `ws` and `project` are mutually exclusive (both present: project wins, ws dropped by the next link).
- **The param stays on all navigation within the same root** (links only carry it; no membership check in link building, so `markdown/links.ts` just passes `project`). It is dropped only by explicit exits: Home, the root list, a link to another root, opening another project (the param is replaced), "Open as workspace", and "Close project". A non-member file shows a small "This file is not part of the project" note in the sidebar. Cross-root members later need no URL change.
- **Entering and switching.** Viewing a path that ends `.mdv.yaml`/`.mdv.yml` whose value differs from `?project=` (param absent, or another project) **replaces the param with that file** (switching projects) and redirects (`<Navigate replace>`, so Back returns to the listing) to the landing page: `open`, else the first file entry of kind markdown, else the project home. The redirect happens only on entering (absent or different), never when the path equals the param, so `open` pointing to a project file (not allowed anyway), or a project listing another project file, cannot loop. e2e: project to `open`, project to an included project file, no loop.
- **Project home** is `/view/<root>/<x>.mdv.yaml?project=<same>`: title, entry list, warnings panel. `?source=1` shows the YAML via `CodeFile`; a Source/Project toggle sits in the project header.
- **Close project** is a link to the current location without `project`.
- Recents gain an optional `project` (like `ws`); "Recent projects" (FR-7.6) is the store `mdv-recent-projects` (max 10, `{root,path,name?}`), written when a project loads without error.

### Error-state table (project query, `['project', root, path]`)

The query has no `placeholderData`/`keepPreviousData`: switching projects must never show project A's settings while B loads. TanStack keeps `data` after a failed refetch, which the table relies on.

| Situation | Behavior |
| --- | --- |
| Initial load pending | `?project=` kept; the main outlet is held (spinner) until the project settles; no project layer |
| Initial 422 | Error state (message, YAML line, "Show source", "Close project"); project not applied |
| Initial 404 | Error state with "Close project"; links keep the param until closed |
| Initial 504/network | Error state with Retry and "Close project" |
| After success, refetch 422 | Keep last good sidebar/settings; show an error line with the YAML line until valid again (owner Q-B) |
| After success, refetch 504/network | Keep last good; mark stale (small "may be out of date" marker) |
| After success, refetch 404 (renamed or deleted) | Drop data, error state with "Close project" |

### Sidebar, live reload, keys

Sidebar heading "Project": title, Source link, warnings badge; `<details class="project-warnings">` (open when warnings exist; `message`, `ref` in `<code>`, `line N`; client warnings merged; "Re-check" = refetch); an "Open" link; entries: dir entries are disclosure rows (collapsed unless they hold the current path) whose children reuse `TreeChildren` (listing, paging, filters, low-priority subs), file entries are links. Entries explicitly in `include` always show regardless of filters; included folders' contents follow them. `WorkspaceTree` and `ProjectTree` share an extracted row renderer. `ProjectProvider` subscribes normally to the project file; `keysForChange` adds `queryKeys.project(root, path)` for paths ending `.mdv.yaml`/`.mdv.yml`; `isApiQueryKey` recognises `project` and `prefs`. Reference changes (a missing folder appears) are picked up on any refetch or "Re-check". Keys: `['project', root, path]`, `['prefs']`, both `retry: shouldRetry`, `staleTime: 0`.

## 7. Settings resolution and the device layer

```ts
type Settings = { theme; style; font; codeFont; fontSize; lineHeight; contentWidth;
  markdownOnly; showHidden; sort; readTime: { wpm; includeHeadings; includeCode } };
type SettingsLayer = DeepPartial<Settings>;                    // prefs and project
type DeviceLayer = Partial<Pick<Settings,'theme'|'markdownOnly'|'showHidden'|'sort'>> & { textScale?: number };
type Resolved = Settings & { textScale: number; sources: Record<Exclude<keyof Settings,'readTime'>, 'default'|'prefs'|'project'|'device'> };
function resolveSettings(defaults: Settings, prefs?: SettingsLayer, project?: SettingsLayer, device?: DeviceLayer): Resolved
```

Pure. Last defined layer wins (defaults, prefs, project, device); `readTime` merges per field across the first three only. Keys per layer: theme, markdownOnly, showHidden, sort: all four layers; style, font, codeFont, fontSize, lineHeight, contentWidth: prefs and project; readTime.*: prefs and project (D-32); textScale: device only. Pure table tests: precedence, per-field `readTime` merge, device cannot set non-device keys, and "leaving a project restores the lower layers" (project `undefined` gives the prefs result).

`useApplySettings()` in `Layout`: `applyTheme(resolved.theme)`; `data-style`, `data-font`, `data-code-font` on `<html>`; CSS variables `--mdv-font-size` (px), `--mdv-text-scale` (1.1 = 110%), `--mdv-line-height`, `--mdv-content-width`. Content CSS: `font-size: calc(var(--mdv-font-size) * var(--mdv-text-scale))`; the shell and diagrams do not scale.

**Device storage (owner answer Q2).**

| Scope | Storage | Contents |
| --- | --- | --- |
| Outside a project | the existing global keys `mdv-theme`, `mdv-md-only`, `mdv-show-hidden`, `mdv-sort`; `undefined` = no choice (key removed) | global device choices |
| Inside a project | one key `mdv-project-device`: JSON map `"root:path"` to `{theme?, markdownOnly?, showHidden?, sort?}`, capped at 50 projects (least recently written dropped), parse never throws | choices made while that project is open |
| Text scale | `mdv-text-scale`, integer percent 50 to 200, steps of 10, absent = 100 | one global per-device value |

Inside a project the device layer is only that project's choices; global device choices apply outside projects only (orchestrator review: the owner chose per-project so each project keeps its own settings).

**One Reset control** ("Reset this device's choices"; in a project it reads "Reset choices for this project"): clears the project's entry when in a project, the global keys otherwise. It appears only when a choice exists. No per-toggle marks.

**Migration (one time, flag `mdv-settings-v=2`)**, run before the stores first read: remove stored values equal to the old built-in defaults (`mdv-theme=system`, `mdv-md-only=0`, `mdv-show-hidden=0`, `mdv-sort=name`); the old UI wrote those defaults on every cycle or uncheck, so they are not real choices. Non-default values stay as global device choices. Test each stored value, and idempotence.

**Theme menu:** a native `<select>`: `Default (Light)`, `Auto`, `Light`, `Dark`. "Default" removes the device choice (inside a project: the project entry's theme); its label shows the theme the lower layers resolve to. The `prefers-color-scheme` listener runs for the resolved mode. `applyTheme`/`resolveTheme`/`THEME_COLOR` stay.

**Preferences banner:** a dismissible banner above the content (dismissal per session via `sessionStorage`): "Preferences file problem: `<message>`. Using defaults." for `error`, "N preference warnings" (expandable list) for warnings. Same component for both.

**First paint:** `/api/prefs` never touches roots, so the main outlet is held until it settles or 300 ms pass. The last prefs `settings` are cached in `localStorage` (`mdv-prefs-cache`) and applied by a boot step in `main.tsx` before React renders (theme and CSS variables), so a returning device does not flash. Project mode already waits for the project (section 6).

**Text scale UI and keys:** header group `A-`, a percent reset button, `A+` (aria-labels); clamp 50 to 200; effective font size clamped to 8 to 48 px. Document `keydown`: act only for `(ctrlKey || metaKey) && !altKey && !defaultPrevented` when the target is not an `input`, `textarea`, `select` or `contenteditable`; `=`/`+` (or `Equal`/`NumpadAdd`) larger, `-`/`_` (`Minus`/`NumpadSubtract`) smaller, `0` (`Digit0`/`Numpad0`) reset; `preventDefault()` only for handled keys (Safari/iPadOS may still zoom; the buttons are the reliable path). Plain `+ - 0` stay with the diagram viewer. Ctrl+wheel is not intercepted.

## 8. Security review

An attacker who can write a `.mdv.yaml`/`.mdv.yml` (or any file) in a root can:

- Reference any path in the same root (already readable by anyone on the LAN). `..` beyond the root and symlink escapes are blocked by the lexical test and `os.Root`, reported as `outside_root`.
- Trigger stats: bounded by the 201-reference limit, the per-Handle limiter, singleflight with the poll-interval TTL, the `2*FSTimeout` deadline and the unavailable fast-fail (not per-request fan-out).
- Show text (`name`, `ref`, messages): rendered as React text, length-limited, controls stripped, library messages sanitized (no host paths from reader errors, which never reach the decoder anyway); never HTML, never an unencoded URL part.
- Change display for those who open the project: enumerated or range-checked values only; names reach CSS only through registry lookups and data attributes (no CSS/URL injection). A device choice beats the project theme and Close project restores the lower layers.
- Burn resources: 32 KiB cap before parsing, 4 concurrent parses, aliases/anchors/tags/merge keys rejected before interpretation, depth 8, 2000 nodes, one document, library depth guard; panics become 422.

It cannot: read outside the roots, write, run code, fetch URLs (`http://x` looks cross-root and is dropped), or exceed existing caps. `MDV_PREFS` is trusted operator config; the README says not to bind-mount it inside a root (an attacker there could then edit preferences for every device).

Logging: the request line (existing). Project parse failures at DEBUG (root, path, line, code). Prefs state changes at WARN/INFO once per change (hash-deduplicated). Never logged: contents, reference text, host paths.

## 9. Tasks and required tests

| Task | Scope | Deps |
| --- | --- | --- |
| PJ1 🔒 | `internal/settings`: dependency, parser, precheck, sanitizer, limits, `ParseError`, `errorDetail.line`, warnings, fuzz | PJ0 |
| PJ2 | `MDV_PREFS`, `GET /api/prefs` (single outstanding read, O_NONBLOCK), Compose bind | PJ1 |
| PJ3 🔒 | `GET /api/project`, shared resolver (limiter, singleflight, TTL), kind map, `project` kind, client kind plumbing | PJ1 |
| PJ4a | `resolveSettings`, stores, migration, theme select, CSS variables, prefs banner, first-paint hold | PJ2 |
| PJ4b | text scale store, A-/A+/reset, Ctrl/Cmd keys | PJ4a |
| PJ5a | `?project=` routing, `ProjectProvider`, entering/switching, error-state table, Close project | PJ3, PJ4a, FV1 |
| PJ5b | project sidebar tree, warnings panel, live reload, keep last good, per-project device choices, Reset | PJ5a, PJ4b |
| PJ6 | "Projects only", Recent projects, project icon polish | PJ5b |
| PJ7 | docs, example project (missing folder, file-for-folder, enough `../` to really leave the root, an `other-root:` item, unknown key, bad `fontSize`) | PJ6 |
| PJ8 / PJ9 | validation + deploy / Opus review | PJ7 / PJ8 |

Tests that must exist (each fails without its change): reader-error host-path leak; concurrency bound (slow fake FS, concurrent requests, `/api/file` slot); Kind to code map (a row per Kind); `..notes.md` valid; one-letter root `c:`; switching projects without leaking settings; project loop (`open`, included project file); dead `?project=` (404, Close project); migration (each stored value, idempotent); PJ3 kind fallback; resolver precedence and leave-project as pure table tests; per-project device-choice isolation; fuzz tests; empty/comment-only prefs valid, empty project fatal.

## 10. Open items

None for the owner. Resolved in review: inside a project only that project's device choices apply (section 7).

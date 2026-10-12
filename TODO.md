# Project TODO

Prioritized project task list. **This file is the authoritative task tracker** for the project (D-16). Agent Workbench is not used.

Task details, dependencies, and acceptance criteria are in `docs/Implementation.md`. The tag after each ID is the model tier: **[H]** Haiku, **[S]** Sonnet, **[O]** Opus (see "Multi-Agent Workflow And Model Tiers" there). 🔒 = Opus security review before merge. Haiku only runs Git operations and tools; it does not author anything. Work top to bottom; a task is ready when its deps are done. Every task uses the Git workflow in `docs/Implementation.md` (fresh branch from a clean `main`, then the quality gate, then a `--no-ff` merge, then re-validation), and updates this file and `MEMORY.md` before merging.

## Needs Attention

Items that require a human decision, credential, source file, or manual validation before work can continue.

- [ ] Provide the initial NAS roots (VM mount paths) and the UID/GID that can read them (needed by D1/V1).

## In Progress

- [ ]

## Phase 0: Foundation

All Phase 0 tasks are done.

## Phase 1: MVP

Backend:

All backend tasks are done.

Frontend (each F-task adds its own e2e scenario):

All frontend tasks are done.

Packaging, tests, review:

R1 review fixes (D-26). Each task adds Go/unit/e2e tests for the behavior it changes:

- [ ] **V1** [Human] Deploy on VM + iPad manual checklist (deps: DOC1; do FIX-24 first, R2.13)

## Phase 2: Refinement

R2.13 review fixes (D-27). Each task adds tests that fail without the change:

- [ ] **FIX-24** [S] NFR-3 doc render (deps: FIX-23): a 459 KB doc with 5 Mermaid + 5 D2 had all diagrams ready at 3.7 s in WebKit iPad emulation (1.1 s for the same diagrams alone) and 5.4 s on chromium 4× CPU; target < 2 s. Investigate main-thread blocking (`mermaid.render` without a container measures inside `document.body`): render into a detached `contain: strict` container and/or render diagrams lazily near the viewport (IntersectionObserver). Promote the `build/r213` perf harness (`perf.spec.ts`, `gen.py`) into the repo as an opt-in `make perf` target and re-measure.
- [ ] **FIX-25** [S] Full-screen diagram viewer: `fullScreen`/`showSource` survive the error branch, so after a live-reload syntax error is fixed the dialog reopens by itself, briefly with a revoked blob URL (`web/src/diagrams/DiagramFigure.tsx:24-40`); reset them on error and clear `shown` when its URL is revoked. Initial focus likely misses Close (`DiagramViewer.tsx:37,127`: React `autoFocus` runs before `showModal()`); focus it after `showModal()`. E2E for both.
- [ ] **FIX-26** [S] Render limits in Markdown: fenced code has no Shiki size cap (the 100,000-char cap is only in `fileview/CodeFile.tsx:14`), so a large fence freezes the main thread; apply `MAX_HIGHLIGHT_CHARS` in `CodeBlock`/`highlightToHast` and pass `tokenizeMaxLineLength` (~5,000). KaTeX has no `maxSize` (`markdown/katex.ts:10`): `\kern{-5000em}`/`\rule` can draw over the header/sidebar (UI spoofing, no script); set `maxSize` (~20) and clip inline math.
- [ ] **FIX-27** [S] A retired root (after a remount swap) stays open until the next swap or shutdown (`internal/fsroot/lazy.go:146-149`), keeping a lazily unmounted share busy; close it after a grace period longer than `MDV_FS_TIMEOUT`.
- [ ] **FIX-28** [S] Flaky `TestEventsGlobalStreamCap` (`internal/api/events_test.go:461`, "stream did not open" after 5 s): failed once in `make check` under `make -j` load during FIX-21, then passed 6/6 alone and on the next full run. Make the wait robust (or the timeout load-tolerant) without weakening the cap check.
- [ ] **DOC2** [S] Docs drift: `docs/Tech-Stack.md:26` still lists `svg-pan-zoom` (R2.8 shipped `web/src/diagrams/panzoom.ts`, no dependency); `README.md` feature list misses hidden-files toggle, recent files/folders, home-screen app, copy-code button and live tree updates.
- [ ] **CH2** [S] Optional cleanup: one `createStoredStore(key, parse, serialize)` helper for the duplicated `useSyncExternalStore` + localStorage stores (`browse/showHidden.ts`, `recent/recent.ts`, TOC open state); remove unused `DIAGRAM_FILE_RE` (`diagrams/DiagramPage.tsx:3`).
- [ ] **FIX-20** [S] Dev-tooling `npm audit`: `markdownlint-cli2` 0.23.3 pulls `smol-toml` 1.8.0 (moderate, fixed in 1.9.1: add an override) and `braces` 3.0.3 via `micromatch` (high, no fix published yet: re-check). Lint-time only, never in the bundle.

## Phase 3: Future

- [ ] **FUT1** [S] Design full-text search
- [ ] **FUT2** [S] Server-side pinned favourites
- [ ] **FUT3** [S] Print/HTML export; diagram download
- [ ] **FUT4** [S] Voice-over conventions research + syntax proposal
- [ ] **FUT5** [S] Implement chosen voice-over extensions
- [ ] **FUT6** [S] Desktop wrapper decision

## Blocked

Move blocked tasks here with the reason and exact next action needed.

- [ ]

## Done

Move completed tasks here with a brief result note.

- [x] 2026-10-12: **FIX-23** [S] Markdown no longer re-parses or remounts on re-render: `MarkdownView` memoizes `makeComponents` on `[root, docPath, ws]` and the `<Markdown>` element on `[text, plugins, components]`. New vitest checks one Mermaid render per diagram across TOC, same-props and hash re-renders (fails on old code); `make check` and `make e2e` (224) green.
- [x] 2026-10-12: **FIX-22** [S] Bad image/tree subs no longer kill live reload: low-priority subs go as `lsub` on `/api/events`; the hub drops invalid ones (and drops them first over the watch caps) while normal `sub` errors still fail the stream; an all-dropped stream still opens. Go + vitest tests, new e2e on an fsnotify root (`livefs`); `make check` and `make e2e` (224) green.
- [x] 2026-10-12: **FIX-21** 🔒 [S] Root swap escape fixed: `lazyRoot` pins the root path (symlinks resolved in parent folders only; the root itself must be a real directory) and after every open walks it from `/` with `openat(O_PATH|O_NOFOLLOW)` and requires the opened root's dev/ino, else the root stays unavailable (`errRootMoved`); fsnotify host paths use the pinned path. Repro `build/r213/_swap` now blocked; 4 new Go tests; Opus security review clean after two rounds; `make check` and `make e2e` (220) green.
- [x] 2026-10-12: **R2.13** [O] Phase 2 review (3 parallel Opus reviewers: backend, frontend, conformance + NFR-3 perf; orchestrator re-checked each medium finding in source and re-ran the root-swap repro). 14 of 15 Phase 2 requirements met; NFR-3 partial: 10k listings pass (first row 121 ms, filter key ≤ 25 ms on WebKit iPad emulation) but a 459 KB doc with 10 diagrams takes 3.7 s (target 2 s). Logged FIX-21 to FIX-27, DOC2, CH2; D-27. Harness and logs in `build/r213/`.
- [x] 2026-10-12: **R2.12** [H] Full validation green: `make check` (Go gates pass, `fsroot` 98.1%; 249 web unit, 95.08% lines), `go test -race ./...` (8 packages ok), `make e2e` (220 passed on 4 projects), `docker compose build` (`mdv:dev`, 56.9 MB); compose smoke on `MDV_PORT=18080` healthy, SPA 200, `/api/roots` ok; all exit 0, logs in `build/r212/`.
- [x] 2026-10-12: **R2.11** [S] Browse listings with ≥ 200 shown entries use a measured `@tanstack/react-virtual` window list (`aria-setsize`/`aria-posinset`); tree folders page 200 children with "Show more" and always include the current item; unit tests plus e2e on a 2,000-file folder (8/8 red without it); `make check` green (249 unit), `make e2e` 220 passed.
- [x] 2026-10-12: **R2.10** [S] Each folder shown in the workspace tree (workspace folder + expanded folders) subscribes to itself at low priority, so adds/removes/renames refresh it without crowding out the viewed file's sub; component test (fake `EventSource`) and e2e (4/4) red without it; `make check` green, `make e2e` 212 passed.
- [x] 2026-10-12: **R2.9** [S] D2 "Layout" select (Auto/dagre/ELK) per figure; Auto sends no layout and the server now honors `vars.d2-config.layout-engine` (resolver used to ignore it; Go test red before); theme/layout/source re-renders keep the previous image (`aria-busy`), so tools and an open viewer stay mounted; `make check` green (245 unit), `make e2e` 208 passed.
- [x] 2026-10-12: **R2.8** [S] Ready diagrams get "Source" (`aria-pressed`, `pre.diagram-source`) and "Full screen": a native modal `dialog` (portaled, same blob URL) with drag pan, wheel/pinch zoom about the pointer (0.25–8×), Zoom/Fit buttons and `+`/`-`/`0`; focus returns on close; `make check` green (242 unit), `make e2e` 204 passed.
- [x] 2026-10-12: **R2.7** [S] KaTeX math (`$`, `$$`, ```` ```math ````) via remark-math + lazy rehype-katex after sanitize (`trust: false`), body waits for the chunk; TOC/slugs use the TeX source; in-repo `remarkAlerts` for the 5 GitHub alert types; `katex` override ≥ 0.19 clears the advisory (mermaid + markdownlint); 7 unit tests red without the plugins; `make check` green (229 unit), `make e2e` 196 passed.
- [x] 2026-10-12: **FIX-19** [S] `recent.spec.ts` polls the newest `mdv-recent` entry after each visit before navigating on (the file is recorded only once its parent listing loads); with a 500 ms recording delay injected the old spec fails and the new one passes on all 4 projects; `make check` green, `make e2e` 192 passed three times.
- [x] 2026-10-12: **R2.6** [S] Markdown TOC: "Contents" `details` with the rendered heading ids (read from the DOM, footnotes label skipped), nested by level, shown with ≥ 2 headings; collapsed above the body, sticky column at ≥ 1400 px; open state `mdv-toc-open`; `make check` green (220 unit), `make e2e` 192 passed twice.
- [x] 2026-10-12: **R2.5** [S] `text` files get Shiki colors by extension (`languageForFile` reuses fence aliases plus `h`/`hpp`/`jsonc`/`kts`/`pyi`), plain first via the lazy `CodeBlock`; unsupported/extensionless names and files over 100,000 chars stay plain without loading Shiki; e2e red without it; `make check` green (215 unit), `make e2e` 184 passed.
- [x] 2026-10-12: **R2.4** [S] `manifest.webmanifest` (standalone, 192/512 + maskable PNGs), 180 px apple-touch-icon, Apple meta tags and an M-arrow icon rendered from `web/icons/icon.svg`; `theme-color` follows the app theme; `.webmanifest` served as `application/manifest+json` (Go test red before); `make check` green, `make e2e` 180 passed.
- [x] 2026-10-12: **R2.3** [S] Recent files/folders (`mdv-recent`, 10 newest, keeps `ws`) recorded only once a file/folder is confirmed by its listing; shown on the home page and in the sidebar outside a workspace, with "Clear recent"; component test red without recording; `make check` green (207 unit), `make e2e` 172 passed.
- [x] 2026-10-12: **R2.2** [S] Copy button on every non-diagram fenced block (async clipboard, `execCommand` fallback for plain-HTTP LAN origins); non-blank front matter shown raw in a collapsed panel above the body; 4 component tests red without it; `make check` green (198 unit), `make e2e` 168 passed.
- [x] 2026-10-12: **R2.1** [S] "Show hidden files" checkbox in the browse toolbar (default off, persisted as `mdv-show-hidden`) shared with the workspace tree via one store; unit/component tests red without it; `make check` green (184 unit), `make e2e` 160 passed.
- [x] 2026-10-12: **FIX-18** [S] Root-relative Markdown images carry `v=<mtime>-<size>` from their folder listing and subscribe to the image file (low priority, so past the 32-sub cap they are dropped before the document's own sub); e2e red (4/4) with no version or a folder sub; `make check` green (175 unit), `make e2e` 156 passed.
- [x] 2026-10-12: **FIX-16** [S] `lazyRoot` compares host-path `st_dev`/`st_ino` with the open root at most every 2 s and reopens on a mismatch (later mount or unmount, replaced dir); old root retired, closed at the next swap or Close; tests red without detection; `make check` green (fsroot 98.1%), `make e2e` 152 passed.
- [x] 2026-10-12: **FIX-14** [S] Mermaid temp id is `mdvMermaid-N` (uppercase, so no lowercase heading slug can equal it; raw-HTML ids are prefixed); look-alike headings in `inline.md` survive; unit + e2e red (4/4) without the fix; `make check` green (172 unit), `make e2e` 152 passed.
- [x] 2026-10-12: **FIX-13** [S] `HostPath` joins the NFC/NFD form its stat succeeded with, so fsnotify watches on-disk names (file keys no longer silent, dir keys no longer fail); hub test red in fsnotify mode without the fix; `make check` green, `make e2e` 148 passed.
- [x] 2026-10-12: **FIX-12** [S] `/api/file` body copied through `chunkWriter` (fresh 10 s write deadline per chunk, no `ReaderFrom` bypass); stalled-client test red without it (15 s hang) and green with it; keep-alive reuse after the deadline verified; `make check` green, `make e2e` 148 passed.
- [x] 2026-10-12: **FIX-3** [S] Image view `<img>` URL carries `v=<mtime>-<size>` from the parent listing, so live reload shows on-disk changes; e2e red (4/4) without it, green with it; `make check` green, `make e2e` 148 passed.
- [x] 2026-10-12: **FIX-2** [S] Standalone diagrams go through `TextGate` (413 → size notice + "Load anyway" `force=1`); `fileKind` fallback mirrors `ClassifyName` (markdown/diagram/image/text); `large.d2` fixture + e2e; `make check` green (171 unit), `make e2e` 144 passed.
- [x] 2026-10-12: **DOC1** [S] README rewritten (quick start, full `MDV_*` table, `MDV_ALLOWED_HOSTS`, poll vs `:fsnotify`, startup/FIX-16, offline, troubleshooting); new `docs/Deployment.md` (CIFS/NFS fstab with low attribute caching, docker.service `RequiresMountsFor=`, `rslave` parent bind, `.env`); claims checked against code; `make check` green.
- [x] 2026-10-12: **FIX-17** [S] Firefox live-folder e2e failure: SSE streams now start with a `: open` comment so Firefox fires EventSource `open` (refetch-on-open) immediately; e2e 3/3 red → 3/3 green (140 passed).
- [x] 2026-10-12: **FIX-15** [S] Drawer e2e flake: closed drawer is `visibility: hidden` so role locators miss it; assert via `#sidebar` (not `is-open`, hidden, menu `aria-expanded=false`). No app race (close is synchronous on navigation).
- [x] 2026-10-12: **FIX-11** [S] FR-1.2 "Sort by" control (name default / date newest first), folders first, persisted as `mdv-sort`; unit + component + e2e (live root, controlled mtimes, survives reload); `make check` green (154 unit), `make e2e` 140 passed twice.
- [x] 2026-10-11: **FIX-10** [S] E2E: shared offline guard (`e2e/tests/fixtures.ts`) fails any non-local http(s) request in every spec; back/forward walk (FR-6.2); relative image `naturalWidth > 0` (SC1); Mermaid+D2 page makes no remote requests; `make e2e` 136 passed, `make check` green.
- [x] 2026-10-11: **FIX-9** [S] Compose `MDV_ROOTS`/`MDV_POLL_INTERVAL` overridable from env; poll default 2s in config and Compose (SC3); commented NAS example binds the parent of the mount points with `propagation: rslave`, `create_host_path: false`; `make check` green, `make e2e` 124 passed (re-run after the FIX-15 flake).
- [x] 2026-10-11: **FIX-8** [S] Roots open lazily under `MDV_FS_TIMEOUT`, concurrently at boot; a missing/erroring/hung root starts `available:false` with a startup warning and recovers via the probe without restart; a non-directory root still fails startup; config no longer stats paths; fsroot 97.9%, `make check` green, `make e2e` 124 passed.
- [x] 2026-10-11: **FIX-7** [S] Missing-path watch keys capped separately (`MaxMissing` 64) so they cannot exhaust `MaxWatches`; `/api/events` caps 64 streams total and 16 per TCP peer IP (503 `busy`); watch 92.7%, api 95.1%, `make check` green, `make e2e` 124 passed.
- [x] 2026-10-11: **FIX-6** [S] D2 SVG cache bounded by total bytes (64 MiB) as well as entries; SVGs over 4 MiB not cached but still returned (`Options.CacheBytes`/`MaxEntryBytes`, no new env var); 95.7% d2render, `make check` green.
- [x] 2026-10-11: **FIX-5** 🔒 [S] Host allowlist on every route (API, SSE, SPA, `/healthz`): 421 `host_not_allowed` unless Host is an IP literal, `localhost` or in `MDV_ALLOWED_HOSTS` (`*` disables with a warning); healthcheck sends `Host: localhost`; compose passthrough; Opus review approved.
- [x] 2026-10-11: **FIX-4** 🔒 [S] `POST /api/render/d2`: 415 unless `application/json`, `http.CrossOriginProtection` (JSON 403), `fileCSP` + nosniff on every render response; Go tests for form enctypes, Sec-Fetch-Site, Origin/Host, safe methods, headers; client test asserts the JSON header; Opus review approved; proxy must keep `Host` or use TLS (Architecture).
- [x] 2026-10-11: **R1** [O] MVP review (3 parallel Opus reviewers: backend, frontend, conformance; orchestrator re-checked each logged finding in source). Path guard, sanitizer, diagram `<img>` isolation and `/api/file` headers hold. Logged FIX-4 to FIX-11 (Phase 1, block DOC1; FIX-4/5 🔒) and FIX-12 to FIX-14 (Phase 2); docs drift fixed; D-26.
- [x] 2026-10-11: **T2** Full validation green: `make check` (Go coverage gates pass, `fsroot` 98.2%; 147 web unit, 93.46% lines), `go test -race ./...` (8 packages ok), `make e2e` (124 passed on 4 projects), `docker compose build` (`mdv:dev`); all exit 0, logs in `build/t2/`.
- [x] 2026-10-11: **CH1** [S] `MEMORY.md` streamlined (32 KB → 7 KB): 29 older run log entries moved to `agents/Memory-History.md`, open follow-ups consolidated into "Known Limitations And Accepted Risks", keep-last-three rule added to `docs/Implementation.md` step 5.
- [x] 2026-10-11: **T1** Playwright projects chromium, firefox, webkit, ipad (`iPad Pro 11`, 834 px → drawer); `flow.spec.ts` (browse → workspace → relative link → anchor, script not executed, API traversal rejected with a 200 control); drawer-aware `openTree` in workspace spec; 124 e2e (31 × 4), no skips, 3 consecutive green runs.
- [x] 2026-10-11: **D1** `Dockerfile` (node 24.21 → golang 1.27.2 → distroless static nonroot), `compose.yaml` (read_only, cap_drop ALL, no-new-privileges, `user: ${MDV_UID:-1000}:${MDV_GID:-1000}`, `./examples:ro`, healthcheck), `.dockerignore`, `make docker`; hadolint/yamllint clean, compose goes healthy and serves list/SPA/D2.
- [x] 2026-10-11: **EX1** `examples/`: GFM tour + front matter, Mermaid (5 types + `.mmd`), D2 (basic, containers, sql_table, sequence + `.d2`), nested cross-linked `guide/`, PNG/SVG images, `broken*` diagrams of each kind; markdownlint clean, D2 200/422 verified on server, Mermaid parse verified.
- [x] 2026-10-11: **F6** `web/src/live/`: one EventSource per tab via `LiveProvider`/`LiveController` (ref-counted, sorted, ≤ 32 subs, 50 ms debounced reopen, CLOSED → jittered backoff 1–30 s); `change` invalidates file + parent/own `list` queries; `open`/visible invalidate active roots/list/file; Markdown keeps the nearest heading's offset; e2e `live` poll root under `build/e2e/live`; 147 unit, 28 e2e (incl. 3-tab acceptance).
- [x] 2026-10-11: **F5** `web/src/workspace/` lazy tree at `?ws=` (aria-expanded toggles, ancestors auto-expanded, `aria-current`), `scopeWs` drops `ws` outside the workspace (browse entries, breadcrumbs); `web/src/fileview/` views by server kind from the parent listing (markdown, diagram, image, text, other/download), 413 "Load anyway" with `force=1`; route `errorElement` inside the layout; 129 unit, 24 e2e.
- [x] 2026-10-11: **F4** `web/src/diagrams/`: Mermaid 12.1 (lazy, strict, `htmlLabels: false`, serialized queue) and D2 (`renderD2` + TanStack query, 503/504 retried) shown as `<img src=blob:>` (D-25); error box + source, per-diagram error boundary, theme observer re-render, full-page `.mmd`/`.mermaid`/`.d2` views; 116 unit, 18 e2e.
- [x] 2026-10-11: **F3b** Shiki 4.5 in the `pre` component post-sanitize (D-24): plain first, then hast→JSX swap; lazy core/JS engine/themes + 30 languages by literal import (aliases), unknown → plain, dual themes via `data-theme`; 98 unit, 14 e2e.
- [x] 2026-10-11: **F3** 🔒 `web/src/markdown/`: exact remark/rehype order, pure `resolveLink` (view/browse/file/blocked, `ws` kept only inside), footnote double-prefix fixed, anchor scroll with `user-content-` fallback, lazy `MarkdownView` chunk for `.md` views; Opus review: no XSS, footnote-attr bypass fixed; 87 unit, 13 e2e.
- [x] 2026-10-11: **F2** `web/src/browse/`: folder listing (kind icons, size, mtime, markdown highlighted, dot-files hidden, truncation notice), breadcrumbs (drop `ws` above the workspace), name filter (resets per folder), persisted markdown-only toggle, "Open as workspace" (README/index first); `?ws=` (empty) = root workspace; 5 e2e scenarios.
- [x] 2026-10-11: **T0** Playwright 1.64.0 in the pinned `mcr.microsoft.com/playwright:v1.64.0-noble` image against `build/mdv` + fixtures; `make e2e` real (smoke, traversal, F1 drawer/theme scenarios; 5 pass); `lint-e2e` in `make lint`.
- [x] 2026-10-11: **F1** App shell: React Router 8.4 routes, typed API client + TanStack Query 5.104 hooks (4xx never retried), sidebar drawer < 900 px, theme (system/light/dark, `mdv-theme`), error-model states, one-shot `vite:preloadError` reload; 96.2% `src/api`. E2E deferred to T0 (scaffold depends on F1).
- [x] 2026-10-11: **FIX-1** fsnotify re-arms deleted-then-recreated host dirs: waits on the nearest existing ancestor (never above the root), re-validates via `Handle` off the reader goroutine (escaping symlinks never re-armed), catch-up `created`/`modified`; 92.6% watch.
- [x] 2026-10-11: **B7** Watch concurrency review: no races (`-race -count=20`); fixed per-write SSE deadline, 405 on non-GET, missing sub paths accepted (later `created`), poll kind swaps, 256-key watch cap (503); fsnotify recreate deferred to FIX-1.
- [x] 2026-10-11: **B6** `internal/watch` hub (ref-counted, 250 ms coalescing, poll + fsnotify) + `GET /api/events` SSE; streams end on shutdown; 94.8% watch / 94.2% api.
- [x] 2026-10-11: **B5** `internal/d2render` + `POST /api/render/d2` (empty `fs.FS`, slot held until goroutine returns, LRU incl. negative cache, singleflight); spike deleted; 94.4% coverage.
- [x] 2026-10-11: **B4b** `internal/web` SPA handler (history fallback, `/assets` immutable, 503 when unbuilt); `mdv serve|version|healthcheck` with graceful shutdown; 95.2% coverage.
- [x] 2026-10-11: **B4a** `internal/api` (healthz, roots, list, allowlist file serving, error model, recover/slog); timed `Handle.Reader`, slot wait (D-23); Opus review fixes applied; 94.7% coverage.
- [x] 2026-10-11: **B3** `fsroot.Handle` (timeouts, in-flight cap, unavailable + probe), `List`, NFC/NFD retry, `Registry`; 98.7% coverage.
- [x] 2026-10-11: **B2** `internal/fsroot` path guard on `os.Root`; Opus review fixes applied (D-22); 98.2% coverage.
- [x] 2026-10-11: **B1** `internal/config` env-only loader; all errors joined; 100% coverage.
- [x] 2026-10-11: **P0.6** Opus plan challenge; 15 findings applied (D-19–D-21).
- [x] 2026-10-11: **P0.5** D2 v0.9.0 library spike; findings in agents/Research.md.

- [x] 2026-10-11: **P0.4** Fixture tree + testdata/mkfixtures.sh (symlinks, large file generated).
- [x] 2026-10-11: **P0.3** Lint configs (golangci-lint, ESLint/Prettier, yamllint, markdownlint, hadolint, shellcheck) + per-tool make lint targets.
- [x] 2026-10-11: **P0.2** Makefile (build/ outputs), Vitest 5 harness, covercheck gate (99.3% self-coverage, `make check` green).
- [x] 2026-10-11: **P0.1** Scaffolded Go module, internal packages, Vite React-TS app (outDir internal/web/dist).
- [x] 2026-10-11: Researched tech stack (D2, Mermaid, Markdown pipeline, desktop wrappers, SMB). Notes in `agents/Research.md`.
- [x] 2026-10-11: Filled `docs/Requirements.md`, `docs/Tech-Stack.md`, and `docs/Architecture.md`.
- [x] 2026-10-11: Owner decisions: host mounts only, no auth, viewer + live reload, Go backend (D-5), Docker Compose on a VM (D-11).
- [x] 2026-10-11: Git workflow, quality gates (YAML lint configs, coverage targets), and build-artifact layout defined (`docs/Implementation.md`).
- [x] 2026-10-11: Model tiers revised: Haiku = Git + tool runs, Sonnet = authoring/research/planning, Opus = big reviews, debates, escalations (D-18).
- [x] 2026-10-11: AWB dropped; `TODO.md` is the task tracker (D-16).
- [x] 2026-10-11: Planning: finalized API/config/layout/routes in `docs/Architecture.md`; phased plan with model tiers in `docs/Implementation.md`.

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

- [ ] **V1** [Human] Deploy on VM + iPad manual checklist (deps: DOC1)

## Phase 2: Refinement

- [ ] **R2.1** [S] Hidden-files toggle (date sort moved to FIX-11)
- [ ] **R2.2** [S] Copy-code button; front-matter panel
- [ ] **R2.3** [S] Recent files/folders
- [ ] **R2.4** [S] Web-app manifest + home-screen icons
- [ ] **R2.5** [S] Highlighting for standalone code files
- [ ] **R2.6** [S] Table of contents
- [ ] **R2.7** [S] KaTeX math; GitHub alerts (also clear the low-severity `npm audit` katex advisory pulled in by mermaid 12.1: katex ≥ 0.19 or an override, verified with Mermaid math)
- [ ] **R2.8** [S] Diagram source toggle, pan/zoom, full screen
- [ ] **R2.9** [S] D2 ELK option; theme-aware re-render
- [ ] **R2.10** [S] Workspace tree live updates
- [ ] **R2.11** [S] Virtualized listings
- [ ] **R2.12** [H] Full validation run
- [ ] **R2.13** [O] Phase review + iPad performance check

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

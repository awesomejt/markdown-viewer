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

- [ ] **T2** [H] Full validation run (deps: T1)
- [ ] **R1** [O] MVP phase review; log FIX-n tasks (deps: T2)
- [ ] **DOC1** [S] README quick start + Compose deployment (deps: R1)
- [ ] **V1** [Human] Deploy on VM + iPad manual checklist (deps: DOC1)

## Phase 2: Refinement

- [ ] **FIX-2** [S] Oversized standalone diagram (`DiagramPage`) gets the F5 "Load anyway" (`force=1`) button; `/view` kind fallback covers image/text extensions when the parent listing lacks the entry
- [ ] **FIX-3** [S] Live reload for image files: `ImageFile` uses a plain `<img src>`, so an on-disk change never shows; add a cache-buster (listing mtime) to the URL
- [ ] **R2.1** [S] Hidden-files toggle; sort by date
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

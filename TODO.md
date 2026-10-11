# Project TODO

Prioritized project task list. When Agent Workbench is configured, use `awb task next` / `awb task list` instead of reading this file directly. This file serves as the fallback when AWB is not available and as the initial task list before tasks are imported into AWB.

Task details, dependencies, and acceptance criteria are in `docs/Implementation.md`. The tag after each ID is the model tier: **[H]** Haiku, **[S]** Sonnet, **[O]** Opus (see "Multi-Agent Workflow And Model Tiers" there). 🔒 = Sonnet code review before commit. Work top to bottom; a task is ready when its deps are done. Every task uses the Git workflow in `docs/Implementation.md` (fresh branch from a clean `main`, then the quality gate, then a `--no-ff` merge, then re-validation), and updates this file and `MEMORY.md` before merging.

## Needs Attention

Items that require a human decision, credential, source file, or manual validation before work can continue.

- [ ] Provide the initial NAS roots (VM mount paths) and the UID/GID that can read them (needed by D1/V1).
- [ ] Reconfigure AWB (`awb init`) or keep using this file. `.awb/config.yaml` is currently deleted (uncommitted).

## In Progress

- [ ]

## Phase 0: Foundation

- [ ] **P0.1** [H] Scaffold Go module, layout, and Vite React-TS app (bundle to ignored `internal/web/dist/`)
- [ ] **P0.2** [H] Makefile; all outputs under ignored `build/` (deps: P0.1)
- [ ] **P0.3** [H] Lint configs (YAML) + `make lint` + coverage gates (deps: P0.2)
- [ ] **P0.4** [H] Test fixture tree + `testdata/mkfixtures.sh` (deps: P0.1)
- [ ] **P0.5** [S] Spike: D2 v0.9.0 library render; record API usage (deps: P0.1)

## Phase 1: MVP

Backend:

- [ ] **B1** [H] Config package (env + YAML) (deps: P0.3)
- [ ] **B2** [O] 🔒 Path guard (deps: B1, P0.4)
- [ ] **B3** [S] Listing + reads with timeouts (deps: B2)
- [ ] **B4** [S] 🔒 HTTP API core + SPA embed (deps: B3)
- [ ] **B5** [S] D2 render endpoint + cache (deps: B4, P0.5)
- [ ] **B6** [S] Watch hub + SSE (deps: B4)
- [ ] **B7** [S] Concurrency review of B6 (deps: B6)

Frontend:

- [ ] **F1** [S] App shell: routes, API client, layout, theme (deps: P0.3, B4)
- [ ] **F2** [S] Browse views (deps: F1)
- [ ] **F3** [S] 🔒 Markdown pipeline + link rewriting + sanitizing (deps: F1)
- [ ] **F4** [S] Mermaid + D2 diagram components (deps: F3, B5)
- [ ] **F5** [S] Workspace tree + file views by kind (deps: F2, F3)
- [ ] **F6** [S] Live reload client (deps: F5, B6)

Packaging, tests, review:

- [ ] **EX1** [H] Example Markdown set in `examples/` (GFM, Mermaid, D2, cross-links) (deps: F4)
- [ ] **D1** [H] Dockerfile + compose.yaml, hadolint/yamllint clean (deps: B4, F1)
- [ ] **T1** [S] Playwright e2e incl. WebKit/iPad viewport (deps: F6, D1, EX1)
- [ ] **T2** [H] Full validation run (deps: T1)
- [ ] **R1** [O] MVP phase review; log FIX-n tasks (deps: T2)
- [ ] **DOC1** [H] README quick start + Compose deployment (deps: R1)
- [ ] **V1** [Human] Deploy on VM + iPad manual checklist (deps: DOC1)

## Phase 2: Refinement

- [ ] **R2.1** [H] Hidden-files toggle; sort by date
- [ ] **R2.2** [H] Copy-code button; front-matter panel
- [ ] **R2.3** [H] Recent files/folders
- [ ] **R2.4** [H] Web-app manifest + home-screen icons
- [ ] **R2.5** [H] Highlighting for standalone code files
- [ ] **R2.6** [S] Table of contents
- [ ] **R2.7** [S] KaTeX math; GitHub alerts
- [ ] **R2.8** [S] Diagram source toggle, pan/zoom, full screen
- [ ] **R2.9** [S] D2 ELK option; theme-aware re-render
- [ ] **R2.10** [S] Workspace tree live updates
- [ ] **R2.11** [S] Virtualized listings; large-file warning
- [ ] **R2.12** [H] Full validation run
- [ ] **R2.13** [O] Phase review + iPad performance check

## Phase 3: Future

- [ ] **FUT1** [O] Design full-text search
- [ ] **FUT2** [S] Server-side pinned favourites
- [ ] **FUT3** [S] Print/HTML export; diagram download
- [ ] **FUT4** [O] Voice-over conventions research + syntax proposal
- [ ] **FUT5** [S] Implement chosen voice-over extensions
- [ ] **FUT6** [O] Desktop wrapper decision

## Blocked

Move blocked tasks here with the reason and exact next action needed.

- [ ]

## Done

Move completed tasks here with a brief result note.

- [x] 2026-10-11: Researched tech stack (D2, Mermaid, Markdown pipeline, desktop wrappers, SMB). Notes in `agents/Research.md`.
- [x] 2026-10-11: Filled `docs/Requirements.md`, `docs/Tech-Stack.md`, and `docs/Architecture.md`.
- [x] 2026-10-11: Owner decisions: host mounts only, no auth, viewer + live reload, Go backend (D-5), Docker Compose on a VM (D-11).
- [x] 2026-10-11: Git workflow, quality gates (YAML lint configs, coverage targets), and build-artifact layout defined (`docs/Implementation.md`).
- [x] 2026-10-11: Planning: finalized API/config/layout/routes in `docs/Architecture.md`; phased plan with model tiers in `docs/Implementation.md`.

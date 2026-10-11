# Project TODO

Prioritized project task list. **This file is the authoritative task tracker** for the project (D-16). Agent Workbench is not used.

Task details, dependencies, and acceptance criteria are in `docs/Implementation.md`. The tag after each ID is the model tier: **[H]** Haiku, **[S]** Sonnet, **[O]** Opus (see "Multi-Agent Workflow And Model Tiers" there). 🔒 = Opus security review before merge. Haiku only runs Git operations and tools; it does not author anything. Work top to bottom; a task is ready when its deps are done. Every task uses the Git workflow in `docs/Implementation.md` (fresh branch from a clean `main`, then the quality gate, then a `--no-ff` merge, then re-validation), and updates this file and `MEMORY.md` before merging.

## Needs Attention

Items that require a human decision, credential, source file, or manual validation before work can continue.

- [ ] Provide the initial NAS roots (VM mount paths) and the UID/GID that can read them (needed by D1/V1).

## In Progress

- [ ]

## Phase 0: Foundation

- [ ] **P0.6** [O] Debate/challenge the architecture and Phase 1 plan; apply accepted changes (deps: P0.5)

## Phase 1: MVP

Backend:

- [ ] **B1** [S] Config package (env + YAML) (deps: P0.3, P0.6)
- [ ] **B2** [S] 🔒 Path guard (deps: B1, P0.4)
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

- [ ] **EX1** [S] Example Markdown set in `examples/` (GFM, Mermaid, D2, cross-links) (deps: F4)
- [ ] **D1** [S] Dockerfile + compose.yaml, hadolint/yamllint clean (deps: B4, F1)
- [ ] **T1** [S] Playwright e2e incl. WebKit/iPad viewport (deps: F6, D1, EX1)
- [ ] **T2** [H] Full validation run (deps: T1)
- [ ] **R1** [O] MVP phase review; log FIX-n tasks (deps: T2)
- [ ] **DOC1** [S] README quick start + Compose deployment (deps: R1)
- [ ] **V1** [Human] Deploy on VM + iPad manual checklist (deps: DOC1)

## Phase 2: Refinement

- [ ] **R2.1** [S] Hidden-files toggle; sort by date
- [ ] **R2.2** [S] Copy-code button; front-matter panel
- [ ] **R2.3** [S] Recent files/folders
- [ ] **R2.4** [S] Web-app manifest + home-screen icons
- [ ] **R2.5** [S] Highlighting for standalone code files
- [ ] **R2.6** [S] Table of contents
- [ ] **R2.7** [S] KaTeX math; GitHub alerts
- [ ] **R2.8** [S] Diagram source toggle, pan/zoom, full screen
- [ ] **R2.9** [S] D2 ELK option; theme-aware re-render
- [ ] **R2.10** [S] Workspace tree live updates
- [ ] **R2.11** [S] Virtualized listings; large-file warning
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

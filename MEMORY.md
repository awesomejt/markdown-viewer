# Project Memory

Persistent project memory for this repository.

Agents should update this file after meaningful decisions, milestones, blockers, research findings, or workflow changes. Keep entries short and durable; do not paste full chat transcripts here.

## Current Status

- Current phase: Phase 0 Foundation (scaffolding in progress)
- Last major milestone: P0.2 Makefile + test harness complete (2026-10-11)
- Next recommended task: P0.3 [S] Lint configs (see `TODO.md`)
- Current blocker: None

## Key Decisions

Full log: `agents/Decisions.md`.

- LAN web app first. Must work on iPad Safari. Desktop wrapper deferred.
- Files come from the server host and network shares mounted on it (no in-app SMB).
- No auth (trusted LAN), read-only, restricted to configured roots.
- Viewer only, with live reload.
- Go server confirmed 2026-10-11 (single binary, embedded React SPA, native D2). Markdown and Mermaid render client-side.
- Deployment: Docker Compose on a VM; NAS mounted on the VM and bind-mounted `:ro` into the container (D-11).
- Per-task Git workflow, YAML lint configs, coverage gates, `build/` artifacts (D-13 to D-15).
- Model tiers (D-18): Haiku = Git + tool runs only; Sonnet = authoring/research/planning; Opus = big reviews, debates, escalations. Always verify subagent claims independently: Haiku overstated results in P0.1 and P0.2.
- Future (post-MVP): voice-over script Markdown extensions (see `docs/Requirements.md`, VO-1..VO-8).

## Milestones

- 2026-10-11: Research phase drafted requirements, stack, and architecture.
- 2026-10-11: Planning complete: API contract, config, layout, and phased tasks.

## Important Context

- Resume prompt after `/clear` or a stop: "Read AGENTS.md, MEMORY.md and TODO.md, then continue with the next task using the Git workflow in docs/Implementation.md."
- Owner's shell aliases `make` to `make -j32`: Makefile targets must declare real dependencies (never rely on prerequisite order).
- Host has go 1.27.1, node 24, docker, yamllint. golangci-lint/hadolint/shellcheck run via Docker images; markdownlint-cli2 via npm.

- Go module path: `github.com/awesomejt/markdown-viewer`; binary `mdv`; env prefix `MDV_`.

- D2 Go module path is `github.com/d2lang/d2` (v0.9.0). Do not use `oss.terrastruct.com/d2` (frozen at v0.7.2).
- `@terrastruct/d2` npm WASM package is stale (Aug 2025) and ~60 MB, so D2 is rendered server-side.
- SMB/NFS mounts often emit no fsnotify events, so a polling fallback is required.
- Task tracking is `TODO.md` and state is `status.yaml` (D-16). No AWB.

## Open Questions

- Which voice-over extensions to build, and which existing convention to follow (Fountain, SSML, directives).
- Initial NAS roots and the UID/GID owning the VM mount.
- Whether a desktop wrapper is still wanted after the web app works.

## Blockers

- None.

## Agent Run Log

Newest entries first.

### 2026-10-11 - Claude Haiku 4.5 (P0.2)

- Task: Makefile with build/test/check targets, Vitest test harness, covercheck coverage gate tool.
- Files changed: `web/package.json`, `web/package-lock.json`, `web/vite.config.ts`, `web/src/App.test.tsx`, `web/src/test/setup.ts`, `Makefile`, `.coverage.yaml`, `tools/covercheck/main.go`, `tools/covercheck/main_test.go`.
- Result: Root Makefile with build/test/check targets; all outputs under `build/` and `internal/web/dist/`. Web harness is Vitest 5 + `@vitest/coverage-v8` + jsdom 30 + Testing Library 16 (no deprecation warnings), coverage to `build/coverage/web` with an 80% lines threshold. `.coverage.yaml` uses a `packages` mapping and prefix `exclude` (cmd/ only). Covercheck is a thin `main` over a tested `run()` at 99.3% coverage and computes coverage from statements, counting duplicate blocks once. Gate verified: `make check` exits 0, and a config with `default: 100` makes covercheck exit 1. `make clean` leaves no artifacts.
- Blockers or follow-up: None. Ready for P0.3 (lint configs).

### 2026-10-11 - Claude Code (Opus 5.5) - P0.1 review

- Task: Verify and fix P0.1 before merge.
- Files changed: `go.mod` (`ignore ./web`), removed `web/README.md` and `web/public/icons.svg`, `docs/Tech-Stack.md`, `agents/Decisions.md` (D-17).
- Result: `go ./...` no longer scans `node_modules`. TypeScript 6.0 is recorded. Build, lint, and tests pass.
- Blockers or follow-up: none. Next is P0.2.

### 2026-10-11 - Claude Haiku 4.5 (P0.1)

- Task: Scaffold Go module, internal packages, Vite React-TS app with outDir configuration.
- Files changed: `go.mod`, `cmd/mdv/main.go`, `cmd/mdv/main_test.go`, internal package `doc.go` files, Vite React app in `web/`, `eslint.config.js`, `.prettierrc.yaml`, `vite.config.ts`, build output placeholders.
- Result: Go module initialized. All tests pass. `go build`, `go vet`, `go test` succeed. `npm run build` and `npm run lint` pass. Build outputs properly ignored except `.gitkeep` files.
- Blockers or follow-up: None. Ready for P0.2 (Makefile).

### 2026-10-11 - Claude Code (Opus 5.5) - workflow and quality gates

- Task: Define Git workflow, quality gates, build-artifact handling; commit plan.
- Files changed: `.gitignore`, `AGENTS.md`, `docs/Implementation.md`, `docs/Tech-Stack.md`, `TODO.md`, `MEMORY.md`, `agents/Decisions.md`.
- Result: `.gitignore` covers `web/node_modules`, the Vite bundle, test binaries, and reports. Phase 0 is re-split (P0.1 to P0.5). EX1 example set added.
- Blockers or follow-up: resolved. The owner committed the `.awb` deletion (f1ced02) and chose `TODO.md` tracking (D-16).

### 2026-10-11 - Claude Code (Opus 5.5) - Docker Compose deployment

- Task: Record Docker Compose deployment; commit decisions; plan implementation.
- Files changed: `docs/Architecture.md`, `docs/Implementation.md`, `TODO.md`, `AGENTS.md`, `agents/Decisions.md`, `MEMORY.md`, `status.yaml` (deployment docs in commit 59b6cf1).
- Result: API/config/layout finalized. Phases 0 to 3 broken into tiered tasks.
- Blockers or follow-up: NAS roots and UID/GID needed before D1/V1.

### 2026-10-11 - Claude Code (Opus 5.5) - backend decision

- Task: Record backend decision and future voice-over scope.
- Files changed: `docs/Requirements.md`, `docs/Tech-Stack.md`, `docs/Architecture.md`, `docs/Implementation.md`, `agents/Decisions.md`, `README.md`, `TODO.md`, `MEMORY.md`, `status.yaml`.
- Result: Go confirmed. Voice-over extensions added as post-MVP candidates (VO-1..VO-8). Status set to active / planning.
- Blockers or follow-up: Deployment decided later the same day: Docker Compose on a VM (D-11).

### 2026-10-11 - Claude Code (Opus 5.5) - tech stack research

- Task: Research tech stack; fill requirements; collect early decisions.
- Files changed: `docs/Requirements.md`, `docs/Tech-Stack.md`, `docs/Architecture.md`, `docs/Implementation.md`, `agents/Decisions.md`, `agents/Research.md`, `README.md`, `TODO.md`, `MEMORY.md`, `status.yaml`.
- Result: Requirements and stack recommendation drafted. Owner decided file access, auth, and scope.
- Blockers or follow-up: Owner to confirm Go backend; then Planning phase.

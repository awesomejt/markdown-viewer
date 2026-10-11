# Project Memory

Persistent project memory for this repository.

Agents should update this file after meaningful decisions, milestones, blockers, research findings, or workflow changes. Keep entries short and durable; do not paste full chat transcripts here.

## Current Status

- Current phase: Phase 1 MVP
- Last major milestone: B3 listing + timed reads complete (2026-10-11)
- Next recommended task: B4a [S] 🔒 HTTP API core, error model, allowlist file serving
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
- D2 Go API (P0.5): `d2lib.Compile` + `d2svg.Render`, pure Go (no CGO/JS), ~1-3 ms for small diagrams, +22 MB binary, deterministic SVG with embedded fonts; details in `agents/Research.md`.
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

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 orchestration (B3)

- Task: Listing + reads with timeouts, in-flight cap, NFC/NFD retry.
- Files changed: `internal/fsroot/{access,ops,kind,registry}.go` + tests, `guard.go` (`KindTimeout`/`ErrTimeout`), `go.mod` (`x/text` direct), `testdata/mkfixtures.sh` (NFD fixture), `docs/Architecture.md`.
- Result: `Handle` runs each fs op in a goroutine under `MDV_FS_TIMEOUT`; the non-blocking in-flight slot is held until the call returns, so a dead mount never holds more than the cap. Only the handle's own timeout marks a root unavailable (caller cancel and a full cap give 504 but don't). One probe stat at a time restores it. `List` on a file is 400; symlinks that escape/dangle/loop are omitted; `Listing.Path` is `"."` for the root (B4a maps to `""`). `ClassifyName` is exported for the B4a allowlist. Sonnet review: no blockers; 3 weak tests fixed. 98.7% coverage; `make check` green.
- Blockers or follow-up: B4a must not trust reads from an opened `*os.File` on a dead mount (outside the timeout), and must map `KindTimeout` to 504 `fs_timeout`. Probe has no own timeout (bounded by its slot).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 review (B2)

- Task: Path guard on `os.Root` (🔒).
- Files changed: `internal/fsroot/{guard.go,guard_test.go,doc.go}`, `docs/Architecture.md`, `docs/Implementation.md`, `agents/Decisions.md` (D-22).
- Result: `Resolve(rel)` lexical prechecks (400) plus guarded `Open`/`Stat`/`Lstat`/`ReadDir` returning `*PathError` with `Kind`, sentinels, and `KindOf`. Escapes are matched on `os.Root`'s unexported "path escapes from parent" text (pinned by `TestEscapeErrorContract`, fail-closed to 500). `Open` uses `O_NONBLOCK` + fstat and refuses FIFOs/devices (403). The Opus review found no blockers; all 7 findings were fixed on the branch. 98.2% coverage; `make check` green.
- Blockers or follow-up: B4a must send only `PathError.PublicMessage()` to clients (`Error()`, `File.Name()` and file-method errors contain host paths). B3 should add context-aware wrappers, not change these signatures.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 review (B1)

- Task: Env-only config package.
- Files changed: `internal/config/{config.go,config_test.go,doc.go}`.
- Result: `config.Load(getenv)` / `FromEnv()`. Validates every `MDV_*` var, stats roots (absolute, existing dir), and joins all errors. The `:poll`/`:fsnotify` suffix is split off only when it is a known mode, so other colons stay in the path. 100% coverage; `make check` green. Not yet wired into `main` (B4b).
- Blockers or follow-up: None. Ready for B2.

### 2026-10-11 - Claude Sonnet 5.5 (P0.6 apply)

- Task: Apply the 15 accepted plan-challenge findings (C-1 to C-15).
- Files changed: `docs/Architecture.md`, `docs/Implementation.md`, `docs/Requirements.md`, `docs/Tech-Stack.md`, `TODO.md`, `MEMORY.md`, `agents/Decisions.md`.
- Result: SSE is one stream per tab (`sub=`); dead-mount in-flight cap; allowlist file serving; D2 empty FS, busy/timeout codes; `os.Root` guard; env-only config (D-20); minimal large-file button in MVP (D-21); B4 split into B4a/B4b, F3 into F3/F3b, T0 added. Decisions D-19 to D-21.
- Blockers or follow-up: B3 adds an NFD fixture via `mkfixtures.sh`. Ready for B1.

### 2026-10-11 - Claude Code (Opus 5.5) - P0.5 review

- Task: Verify P0.5 and fix `make clean` (read-only Go module cache under `build/.cache`).
- Result: `make check` and `make clean` verified on the branch. For B5: dagre ignores ctx, so it needs its own wall-clock limit; `Ruler` concurrency safety is unverified.

### 2026-10-11 - Claude Sonnet 5.5 (P0.5)

- Task: Spike the D2 Go library.
- Files changed: `cmd/spike-d2/main.go`, `go.mod`, `go.sum`, `agents/Research.md`.
- Result: Renders light (0) and dark (200) SVG with dagre and ELK; findings (API, timings, sizes, errors, determinism) recorded in `agents/Research.md`. The spike is deleted when B5 lands.
- Blockers or follow-up: Dagre ignored a 1 ns ctx timeout, so B5 needs its own wall-clock limit. Ready for P0.6.

### 2026-10-11 - Claude Sonnet 5.5 (P0.4)

- Task: Test fixture tree and generator script.
- Files changed: `testdata/fixtures/**`, `testdata/mkfixtures.sh`, `testdata/README.md`, `Makefile`, `.gitignore`.
- Result: Committed edge-case fixtures; `testdata/fixtures/generated/` (symlinks, ~6 MiB `large.md`) is created by an idempotent script with `--verify`. `make fixtures` runs it, and `test-go` depends on it. The generated dir replaces the `links/` name in `.gitignore`.
- Blockers or follow-up: None. Ready for P0.5.

### 2026-10-11 - Claude Sonnet 5.5 (P0.3)

- Task: Lint configs and per-tool `make lint-*` targets.
- Files changed: `.golangci.yml`, `.yamllint.yaml`, `.markdownlint-cli2.yaml`, `.hadolint.yaml`, `.shellcheckrc`, `Makefile`, `web/package.json`, `CONTRIBUTING.md`, plus fixes to existing Markdown, Go, and web formatting.
- Result: golangci-lint, hadolint, and shellcheck run from pinned Docker images as the host user with caches in `build/.cache/`. markdownlint-cli2 is a web devDependency. Docker and shell lint skip when no files exist. No lint rules disabled except MD013 (long table rows) and gosec in tests.
- Blockers or follow-up: None. Ready for P0.4.

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

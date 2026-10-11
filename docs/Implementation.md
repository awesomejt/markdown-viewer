# Implementation Plan

Phases map to the requirement priorities in [Requirements](./Requirements.md): **M** goes into MVP (Phase 1), **S** into Refinement (Phase 2), **C** into Future (Phase 3). Contracts the tasks build against (API, config, layout, routes) are in [Architecture](./Architecture.md). The live checklist is [TODO.md](../TODO.md).

## Research And Planning (complete)

 - [x] Requirements, tech stack, architecture, and decisions (2026-10-11)
 - [x] Go backend (D-5) and Docker Compose on a VM (D-11) confirmed
 - [x] API contract, config, repo layout, and routes finalized in [Architecture](./Architecture.md)
 - [x] Phased task breakdown with model tiers (this document)

## Multi-Agent Workflow And Model Tiers

The main session acts as **orchestrator** (Opus). It picks the next unblocked task, delegates it to a fresh-context subagent with the model tier listed for that task, reviews the result, and has it committed. Subagents start cold, so each delegation prompt must name the task ID and the exact files/sections to read (usually this document's task entry plus the relevant [Architecture](./Architecture.md) section). They should not re-read the whole repo.

| Tier | Model | Use for | Typical agent roles |
| --- | --- | --- | --- |
| **H** | Haiku | Deterministic, fully specified work: scaffolding from an exact spec, config/Docker files, running test/lint/build commands and reporting, committing, doc updates from verified behavior, small mechanical UI additions. | `implementer`, `tester`, `validator`, `committer`, `documentor` |
| **S** | Sonnet | Moderate work with a clear spec: feature implementation, unit/e2e tests, UI components, fixing review findings, per-task code review. | `coder`, `code-reviewer`, `tester` |
| **O** | Opus | Work needing judgment: design/contracts, security-critical code, concurrency design, phase reviews, debugging failures that resisted a Sonnet attempt, research synthesis. | orchestrator (main session), `designer`, `reviewer`, `coder` (security tasks) |

Rules of thumb:

- **Escalate, don't loop.** If a Haiku task fails validation twice, re-run it at Sonnet. If a Sonnet task fails twice, the orchestrator (Opus) diagnoses it before retrying.
- **Validate cheaply.** After each implementation task, a Haiku `tester`/`validator` runs `make check` (and `make e2e` when the UI changed) and reports pass/fail with output. Only failures return to a higher tier.
- **Review proportionately.** Tasks marked 🔒 get a Sonnet `code-reviewer` pass before merge. Every phase ends with an Opus review against requirements and the security model.
- **Commit in small, grouped changesets.** A Haiku `committer` commits each logical group (for example "config parsing + its tests", then "docs for config") as its own Conventional Commit with AI attribution. Avoid one large commit touching many unrelated files.
- **Batch tiny tasks.** Adjacent Haiku tasks with no dependency between them may go to one subagent call to save a cold start. They still get separate commits.
- **Keep the orchestrator lean.** Subagents return short summaries (what changed, validation result, open issues), not file dumps. The orchestrator does not re-read files a subagent already validated.

## Git Workflow (Per Task)

Every task follows branch → work → review → merge. Nothing is pushed to `origin` unless the owner asks.

1. **Pre-flight on `main`.** `git switch main`. Pull if a remote is reachable. Confirm the working tree is clean and that `git branch --no-merged main` is empty. Leftover unmerged branches or uncommitted changes mean an earlier task did not finish: **stop and report** rather than continuing.
2. **Branch.** `git switch -c <type>/<task-id>-<slug>`, for example `feat/b2-path-guard`, `fix/fix-3-sse-leak`, `docs/doc1-readme`, `chore/p0-2-makefile`. Types follow Conventional Commits.
3. **Work in grouped commits.** Code and its tests go in the same commit. Docs affected by the change are updated in the same branch, as their own commit when large.
4. **Quality gate (must all pass before merge).** `make check`, which includes:
   - all linters (Go, TypeScript, YAML, Markdown, Dockerfile, shell);
   - unit tests with coverage thresholds;
   - `make e2e` when UI or API behavior changed.

   🔒 tasks also need a clean Sonnet review.
5. **Record state.** The last commit on the branch updates `TODO.md` (task moved to Done with a one-line result) and `MEMORY.md` (run log, next task, any new decisions or blockers).
6. **Merge.** `git switch main && git merge --no-ff <branch>`. The `--no-ff` merge commit keeps each task's changes grouped in history.
7. **Validate the merge.** Run `make check` on `main` again. On success, delete the branch (`git branch -d`). On failure, revert the merge commit (`git revert -m 1 <merge>`), mark the task blocked in `TODO.md`, and stop.
8. **Reset context.** Start the next task from step 1 with a fresh subagent. See [Session Continuity](#session-continuity).

## Quality Gates And Tooling

| Area | Tool (pinned) | Config (YAML where the tool allows) |
| --- | --- | --- |
| Go lint + security | golangci-lint v2.14 (includes staticcheck, govet, gosec, errcheck), run via the `golangci/golangci-lint:v2.14.0` image | `.golangci.yml` |
| Go tests + coverage | `go test -race -coverprofile=build/coverage/go.out ./...` | Makefile threshold check |
| TS lint / format | ESLint 9 flat config, Prettier | `eslint.config.js` (flat config is JS-only), `.prettierrc.yaml` |
| TS types | `tsc --noEmit` | `tsconfig.json` (JSON required) |
| Web unit tests + coverage | Vitest 5 + `@vitest/coverage-v8` | `vite.config.ts` thresholds |
| YAML | yamllint 1.38 (installed locally) | `.yamllint.yaml` |
| Markdown | markdownlint-cli2 0.23 (web devDependency) | `.markdownlint-cli2.yaml` |
| Dockerfile | hadolint 2.15.1 via the `hadolint/hadolint:v2.15.1` image | `.hadolint.yaml` |
| Shell scripts | shellcheck 0.11 via the `koalaman/shellcheck:v0.11.0` image | `.shellcheckrc` |
| E2E | Playwright 1.64 | `playwright.config.ts` |

**Coverage targets** (enforced by `make check`):

- Go: ≥ 80% statements per `internal/` package, and ≥ 90% for `internal/fsroot` (security-critical).
- Web: ≥ 80% lines for `src/api`, `src/markdown`, and `src/diagrams`.

UI layout components are covered by Playwright rather than unit thresholds. Lowering a threshold requires a logged decision in `agents/Decisions.md`.

**Build artifacts** never enter Git. The Go binary, coverage, and test reports go to `build/` (ignored). The Vite bundle goes to `internal/web/dist/` (ignored except `.gitkeep`), because `go:embed` cannot reach outside its package directory.

**Config formats:** YAML is preferred for anything the project defines (app config, Compose, linter configs). JSON/JS/TS are used only where the tool requires them.

## Session Continuity

The orchestrator cannot clear its own context. Instead, each task runs in fresh subagents, and durable state is written before every merge (step 5). That way a `/clear`, compaction, or allocation stop loses nothing. To resume in a new session, use the prompt: *"Read AGENTS.md, MEMORY.md and TODO.md, then continue with the next task using the Git workflow in docs/Implementation.md."* The owner may run `/clear` between tasks to fully reset the orchestrator.

Each task entry below lists: ID, tier, role, dependencies, and acceptance criteria. Requirement IDs refer to [Requirements](./Requirements.md).

## Phase 0: Foundation

| ID | Tier | Role | Deps | Task / acceptance |
| --- | --- | --- | --- | --- |
| P0.1 | H | implementer | — | **Scaffold repo.** `go mod init github.com/awesomejt/markdown-viewer` (Go 1.27). Create the directory layout from Architecture with placeholder `doc.go` files. `cmd/mdv/main.go` prints the version. `internal/web/dist/.gitkeep`. Vite React-TS app in `web/` (React 19, TS, Vite 8) with `build.outDir` set to `../internal/web/dist` and `emptyOutDir` keeping `.gitkeep`. **Accept:** `go build ./...` and `npm --prefix web run build` succeed. `git status` shows no build output. |
| P0.2 | H | implementer | P0.1 | **Makefile.** All outputs go under `build/`. Targets: `web` (vite build), `build` (web, then `go build -o build/mdv ./cmd/mdv`), `test` (Go race + coverage to `build/coverage/`, then Vitest with coverage), `cover-check` (fail below the thresholds in Quality Gates), `lint` (see P0.3), `check` (lint + test + cover-check), `e2e`, `docker`, `run`, `clean`. **Accept:** `make build` and `make clean` work, and nothing outside `build/` and `internal/web/dist/` is produced. |
| P0.3 | H | implementer | P0.2 | **Lint configs + `make lint`** per Quality Gates: `.golangci.yml`, `.yamllint.yaml`, `.markdownlint-cli2.yaml`, `.prettierrc.yaml`, `eslint.config.js`, `.hadolint.yaml`, `.shellcheckrc`. Containerized tools are pinned by image tag in the Makefile. Fix any existing docs/YAML that fail. Document how to run the linters in `CONTRIBUTING.md`. **Accept:** `make check` passes on the scaffold, and a deliberately broken YAML file makes it fail. |
| P0.4 | H | implementer | P0.1 | **Fixture tree** in `testdata/fixtures/`: nested folders; `README.md`; docs with relative links, heading anchors, images, front matter, inline HTML including a `<script>`; Mermaid and D2 fenced blocks (one valid and one invalid of each); standalone `.mmd` and `.d2` files; a large file; a dot-folder; a symlink inside the root and one escaping it, created under `testdata/fixtures/links/` by `testdata/mkfixtures.sh` (ignored by Git, since Git symlinks are unreliable). **Accept:** the script is idempotent, shellcheck-clean, and documented in its header. |
| P0.5 | S | coder | P0.1 | **Spike: D2 library render.** A throwaway `cmd/spike-d2` renders a fenced sample with `github.com/d2lang/d2` v0.9.0 (`d2lib.Compile` + `d2svg.Render`, dagre, light and dark themes) to SVG under `build/`. Confirm the import paths and options and record them in `agents/Research.md`. **Accept:** SVGs produced. Notes record the exact API usage, binary size impact, and render time. The spike is deleted once B5 lands. |

## Phase 1: MVP

### Backend

| ID | Tier | Role | Deps | Task / acceptance |
| --- | --- | --- | --- | --- |
| B1 | H | implementer | P0.3 | **Config** (`internal/config`) exactly per the Architecture Configuration table: env, optional YAML, validation, fail-fast errors. **Accept:** table-driven tests cover defaults, overrides, the `:watch` suffix, invalid names, a missing root, and duplicates. |
| B2 🔒 | O | coder | B1, P0.4 | **Path guard** (`internal/fsroot`). `Resolve(root, rel)` returns the cleaned absolute path or a typed error. It rejects absolute paths, `..` segments after cleaning, NUL bytes, backslash tricks, and symlink targets outside the root (EvalSymlinks on the deepest existing ancestor). **Accept:** exhaustive table tests including encoded and edge cases. No other package touches `os` paths except through this. (FR-1.1, FR-1.10, NFR-4) |
| B3 | S | coder | B2 | **Listing + reads** (`internal/fsroot`). `List` and `Open` with `context` timeouts (`MDV_FS_TIMEOUT`; run the fs call in a goroutine and select on ctx). Kind classification, sorting, and symlink handling per the API contract. **Accept:** tests using the fixtures, plus a timeout test using a fake slow FS interface. (FR-1.2, FR-1.3, FR-1.9) |
| B4 🔒 | S | coder | B3 | **HTTP API core** (`internal/api`, `internal/web`). Routes `/healthz`, `/api/roots`, `/api/list`, `/api/file` per the contract. Error model. `ServeContent` with ETag. CSP and nosniff on svg/html. slog request logging and recover middleware. SPA embed with history fallback. Graceful shutdown in `main`. **Accept:** `httptest` coverage of every status code in the error model, plus traversal attempts through the HTTP layer. |
| B5 | S | coder | B4, P0.5 | **D2 render endpoint** (`internal/d2render`). Uses the spike's API usage. Light/dark theme, dagre. LRU cache keyed by sha256. Semaphore (`MDV_D2_CONCURRENCY`) and timeout. 422 with error text, 413 over 256 KiB. **Accept:** tests for valid/invalid source, a cache hit, and the timeout. (FR-4.2, FR-4.4, FR-4.8 partial) |
| B6 | S | coder | B4 | **Watch hub + SSE** (`internal/watch`, `/api/events`). Ref-counted subscriptions. Poller for `poll` roots, fsnotify for `fsnotify` roots (watching the parent dir for files). 250 ms coalescing, 25 s ping, cleanup on client disconnect. **Accept:** tests with a temp dir for both modes. No goroutine leaks (check with `goleak` or explicit counting). (FR-5.1, FR-5.3) |
| B7 | S | code-reviewer | B6 | **Review watch concurrency.** Look for races (`go test -race`), leaks, and shutdown ordering. The orchestrator escalates to Opus if findings are non-trivial. |

### Frontend

| ID | Tier | Role | Deps | Task / acceptance |
| --- | --- | --- | --- | --- |
| F1 | S | coder | P0.3, B4 | **App shell.** React Router routes per Architecture. Typed API client and TanStack Query hooks for roots/list/file. Layout with a sidebar that becomes a drawer below 900 px. 44 px touch targets. Theme (OS default plus manual override, persisted in localStorage). Error and loading states mapped from the error model. (FR-3.8, FR-6.1, FR-6.2, NFR-2) |
| F2 | S | coder | F1 | **Browse views.** Root list, folder listing (name/size/mtime, kind icons), breadcrumbs, name filter, "Markdown/diagrams only" toggle, "Open as workspace" action, README/index auto-open for workspaces. (FR-1.2, FR-1.3, FR-1.6, FR-1.7, FR-2.1, FR-2.2) |
| F3 🔒 | S | coder | F1 | **Markdown pipeline** (`web/src/markdown`). react-markdown + remark-gfm + remark-frontmatter (hidden) + rehype-raw + rehype-sanitize (default GitHub schema, plus `id` on headings and `class` on code) + rehype-slug + Shiki (lazy-loaded languages, light/dark). Link/image rewriting per the Architecture rules. Anchor scroll on load and hashchange. **Accept:** Vitest tests for rewriting (relative, `../`, escaping, external), sanitizing (script, `onerror`, iframe removed), slugs, and front matter hidden. (FR-2.3, FR-2.4, FR-3.1 to FR-3.5) |
| F4 | S | coder | F3, B5 | **Diagram components.** The `mermaid` code block lazy-imports mermaid, renders with `securityLevel: 'strict'` and theme-aware settings, and catches errors (error box + source). The `d2` code block POSTs to `/api/render/d2` with the current theme and inserts the SVG via sanitized DOM or `<img src=blob:>`, with an error box + source on 422. Standalone `.mmd`/`.mermaid`/`.d2` files render full page. (FR-4.1 to FR-4.4) |
| F5 | S | coder | F2, F3 | **Workspace + file views.** Lazy-loading sidebar tree anchored at `?ws=`, which survives navigation within the workspace. File view by kind: Markdown, diagram, image (inline), text (monospace; highlighting is S-phase), other (download link). (FR-1.5, FR-2.1) |
| F6 | S | coder | F5, B6 | **Live reload client.** An EventSource per viewed file/folder, reconnecting. On `change`, invalidate the query and re-render while keeping the scroll position (nearest-heading strategy). Folder views refresh listings. (FR-5.1) |

### Packaging, Tests, Review

| ID | Tier | Role | Deps | Task / acceptance |
| --- | --- | --- | --- | --- |
| EX1 | H | implementer | F4 | **Example Markdown set** in `examples/` for manual testing and demos (separate from the edge-case test fixtures): a GFM feature tour, several Mermaid diagram types (flowchart, sequence, class, state, gantt), several D2 diagrams (basic, containers, sql_table, sequence), a nested folder with `README.md` and cross-links, images, front matter, and an intentionally broken diagram of each kind. Markdownlint-clean except for the intentional cases, which are excluded in the config. **Accept:** every file renders in `make run` (default root `examples`) and is listed in `examples/README.md`. |
| D1 | H | implementer | B4, F1 | **Dockerfile + compose.yaml + .dockerignore** exactly per [Tech Stack: Deployment](./Tech-Stack.md#deployment). Multi-stage, static binary, non-root user (`user:` overridable), healthcheck on `/healthz`, `:ro` bind-mount example (`./examples` for local runs), `restart: unless-stopped`. **Accept:** hadolint and yamllint are clean. `docker compose build` and `up` serve the examples. The healthcheck goes healthy. |
| T1 | S | tester | F6, D1, EX1 | **Playwright e2e** against the built binary and fixtures. Projects: chromium, firefox, webkit, plus an iPad viewport (WebKit device descriptor). Scenarios: browse, then workspace, then follow a relative link and an anchor. Mermaid and D2 render, and invalid diagrams show errors. Script injection is not executed. Traversal URLs return 403/404. Live reload updates after a file write. **Accept:** `make e2e` is green on all projects. |
| T2 | H | validator | T1 | **Full validation run:** `make check`, `go test -race ./...`, `make e2e`, `docker compose build`. Report results with output. |
| R1 | O | reviewer | T2 | **MVP phase review** against Success Criteria 1 to 5 and the Security Model (path guard, sanitize, SVG/HTML isolation, SSE resource limits). Log defects to TODO as `FIX-n` with a tier. |
| DOC1 | H | documentor | R1 | **README:** quick start (local `make run`), Compose deployment (VM NAS mount, then bind mount, then `MDV_ROOTS`), the config table, and the LAN-only warning. |
| V1 | Human | owner | DOC1 | **Deploy on the VM and run the manual iPad checklist:** browse a NAS folder, open a workspace, check diagrams in light/dark, change a file on the NAS and see the reload within the poll interval, rotate the device, add to the home screen. |

## Phase 2: Refinement (S priorities)

| ID | Tier | Role | Task (requirement) |
| --- | --- | --- | --- |
| R2.1 | H | implementer | Hidden-files toggle; sort by name/date (FR-1.4, FR-1.2) |
| R2.2 | H | implementer | Copy-code button; front-matter metadata panel (FR-3.2, FR-3.4) |
| R2.3 | H | implementer | Recent files/folders in localStorage (FR-2.6) |
| R2.4 | H | implementer | Web-app manifest, icons, and Apple meta tags for the home screen (FR-6.3) |
| R2.5 | H | implementer | Syntax highlighting for standalone text/code files, reusing Shiki (FR-1.5) |
| R2.6 | S | coder | Table of contents panel (FR-2.5) |
| R2.7 | S | coder | KaTeX math; GitHub alerts (FR-3.6, FR-3.7) |
| R2.8 | S | coder | Diagram source toggle, pan/zoom, full-screen view, iPad pinch (FR-4.6, FR-4.7) |
| R2.9 | S | coder | D2 ELK layout option; diagrams re-render on theme change (FR-4.5, FR-4.9) |
| R2.10 | S | coder | Workspace tree live updates on create/delete/rename (FR-5.2) |
| R2.11 | S | coder | Virtualized long listings; large-file warning with `force=1` (NFR-3) |
| R2.12 | H | validator | Full validation run (as T2) |
| R2.13 | O | reviewer | Phase review; performance check on iPad against NFR-3 |

## Phase 3: Future (C priorities)

| ID | Tier | Role | Task (requirement) |
| --- | --- | --- | --- |
| FUT1 | O | designer | Design full-text search (index vs. on-demand grep over NAS, memory limits), then hand implementation to S (FR-1.8) |
| FUT2 | S | coder | Server-side pinned favourites (FR-2.7). Note: introduces the first write path, a small JSON state file in a volume, not in roots. |
| FUT3 | S | coder | Print view / HTML export; diagram SVG/PNG download (FR-3.9, FR-4.10) |
| FUT4 | O | researcher | Voice-over conventions research (Fountain, SSML, CriticMarkup, `remark-directive`). Propose syntax for VO-1 to VO-8 for the owner to choose from |
| FUT5 | S | coder | Implement the chosen VO extensions as remark/rehype plugins (per FUT4 decisions) |
| FUT6 | O | designer | Desktop wrapper decision (Wails v3 status vs. Electron vs. none) (D-9) |

## Deployment

The target is Docker Compose on the VM (D-11). Release steps are documented in DOC1 and validated in V1. Image tags follow SemVer from git tags. A registry is not required, since the VM can build from the repo checkout.

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
| **H** | Haiku | Simple, mechanical operations: Git management (pre-flight checks, branching, staging, commits, merges, branch cleanup) and running tools (build, lint, tests, coverage, Docker builds) and reporting their exact output. **No authoring of code, tests, configs, or docs.** | `git-committer`, `committer`, `tester`, `validator` |
| **S** | Sonnet | All authoring: coding (including security-sensitive code), tests, configs, Dockerfiles, docs, research, planning/design, per-task code review, and fixes from review findings. | `coder`, `implementer`, `code-reviewer`, `researcher`, `planner`, `designer`, `documentor` |
| **O** | Opus | Big reviews (🔒 security reviews, phase reviews), debates and challenges of designs and plans, and escalations (diagnosing failures a Sonnet attempt could not fix). The main session (orchestrator) also runs at Opus and independently verifies every handoff before merge. | orchestrator, `reviewer`, `debater` |

Rules of thumb:

- **Escalate, don't loop.** If a Sonnet task fails validation twice, escalate to Opus to diagnose before retrying. If a Haiku operation reports something inconsistent, the orchestrator re-runs it rather than trusting the report.
- **Validate cheaply, verify independently.** After each authoring task, a Haiku `validator` runs `make check` (and `make e2e` when UI/API behavior changed) and pastes the exact output. The orchestrator spot-checks the result (exit codes, step ordering, versions) before merging.
- **Review proportionately.** Tasks marked 🔒 get an Opus `reviewer` pass before merge. Other code tasks get a Sonnet `code-reviewer` pass when the diff is non-trivial. Every phase ends with an Opus review against requirements and the security model.
- **Challenge designs before building.** Design and plan outputs (API contract, search design, voice-over syntax, desktop decision) get an Opus `debater` pass before implementation starts.
- **Commit in small, grouped changesets.** A Haiku `committer` (or the authoring agent) commits each logical group (for example "config parsing + its tests", then "docs for config") as its own Conventional Commit with AI attribution. Avoid one large commit touching many unrelated files.
- **Batch tiny tasks.** Small adjacent tasks with no dependency between them may share one subagent call to save a cold start. They still get separate commits.
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
5. **Record state.** The last commit on the branch updates `TODO.md` (task moved to Done with a one-line result) and `MEMORY.md` (run log, next task, any new decisions or blockers). `MEMORY.md` keeps only the last three run log entries; older ones move to `agents/Memory-History.md`, with still-open follow-ups carried into "Known Limitations And Accepted Risks".
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
| E2E | Playwright 1.64.0, run via the `mcr.microsoft.com/playwright:v1.64.0-noble` image (`make e2e`); `e2e/` is linted by `make lint-e2e` | `e2e/playwright.config.ts` |
| Performance (opt-in) | Same Playwright image, `make perf` (not in `make check` or `make e2e`): NFR-3 doc-render and 10k-listing timings on chromium and the iPad Pro 11 emulation. Fixtures are generated into `build/perf/`; per-run results go to `build/perf/results.jsonl` and a median summary prints at the end | `e2e/perf/playwright.config.ts` |

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
| P0.1 | H→S | implementer | — | **Scaffold repo.** `go mod init github.com/awesomejt/markdown-viewer` (Go 1.27). Create the directory layout from Architecture with placeholder `doc.go` files. `cmd/mdv/main.go` prints the version. `internal/web/dist/.gitkeep`. Vite React-TS app in `web/` (React 19, TS, Vite 8) with `build.outDir` set to `../internal/web/dist` and `emptyOutDir` keeping `.gitkeep`. **Accept:** `go build ./...` and `npm --prefix web run build` succeed. `git status` shows no build output. |
| P0.2 | H→S | implementer | P0.1 | **Makefile.** All outputs go under `build/`. Targets: `web` (vite build), `build` (web, then `go build -o build/mdv ./cmd/mdv`), `test` (Go race + coverage to `build/coverage/`, then Vitest with coverage), `cover-check` (fail below the thresholds in Quality Gates), `lint` (see P0.3), `check` (lint + test + cover-check), `e2e`, `docker`, `run`, `clean`. **Accept:** `make build` and `make clean` work, and nothing outside `build/` and `internal/web/dist/` is produced. |
| P0.3 | S | implementer | P0.2 | **Lint configs + `make lint`** per Quality Gates: `.golangci.yml`, `.yamllint.yaml`, `.markdownlint-cli2.yaml`, `.prettierrc.yaml`, `eslint.config.js`, `.hadolint.yaml`, `.shellcheckrc`. Containerized tools are pinned by image tag in the Makefile. Fix any existing docs/YAML that fail. Document how to run the linters in `CONTRIBUTING.md`. **Accept:** `make check` passes on the scaffold, and a deliberately broken YAML file makes it fail. |
| P0.4 | S | implementer | P0.1 | **Fixture tree** in `testdata/fixtures/`: nested folders; `README.md`; docs with relative links, heading anchors, images, front matter, inline HTML including a `<script>`; Mermaid and D2 fenced blocks (one valid and one invalid of each); standalone `.mmd` and `.d2` files; a large file; a dot-folder; a symlink inside the root and one escaping it, created under `testdata/fixtures/links/` by `testdata/mkfixtures.sh` (ignored by Git, since Git symlinks are unreliable). **Accept:** the script is idempotent, shellcheck-clean, and documented in its header. |
| P0.5 | S | coder | P0.1 | **Spike: D2 library render.** A throwaway `cmd/spike-d2` renders a fenced sample with `github.com/d2lang/d2` v0.9.0 (`d2lib.Compile` + `d2svg.Render`, dagre, light and dark themes) to SVG under `build/`. Confirm the import paths and options and record them in `agents/Research.md`. **Accept:** SVGs produced. Notes record the exact API usage, binary size impact, and render time. The spike is deleted once B5 lands. |
| P0.6 | O | debater | P0.5 | **Challenge the plan before MVP coding.** Stress-test the [Architecture](./Architecture.md) API contract, watch semantics, security model, and Phase 1 task split for gaps, wrong assumptions (Safari, NAS polling, D2 render cost), and missing tests. Output a ranked list of changes. The orchestrator applies the accepted ones (via Sonnet) before B1. **Done:** 15 findings applied (D-19). |

## Phase 1: MVP

### Backend

| ID | Tier | Role | Deps | Task / acceptance |
| --- | --- | --- | --- | --- |
| B1 | S | coder | P0.3, P0.6 | **Config** (`internal/config`) exactly per the Architecture Configuration table: environment variables only (no config file, D-20), validation, fail-fast errors. **Accept:** table-driven tests cover defaults, overrides (including `MDV_FS_MAX_INFLIGHT` and `MDV_MAX_LIST_ENTRIES`), the `:watch` suffix, invalid names, a missing root, and duplicates. |
| B2 🔒 | S | coder | B1, P0.4 | **Path guard** (`internal/fsroot`) built on Go `os.Root`: `OpenRoot`, then `Open`/`Stat`/`Lstat`/`ReadDir` via the root. `Resolve(rel)` is a lexical precheck returning a typed `*PathError` (Kind 400/403/404/500, `PublicMessage()` for clients). It rejects (400) NUL and control/bidi characters, absolute paths, backslashes, drive letters, invalid UTF-8, paths over 4096 bytes, and any raw `..` segment. Escapes are detected from `os.Root`'s own error (fail-closed to 500 if Go changes it, pinned by a test), so `Readlink` is not needed. `Open` uses `O_NONBLOCK` + fstat and refuses non-regular files (403). **Accept:** exhaustive table tests including encoded and edge cases. No other package touches `os` paths except through this. (FR-1.1, FR-1.10, NFR-4) |
| B3 | S | coder | B2 | **Listing + reads** (`internal/fsroot`). `List` and `Open` with `context` timeouts (`MDV_FS_TIMEOUT`; run the fs call in a goroutine and select on ctx). Per-root in-flight cap (`MDV_FS_MAX_INFLIGHT`): when full, an immediate 504 `fs_timeout`. After a timeout the root is `unavailable` and recovery is probed with one outstanding stat at a time (`/api/roots` reports `available`). `MDV_MAX_LIST_ENTRIES` cap with `truncated`. On not-found, retry the NFC/NFD alternate path form. Kind classification, sorting, and symlink handling per the API contract. **Accept:** tests using the fixtures; a timeout test using a fake slow FS interface; a fake FS that blocks forever shows a bounded goroutine count after N requests. Add an NFD-named fixture via `mkfixtures.sh` (P0.4 follow-up). (FR-1.2, FR-1.3, FR-1.9) |
| B4a 🔒 | S | coder | B3 | **HTTP API core** (`internal/api`). Routes `/healthz` (never touches roots), `/api/roots`, `/api/list`, `/api/file` per the contract. Error model. `ServeContent` with ETag `mtimeNs-size-ino` and `Cache-Control: no-cache`. Allowlist file serving per the Architecture File Serving table, with nosniff and the sandbox CSP on every `/api/file` response. slog request logging and recover middleware. **Accept:** `httptest` coverage of every status code in the error model, traversal attempts through the HTTP layer, and file-serving cases for `.xhtml`, `.htm`, `.xml`, `.svg`, `.html`. |
| B4b | S | coder | B4a | **SPA embed and lifecycle** (`internal/web`, `cmd/mdv`). Embedded SPA with history fallback: misses under `/assets/` and `/api/` return 404, never `index.html`. `index.html` is `Cache-Control: no-cache`; hashed assets are `public, max-age=31536000, immutable`. Graceful shutdown in `main`. `mdv healthcheck` subcommand (used by the Compose healthcheck; distroless has no curl). **Accept:** tests for the fallback and caching headers, `/assets/missing.js` and `/api/nope` giving 404, and the healthcheck exit codes. |
| B5 | S | coder | B4a, P0.5 | **D2 render endpoint** (`internal/d2render`). Uses the spike's API usage. Light/dark theme, dagre. Compiles with an explicit empty `fs.FS` (verify how D2 v0.9.0 exposes FS in `CompileOptions`). LRU cache keyed by sha256, caching compile errors and timeouts too. Semaphore (`MDV_D2_CONCURRENCY`) slot held until the render goroutine actually returns (dagre ignores ctx); wait at most 1 s for a slot, else 503 `busy`; render timeout gives 504 `render_timeout`. 256 KiB limit via `http.MaxBytesReader` before JSON decode (413). 422 with error text. No `Cache-Control` on the POST response. **Accept:** tests for valid/invalid source, a cache hit (including a negative-cache hit), the timeout, busy, and that `@../../etc/passwd` and other imports fail. (FR-4.2, FR-4.4, FR-4.8 partial) |
| B6 | S | coder | B4a | **Watch hub + SSE** (`internal/watch`, `/api/events?sub=<root>:<path>`, repeatable, max 32 per stream else 400). Ref-counted subscriptions. Poller for `poll` roots: directories poll one `ReadDir` name set plus the directory's own mtime (no per-child stat); files poll size + mtime (ns) + inode; skip a path whose previous stat is still pending. fsnotify for `fsnotify` roots (watching the parent dir for files). 250 ms coalescing, 25 s ping, per-stream `http.ResponseController` clearing the write deadline, flush after each event, cleanup on client disconnect. **Accept:** tests with a temp dir for both modes. No goroutine leaks (check with `goleak` or explicit counting), including a fake FS that blocks forever (bounded goroutines after N polls). (FR-5.1, FR-5.3) |
| B7 | S | code-reviewer | B6 | **Review watch concurrency.** Look for races (`go test -race`), leaks, and shutdown ordering. The orchestrator escalates to Opus if findings are non-trivial. |

### Frontend

Each F-task from F1 on also adds its own Playwright e2e scenario (on the T0 scaffold) and keeps `make e2e` green.

| ID | Tier | Role | Deps | Task / acceptance |
| --- | --- | --- | --- | --- |
| F1 | S | coder | P0.3, B4a | **App shell.** React Router routes per Architecture. Typed API client (each path segment encoded with `encodeURIComponent`) and TanStack Query hooks for roots/list/file. Layout with a sidebar that becomes a drawer below 900 px. 44 px touch targets. Theme (OS default plus manual override, persisted in localStorage). Error and loading states mapped from the error model. Handle `vite:preloadError` by reloading once. (FR-3.8, FR-6.1, FR-6.2, NFR-2) |
| F2 | S | coder | F1 | **Browse views.** Root list, folder listing (name/size/mtime, kind icons), breadcrumbs, name filter, "Markdown/diagrams only" toggle, "Open as workspace" action, README/index auto-open for workspaces. (FR-1.2, FR-1.3, FR-1.6, FR-1.7, FR-2.1, FR-2.2) |
| F3 🔒 | S | coder | F1 | **Markdown pipeline** (`web/src/markdown`). react-markdown with this exact plugin order: remark-gfm, remark-frontmatter (hidden), rehype-raw, rehype-sanitize (default GitHub schema; allows a `language-*` class on `code`), rehype-slug. Mermaid/D2 blocks are detected in `code` components after sanitize. Link/image rewriting per the Architecture rules (drops `ws` for targets outside the workspace folder). Anchor scroll on load and hashchange. **Accept:** Vitest tests for rewriting (relative, `../`, escaping, external, `ws` dropped outside the workspace), sanitizing (script, `onerror`, iframe removed), slugs, front matter hidden, `[x](#heading)` resolving, and raw-HTML `id` staying `user-content-` prefixed. (FR-2.3, FR-2.4, FR-3.1 to FR-3.5) |
| F3b | S | coder | F3 | **Syntax highlighting.** Shiki as the final pipeline step, with lazy-loaded languages and light/dark themes. **Accept:** tests that highlighted output stays sanitized, an unknown language falls back to plain text, and languages load on demand. (FR-3.3) |
| F4 | S | coder | F3, B5 | **Diagram components.** The `mermaid` code block lazy-imports mermaid, renders with `securityLevel: 'strict'` and theme-aware settings, and catches errors (error box + source). The `d2` code block POSTs to `/api/render/d2` with the current theme and inserts the SVG via sanitized DOM or `<img src=blob:>`, with an error box + source on 422. Standalone `.mmd`/`.mermaid`/`.d2` files render full page. (FR-4.1 to FR-4.4) |
| F5 | S | coder | F2, F3 | **Workspace + file views.** Lazy-loading sidebar tree anchored at `?ws=`, which survives navigation within the workspace. File view by kind: Markdown, diagram, image (inline), text (monospace; highlighting is S-phase), other (download link). Files over `MDV_MAX_FILE_BYTES` show a minimal "File is X MB, load anyway" button that refetches with `force=1` (D-21). (FR-1.5, FR-2.1, NFR-3) |
| F6 | S | coder | F5, B6 | **Live reload client.** One EventSource per tab using `/api/events?sub=<root>:<path>` (repeatable); the stream is reopened when the subscription set changes. Reconnects. On `visibilitychange` to visible and on each EventSource `open`, invalidate active queries. On `change`, invalidate the query and re-render while keeping the scroll position (nearest-heading strategy). Folder views refresh listings. **Accept:** e2e with 3 tabs open while API fetches still succeed (the T1 scenario). (FR-5.1) |

### Packaging, Tests, Review

| ID | Tier | Role | Deps | Task / acceptance |
| --- | --- | --- | --- | --- |
| T0 | S | tester | F1 | **Playwright scaffold + smoke test.** `e2e/` with `playwright.config.ts` (chromium), a webServer running the built binary against the fixtures, and one smoke test (root list loads). `make e2e` is real from here on, and every F-task adds its own scenario. **Accept:** `make e2e` runs the smoke test green. |
| EX1 | S | implementer | F4 | **Example Markdown set** in `examples/` for manual testing and demos (separate from the edge-case test fixtures): a GFM feature tour, several Mermaid diagram types (flowchart, sequence, class, state, gantt), several D2 diagrams (basic, containers, sql_table, sequence), a nested folder with `README.md` and cross-links, images, front matter, and an intentionally broken diagram of each kind. Markdownlint-clean except for the intentional cases, which are excluded in the config. **Accept:** every file renders in `make run` (default root `examples`) and is listed in `examples/README.md`. |
| D1 | S | implementer | B4b, F1 | **Dockerfile + compose.yaml + .dockerignore** exactly per [Tech Stack: Deployment](./Tech-Stack.md#deployment). Multi-stage, static binary, non-root user, healthcheck running `mdv healthcheck` (distroless has no curl), `:ro` bind-mount example (`./examples` for local runs), `restart: unless-stopped`. Compose hardening: `read_only: true`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, and `user:` defaulting to a documented UID:GID matching the NAS mount's `uid=`/`gid=` options. All config is env vars in `compose.yaml`. **Accept:** hadolint and yamllint are clean. `docker compose build` and `up` serve the examples. The healthcheck goes healthy. |
| T1 | S | tester | T0, F6, D1, EX1 | **Complete the cross-browser e2e suite + iPad viewport** on the T0 scaffold, against the built binary and fixtures. Projects: chromium, firefox, webkit, plus an iPad viewport (WebKit device descriptor). Scenarios: browse, then workspace, then follow a relative link and an anchor. Mermaid and D2 render, and invalid diagrams show errors. Script injection is not executed. Traversal URLs return 403/404. Live reload updates after a file write. **Accept:** `make e2e` is green on all projects. |
| T2 | H | validator | T1 | **Full validation run:** `make check`, `go test -race ./...`, `make e2e`, `docker compose build`. Report results with output. |
| R1 | O | reviewer | T2 | **MVP phase review** against Success Criteria 1 to 5 and the Security Model (path guard, sanitize, SVG/HTML isolation, SSE resource limits). Log defects to TODO as `FIX-n` with a tier. |
| DOC1 | S | documentor | R1 | **README:** quick start (local `make run`), Compose deployment (VM NAS mount, then bind mount, then `MDV_ROOTS`), the config table, and the LAN-only warning. Document NAS attribute caching (CIFS `actimeo`, NFS `acdirmax`) and recommend low values for live reload. |
| V1 | Human | owner | DOC1 | **Deploy on the VM and run the manual iPad checklist:** browse a NAS folder, open a workspace, check diagrams in light/dark, change a file on the NAS and see the reload within the poll interval, rotate the device, add to the home screen. |

## Phase 2: Refinement (S priorities)

| ID | Tier | Role | Task (requirement) |
| --- | --- | --- | --- |
| R2.1 | S | coder | Hidden-files toggle (FR-1.4); date sort moved to FIX-11 in Phase 1 (D-26) |
| R2.2 | S | coder | Copy-code button; front-matter metadata panel (FR-3.2, FR-3.4) |
| R2.3 | S | coder | Recent files/folders in localStorage (FR-2.6) |
| R2.4 | S | coder | Web-app manifest, icons, and Apple meta tags for the home screen (FR-6.3) |
| R2.5 | S | coder | Syntax highlighting for standalone text/code files, reusing Shiki (FR-1.5) |
| R2.6 | S | coder | Table of contents panel (FR-2.5) |
| R2.7 | S | coder | KaTeX math; GitHub alerts (FR-3.6, FR-3.7) |
| R2.8 | S | coder | Diagram source toggle, pan/zoom, full-screen view, iPad pinch (FR-4.6, FR-4.7) |
| R2.9 | S | coder | D2 ELK layout option; diagrams re-render on theme change (FR-4.5, FR-4.9) |
| R2.10 | S | coder | Workspace tree live updates on create/delete/rename (FR-5.2) |
| R2.11 | S | coder | Virtualized long listings (NFR-3). The minimal large-file load button ships in F5 (D-21). |
| R2.12 | H | validator | Full validation run (as T2) |
| R2.13 | O | reviewer | Phase review; performance check on iPad against NFR-3 |

## Phase 2b: Projects And Display Settings (S priorities)

Owner request after the docker2 deployment (D-30). Requirements FR-2.8, FR-7, FR-8; contract in [Architecture](./Architecture.md#projects-and-settings-phase-2b-contract). Each task adds Go/unit/e2e tests for the behavior it adds.

| ID | Tier | Role | Deps | Task (requirement) |
| --- | --- | --- | --- | --- |
| FV1 | S | coder | none | Workspace tree honours the "Markdown and diagrams only" toggle (FR-2.1 says filtered by default; `treeEntries` passes `mdOnly: false` today). |
| FV2 | S | coder | FV1 | Sibling files: a file opened outside a workspace or project shows its folder's supported files in the sidebar (FR-2.8). |
| PJ0 | S → O | designer, debater | none | **Done 2026-10-14.** Final contract in [Architecture](./Architecture.md#projects-and-settings-phase-2b-contract) and D-33 (Opus challenge applied). |
| PJ1 🔒 | S | coder | PJ0 | `internal/settings`: add `go.yaml.in/yaml/v3` v3.0.4; Node-walk parser for project and preferences; pre-check (aliases, anchors, tags, merge keys, depth 8, 2000 nodes, one document); 32 KiB cap, 4-slot parse semaphore; `ParseError` with optional clamped line; message sanitizer; recover all panics; warnings and codes; `errorDetail.line`. Tests: hostile YAML table, reader-error host-path leak, syntax-error line per class, `FuzzParseProject`/`FuzzParsePrefs`, empty/comment-only prefs valid and empty project fatal (FR-7.1, FR-7.7, FR-8.1). |
| PJ2 | S | coder | PJ1 | `MDV_PREFS` (absolute path) + `GET /api/prefs` (always 200, state table, per-request parse, `O_NONBLOCK` regular-file check, single outstanding read, hash-deduplicated logs); Compose bind of `./config` (read-only) and `.env` passthrough (FR-8.2). Tests: each state, FIFO does not block, hung read serves last result. |
| PJ3 🔒 | S | coder | PJ1 | `GET /api/project`: reference resolution through `fsroot` with the per-Handle stat limiter, singleflight keyed on content hash with poll-interval TTL, `2 x FS timeout` deadline, total Kind-to-warning table, `project` kind (`.mdv.yaml`/`.mdv.yml`) in `ClassifyName`; client kind plumbing (`EntryKind`, `fileKind`, `KindIcon`, text view, md-only keeps projects) (FR-7.1, FR-7.3, FR-7.5, FR-7.7). Tests: concurrency bound with a blocking fake FS (`/api/file` still gets a slot), a row per Kind, `..notes.md` valid, one-letter root `c:foo` is cross-root, kind fallback fails without the plumbing. |
| PJ4a | S | coder | PJ2 | Client settings core: pure `resolveSettings`, device stores (`undefined` = no choice), one-time migration (`mdv-settings-v=2`), theme `<select>` with `Default (...)`, `useApplySettings` CSS variables and `data-*` attributes, prefs banner (errors and warnings), first-paint hold (300 ms) and `mdv-prefs-cache` boot step (FR-8.1, FR-8.3, FR-8.5). Tests: precedence and leave-project as table tests, migration of each stored value and idempotence. |
| PJ4b | S | coder | PJ4a | Device text scale: `mdv-text-scale` store, A−/percent/A+ buttons, Ctrl/Cmd `+`/`−`/`0` handler (FR-8.4). Tests: key handling (modifiers, inputs, `preventDefault`), clamping. |
| PJ5a | S | coder | PJ3, PJ4a, FV1 | `?project=` routing and `NavScope` (stay in project within the root, explicit exits, `ws` exclusion), `ProjectProvider`/`useProject`, entering and switching projects, project home and `?source=1`, initial-load error states and "Close project", outlet hold (FR-7.2). Tests: switching projects does not leak settings, no redirect loop (`open`, included project file), dead `?project=` offers Close project. |
| PJ5b | S | coder | PJ5a, PJ4b | Project sidebar tree (shared row renderer), warnings panel with Re-check, live reload of the project file, keep last good (422 error line, stale on 504, 404 error state), per-project device choices (`mdv-project-device`) and the one Reset control, "not part of the project" note (FR-7.3, FR-7.4, FR-8.5). Tests: per-project choice isolation, keep-last-good transitions. |
| PJ6 | S | coder | PJ5b | "Projects only" filter, project icon polish, "Recent projects" in the sidebar and `project` on recents (FR-7.5, FR-7.6). |
| PJ7 | S | documentor | PJ6 | README and Deployment (preferences file, project format), example project in `examples/` with a missing folder, a file where a folder is expected, enough `../` to really leave the root, an `other-root:` item, an unknown key and a bad `fontSize`. |
| PJ8 | H | validator | PJ7 | Full validation run (as R2.12) plus deploy to docker2. |
| PJ9 | O | reviewer | PJ8 | Phase 2b review, including hostile project files and iPad keyboard/size behavior. |

## Phase 2c: Reading Experience (S priorities)

Owner request (D-31). Requirements FR-9; draft in [Architecture](./Architecture.md#reading-experience-planned-phase-2c). RT1 and FM1 can start before Phase 2b ends; the settings wiring of each lands with PJ4.

| ID | Tier | Role | Deps | Task (requirement) |
| --- | --- | --- | --- | --- |
| RX0 | S | researcher | none | Survey Typora themes, Obsidian and VS Code Markdown preview extensions (built-in preview, Markdown Preview Enhanced, GitHub-styled preview, read-time extensions). Propose 3-4 mdv styles and an OFL font shortlist (sans, serif, mono, plus a high-legibility font such as Atkinson Hyperlegible for script reading) with woff2 sizes. Owner picks. |
| RT1 | S | coder | none | Read-time estimate: mdast word count with `Intl.Segmenter`, exclusions, header line (words + minutes); defaults wpm 160, headings and code excluded (FR-9.6). |
| RT2 | S | coder | RT1, PJ4a | Per-section times in the TOC; `readTime` settings (`wpm`, `includeHeadings`, `includeCode`) from preferences and project layers (FR-9.7, FR-9.8). |
| FM1 | S | coder | none | Focus mode: `data-focus`, toolbar toggle, shortcut, `?focus=1`, Esc/exit control, block tools hidden, live reload and scroll kept (FR-9.4). |
| FM2 | S | coder | FM1 | Screen Wake Lock and optional full screen, with feature detection; checked on iPad (FR-9.5). |
| DS1 | S | coder | RX0, PJ4a | Bundled fonts (`@font-face`, subsets, OFL files, cache headers) and font categories for `font`/`codeFont` (FR-9.2, FR-9.3, NFR-10). |
| DS2 | S | coder | DS1 | Reading styles as token CSS (`data-style`), light/dark variants; current look kept as `github` (FR-9.1). |
| RX1 | H | validator | DS2, RT2, FM2 | Full validation run plus deploy to docker2. |
| RX2 | O | reviewer | RX1 | Phase 2c review, including iPad focus mode during a long read, font payload size and offline behavior. |

## Phase 3: Future (C priorities)

| ID | Tier | Role | Task (requirement) |
| --- | --- | --- | --- |
| FUT1 | S | designer | Design full-text search (index vs. on-demand grep over NAS, memory limits), then an Opus debate, then Sonnet implementation (FR-1.8) |
| FUT2 | S | coder | Superseded by project files (Phase 2b, D-30). Was: server-side pinned favourites (FR-2.7), the first write path. |
| FUT3 | S | coder | Print view / HTML export; diagram SVG/PNG download (FR-3.9, FR-4.10) |
| FUT4 | S | researcher | Voice-over conventions research (Fountain, SSML, CriticMarkup, `remark-directive`). Propose syntax for VO-1 to VO-8. Opus debate, then the owner chooses |
| FUT5 | S | coder | Implement the chosen VO extensions as remark/rehype plugins (per FUT4 decisions) |
| FUT6 | S | researcher | Desktop wrapper research (Wails v3 status vs. Electron vs. none), then an Opus debate and an owner decision (D-9) |
| FUT7 | S | coder | Cross-root project references `<root>:<path>` (FR-7.8). `?project=` already carries the root; the project sidebar and `scopeWs`-style scoping must span roots. |
| FUT8 | S | designer | Project save: write device adjustments back to a project file (FR-7.9). The first write path; needs a design and Opus debate (roots are mounted read-only today). |
| FUT9 | S | coder | Teleprompter mode (VO-5), deps FM2 and RT2: auto-scroll at the read-time `wpm` along counted word positions, live speed adjustment, Space play/pause, wheel/touch to move forward or back. Checked on iPad. |

## Deployment

The target is Docker Compose on the VM (D-11). Release steps are documented in DOC1 and validated in V1. Image tags follow SemVer from git tags. A registry is not required, since the VM can build from the repo checkout.

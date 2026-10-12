# Project Memory

Persistent project memory for this repository.

Agents should update this file after meaningful decisions, milestones, blockers, research findings, or workflow changes. Keep entries short and durable; do not paste full chat transcripts here.

## Current Status

- Current phase: Phase 1 MVP
- Last major milestone: FIX-11 date sort merged (2026-10-12)
- Next recommended task: FIX-15 [S] drawer flake (FIX-17 optional), then DOC1
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
- Host has go 1.27.1, node 24, docker, yamllint. golangci-lint/hadolint/shellcheck and Playwright (`mcr.microsoft.com/playwright:v1.64.0-noble`) run via Docker images; markdownlint-cli2 via npm. No host browsers: the image tag must match `@playwright/test` in `e2e/package.json`.

- Since FIX-10, every e2e spec must import `test`/`expect` from `e2e/tests/fixtures.ts` (offline guard).
- Since FIX-7, `/api/events` allows 16 streams per client IP. E2E runs every browser from one IP, so keep Playwright workers ≤ 16 (16 today) or raise the cap for tests. Behind a reverse proxy all tabs share the proxy IP.
- Since FIX-5, opening mdv by hostname (for example `http://nas.local:8080` on the iPad) needs that name in `MDV_ALLOWED_HOSTS`; IP literals and `localhost` always work. DOC1 must say so.
- Go module path: `github.com/awesomejt/markdown-viewer`; binary `mdv`; env prefix `MDV_`.

- D2 Go module path is `github.com/d2lang/d2` (v0.9.0). Do not use `oss.terrastruct.com/d2` (frozen at v0.7.2).
- `@terrastruct/d2` npm WASM package is stale (Aug 2025) and ~60 MB, so D2 is rendered server-side.
- D2 Go API (P0.5): `d2lib.Compile` + `d2svg.Render`, pure Go (no CGO/JS), ~1-3 ms for small diagrams, +22 MB binary, deterministic SVG with embedded fonts; details in `agents/Research.md`.
- SMB/NFS mounts often emit no fsnotify events, so a polling fallback is required.
- Task tracking is `TODO.md` and state is `status.yaml` (D-16). No AWB.

## Known Limitations And Accepted Risks

Open items carried from archived run log entries (`agents/Memory-History.md`). R1 confirmed these as accepted; new R1 defects are FIX-4 to FIX-14 in `TODO.md`.

- Live reload: any missing `sub` path makes `/api/events` return 404 for the whole stream, and the client has no special handling, so deleting a viewed file can break live reload for that tab (B6/B7).
- Live reload: late height changes (Shiki, diagrams) after the scroll restore can shift the position slightly (F6). The workspace tree has no subscriptions of its own (R2.10).
- Watchers: fsnotify `Add`/`Remove` bypass the FS timeouts (local disks only). A deleted root stays unwatched until restart. Delete + create of a parent with the file present merges to `modified`. Poll treats a file-to-dir swap as `modified` (B6/B7).
- Subscribe validates subs sequentially (worst case 32 × `MDV_FS_TIMEOUT` on a hung mount; accepted). `HostPath` has a small TOCTOU gap that leaks only "changed".
- D2: a cached render timeout persists until LRU eviction or restart (per spec).
- Bundle: the >500 kB chunk warning (MarkdownView/index) remains. `npm audit` low-severity katex advisory via mermaid (R2.7).
- Remote `http(s)` images in Markdown load automatically (third parties see IP and open time; `no-referrer` only). Accepted for the LAN MVP (D-26).
- E2E: `tree works in the mobile drawer` failed with "element not found" on the Sidebar nav (webkit in FIX-4, ipad in FIX-9) and passed on re-run; tracked as FIX-15. `[firefox] live.spec.ts:65 folder view shows created and drops deleted files` failed once in FIX-11 (`second.md` not shown within 5 s); tracked as FIX-17.
- Startup (FIX-8): a root that is missing, erroring or hung at boot starts `available:false` and is reopened by the probe; a root path that is a file still fails startup. If the mount point exists but the NAS is not mounted yet, the open binds the empty directory and stays there after the mount appears (restart needed; FIX-16). DOC1 must cover boot ordering. Compose binds the parent of the NAS mount points with `rslave` (FIX-9).
- `/view/...%2f..` returns 200 because it is an SPA route; the API path guard is the boundary (T1).

## Open Questions

- Which voice-over extensions to build, and which existing convention to follow (Fountain, SSML, directives).
- Initial NAS roots and the UID/GID owning the VM mount.
- Whether a desktop wrapper is still wanted after the web app works.

## Blockers

- None.

## Agent Run Log

Newest entries first. Keep only the last three entries here; when adding a new one, move the oldest to the top of `agents/Memory-History.md` and carry any still-open follow-up into "Known Limitations And Accepted Risks".

### 2026-10-12 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (FIX-11)

- Task: FR-1.2 date sort.
- Files changed: `web/src/browse/logic.ts` (`sortEntries`, `loadSort`/`saveSort`, key `mdv-sort`), `BrowseView.tsx` ("Sort by" select), `browse.css`, unit/component tests, `e2e/tests/browse.spec.ts` (live root folder with `utimesSync` mtimes, persists across reload).
- Result: Folders first in both modes; date = newest first, name tie-break, missing mtime last. The orchestrator reviewed the diff and re-ran `make check` (154 unit) and `make e2e` twice (140 passed); all exit 0, logs `build/fix11-*.log`.
- Blockers or follow-up: FIX-17 (firefox live-folder flake seen once by the subagent).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (FIX-10)

- Task: E2E gaps (back/forward, relative image, offline guard).
- Files changed: `e2e/tests/fixtures.ts` (new auto fixture: aborts and records any non-local http(s) request, fails at teardown; `allowedRemote` option for D-26 remote images), all specs import `test`/`expect` from it, new tests in `flow`, `markdown`, `diagrams` specs.
- Result: The route matches `^https?:` only, because routing `blob:` breaks WebKit diagram images. The orchestrator reviewed the diff and re-ran `make e2e` (136 passed) and `make check`; both exit 0, logs `build/fix10-*.log`.
- Blockers or follow-up: None.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (FIX-9)

- Task: Compose/defaults.
- Files changed: `compose.yaml` (`${MDV_ROOTS:-...}`, `${MDV_POLL_INTERVAL:-2s}`, commented long-syntax NAS bind of the parent dir with `rslave` and `create_host_path: false`), `internal/config/config.go` + test (poll default 2s), `docs/Architecture.md`, `docs/Tech-Stack.md`.
- Result: `docker compose config` verified with and without overrides and with the NAS block uncommented; `make check` exit 0; `make e2e` 124 passed on re-run (first run: drawer flake, now FIX-15). Logs in `build/fix9/`.
- Blockers or follow-up: FIX-15 (drawer flake, second occurrence), FIX-16 (root opened before the NAS mounts stays on the empty dir).

# Project Memory

Persistent project memory for this repository.

Agents should update this file after meaningful decisions, milestones, blockers, research findings, or workflow changes. Keep entries short and durable; do not paste full chat transcripts here.

## Current Status

- Current phase: Phase 1 MVP
- Last major milestone: DEP1 deployed on docker2 under systemd (2026-10-14)
- Next recommended task: PJ6 (Phase 2b, D-30); RX0, RT1, FM1 (Phase 2c, D-31) are also ready. V1 [Human] iPad checklist against docker2 (`http://192.168.50.58:8080`) still open
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
- Phase 2b (D-30): `*.mdv.yaml` project files + global `preferences.yaml` + per-device relative text scale; cross-root refs later (FUT7), project save later (FUT8).
- Phase 2c (D-31): reading styles + bundled OFL fonts served by mdv (no internet, NFR-5), focus mode for VO reading, read-time estimates (160 wpm default, `includeCode` per project, D-32); teleprompter later (FUT9).
- Future (post-MVP): voice-over script Markdown extensions (see `docs/Requirements.md`, VO-1..VO-8).

## Milestones

- 2026-10-11: Research phase drafted requirements, stack, and architecture.
- 2026-10-11: Planning complete: API contract, config, layout, and phased tasks.

## Important Context

- Resume prompt after `/clear` or a stop: "Read AGENTS.md, MEMORY.md and TODO.md, then continue with the next task using the Git workflow in docs/Implementation.md."
- Owner's shell aliases `make` to `make -j32`: Makefile targets must declare real dependencies (never rely on prerequisite order).
- Deploy target: docker2 `jason@192.168.50.58` (SSH key auth), stack `/opt/stacks/mdv`, unit `docker-compose@mdv`, NAS CIFS `/mnt/content` (uid/gid 1000) as root `content`, port 8080. Other apps share this VM: keep stack config inside `/opt/stacks/<name>`.
- Port 8080 on the dev host is used by another container: smoke-test Compose with `MDV_PORT=18080` (or another free port).
- Host has go 1.27.1, node 24, docker, yamllint. golangci-lint/hadolint/shellcheck and Playwright (`mcr.microsoft.com/playwright:v1.64.0-noble`) run via Docker images; markdownlint-cli2 via npm. No host browsers: the image tag must match `@playwright/test` in `e2e/package.json`.

- Since FIX-10, every e2e spec must import `test`/`expect` from `e2e/tests/fixtures.ts` (offline guard).
- Since FIX-18, `useLiveSubscription(root, path, true)` is a low-priority sub (Markdown images, and since R2.10 every shown workspace-tree folder): it only fills slots under the 32-sub cap left by normal subs, and is sent as `lsub` (the server drops invalid ones, FIX-22). A folder sub does not report content changes of its children (only add/remove), so watch files directly when content matters.
- Since FIX-7, `/api/events` allows 16 streams per client IP. E2E runs every browser from one IP, so keep Playwright workers ≤ 16 (16 today) or raise the cap for tests. Behind a reverse proxy all tabs share the proxy IP.
- Since FIX-5, opening mdv by hostname (for example `http://nas.local:8080` on the iPad) needs that name in `MDV_ALLOWED_HOSTS`; IP literals and `localhost` always work.
- Go module path: `github.com/awesomejt/markdown-viewer`; binary `mdv`; env prefix `MDV_`.

- D2 Go module path is `github.com/d2lang/d2` (v0.9.0). Do not use `oss.terrastruct.com/d2` (frozen at v0.7.2).
- `@terrastruct/d2` npm WASM package is stale (Aug 2025) and ~60 MB, so D2 is rendered server-side.
- D2 Go API (P0.5): `d2lib.Compile` + `d2svg.Render`, pure Go (no CGO/JS), ~1-3 ms for small diagrams, +22 MB binary, deterministic SVG with embedded fonts; details in `agents/Research.md`.
- SMB/NFS mounts often emit no fsnotify events, so a polling fallback is required.
- Task tracking is `TODO.md` and state is `status.yaml` (D-16). No AWB.
- Since 2026-10-15, branches land through the project agent `git-merger` (Haiku, `.claude/agents/`), with project git permissions in `.claude/settings.json` (one plain git command per call; push/reset/rebase/amend/`branch -D` denied). The hook `.claude/hooks/require-merged.sh` refuses to create a branch unless on a clean `main` with no unmerged branches. User-level agents in `~/.claude/agents/` now pin a model each (no `inherit`).

## Known Limitations And Accepted Risks

Open items carried from archived run log entries (`agents/Memory-History.md`). R1 confirmed these as accepted; new R1 defects are FIX-4 to FIX-14 in `TODO.md` (all done).

- Live reload: a normal `sub` that fails validation (for example a missing parent directory on an `:fsnotify` root) still makes `/api/events` fail the whole stream, and the client has no special handling, so deleting a viewed file's directory can break live reload for that tab (B6/B7). Since FIX-22, low-priority subs (images, tree folders) go as `lsub` and the server drops invalid ones instead.
- Live reload: late height changes (Shiki, diagrams) after the scroll restore can shift the position slightly (F6), and so can an open TOC panel above the body when the heading count changes (R2.6).
- Watchers: fsnotify `Add`/`Remove` bypass the FS timeouts (local disks only). A deleted root stays unwatched until restart. Delete + create of a parent with the file present merges to `modified`. Poll treats a file-to-dir swap as `modified` (B6/B7).
- Subscribe validates subs sequentially (worst case 32 × `MDV_FS_TIMEOUT` on a hung mount; accepted). `HostPath` has a small TOCTOU gap that leaks only "changed".
- D2: a cached render timeout persists until LRU eviction or restart (per spec).
- Long folders (R2.11): browser find-in-page only sees the rendered rows of a virtualized listing (use the name filter); tree folders page 200 at a time instead of virtualizing. Keyboard focus is lost when the focused row scrolls out of the overscan (R2.13). Emulated timings pass NFR-3 (R2.13); real iPad still unmeasured (V1).
- Unmounted NAS (R2.13, D-27): the root reopens on the empty mount point, so it lists empty (200) instead of `available:false`, and poll watchers report `deleted` for open files.
- NFR-3 (D-28): judged by the viewport metric (1.6-1.8 s on iPad emulation); all 10 diagrams of a large doc take ~2.6 s because Mermaid measures text in the full `body`. Re-measure with `make perf`.
- Bundle: the >500 kB chunk warning (MarkdownView/index) remains. KaTeX fonts add ~1.2 MB (woff2/woff/ttf) to the embedded bundle; browsers fetch only woff2. Dev-only `npm audit`: 5 high findings for `braces` 3.0.3 (via `micromatch` in `markdownlint-cli2`) have no fixed release; lint-time only, never bundled; re-check on dependency bumps (FIX-20).
- Code view (R2.5): extensionless names (`Makefile`, `Dockerfile`) stay plain, as the server classifies them `other`.
- Math (R2.7): as on GitHub, a `$...$` pair is math even in prose ("$5 and $10"); escape with `\$`. Any `$` (also in code) loads the KaTeX chunk and briefly delays the body.
- Remote `http(s)` images in Markdown load automatically (third parties see IP and open time; `no-referrer` only). Accepted for the LAN MVP (D-26).
- Startup (FIX-8): a root that is missing, erroring or hung at boot starts `available:false` and is reopened by the probe; a root path that is a file still fails startup. If the mount point exists but the NAS is not mounted yet, the open binds the empty directory and switches within ~2 s of the mount appearing (FIX-16); `:fsnotify` roots may still miss events after a remount (host-path inotify watches are not re-added). Boot ordering is documented in `docs/Deployment.md`. Compose binds the parent of the NAS mount points with `rslave` (FIX-9).
- D2 layout (R2.9): the Layout select is per figure and not persisted; `d2-config` themes in a source are ignored (the app theme wins).
- Oversized diagrams (FIX-2): "Load anyway" fetches the source, but D2 render bodies are capped at 256 KiB and Mermaid at ~50 KB, so a diagram that large shows the error figure.
- DEP1: upgrade docker2 by re-archiving the source into `/opt/stacks/mdv` (no GitHub key on the VM), then `systemctl reload docker-compose@mdv`.
- Deployment (DEP1): docker2 uses the per-stack systemd drop-in (D-29), tested with a reboot; the `docker.service` `RequiresMountsFor=` variant in `docs/Deployment.md` is untested.
- `/view/...%2f..` returns 200 because it is an SPA route; the API path guard is the boundary (T1).
- Roots (FIX-21): a root path must be a real directory or mount point, not a symlink (refused as unavailable, also at startup). Symlinks in parent folders are resolved once into the pin, so a parent folder swapped for a symlink before startup is still followed; parents up to the mount point must not be writable by untrusted users (`docs/Deployment.md`). Retargeting a configured parent symlink needs a restart.
- Project stat cache (PJ3): a slot-wait `unavailable` is reused for `MDV_POLL_INTERVAL`, so PJ5b's "Re-check" may want to bypass the cache.
- Project warnings (PJ5b): an unknown style/font name set by a project appears both in the prefs banner (resolved-value warnings) and in the project warnings panel.
- Settings parser (PJ1): the non-specific YAML tag `!` (for example `fontSize: ! 18`) passes the pre-check because go-yaml discards it, so the value is typed as if untagged (no security impact; pinned by a test). Integers are decimal only (no hex/octal/underscores).

## Open Questions

- Which voice-over extensions to build, and which existing convention to follow (Fountain, SSML, directives).
- Whether a desktop wrapper is still wanted after the web app works.

## Blockers

- None.

## Agent Run Log

Newest entries first. Keep only the last three entries here; when adding a new one, move the oldest to the top of `agents/Memory-History.md` and carry any still-open follow-up into "Known Limitations And Accepted Risks".

### 2026-10-16 - Claude Opus 5.5 orchestrator (PJ5b)

- Task: project sidebar, warnings, live reload with keep-last-good, per-project device choices. Sonnet coder; orchestrator reviewed (all device writers go through `useSettings`, so scope is enforced in one place) and showed the isolation and 404 tests red under mutation; Haiku gate and merge.
- Files changed: new `web/src/workspace/TreeRows.tsx` (shared `TreeRow`/`TreeChildren`/`TREE_PAGE`), `web/src/project/` (`ProjectSidebar`, `ProjectTree`, `ProjectWarnings`, `logic.ts`, `project.css`; provider computes effective `data` + `problem` and subscribes to the project file), `settings/device.ts` (`mdv-project-device`, scope arg on `setDeviceChoice`/`useDeviceLayer`/`readDeviceLayer`/`resetDeviceChoices`), `boot.ts` (reads `?project=`), `useSettings.ts`, `project.ts` (`useProjectWarnings`), new `ResetChoices.tsx`, `live/logic.ts`, `Layout.tsx`, tests, e2e live edit in the `live` root, `docs/Architecture.md` PJ5b notes.
- Result: web tests 412 passed (96.7% lines); `make e2e` 299 passed, 1 skipped. Deviation: a "Close project" link was added to the sidebar (otherwise only Home leaves a healthy project).
- Blockers or follow-up: an unknown style/font in a project shows in both the prefs banner and the project warnings. Gate found a sidebar test race (asserted before the project sidebar rendered; orchestrator made it wait). The PJ4b `ViewFileView` flake recurred once under concurrent runs: FIX-29.

### 2026-10-16 - Claude Opus 5.5 orchestrator (PJ5a)

- Task: `?project=` routing and project mode entry. Sonnet coder; orchestrator review found "Close project" re-entering the project when shown on the project file itself (where a failed load lands) and sent it back; the fix's test was shown red by the orchestrator. Orchestrator made the sidebar root list an explicit exit (contract). Haiku gate and merge.
- Files changed: `web/src/api/client.ts` (`ProjectRef`, `NavScope`, `parseProjectParam`/`formatProject`, `getProject`, `ApiError.line`), `api/hooks.ts` (`useProjectQuery`, `notifyOnChangeProps: 'all'` because deeper readers mount after the result), new `web/src/project/` (`ProjectProvider`, `ProjectGate`, `ProjectHome`, `useNavScope`, tests), `settings/project.ts` (real `useProjectLayer`), callers moved to `NavScope` (browse, workspace, fileview, markdown links, recent, Layout), `live/logic.ts` (`isApiQueryKey` knows `project`), e2e `project.spec.ts` + `testdata/fixtures/projects/`, `internal/fsroot/list_test.go` (new fixture folder), `docs/Architecture.md` PJ5a notes.
- Result: web tests 392 passed (96.5% lines); `make e2e` 283 passed, 1 skipped.
- Blockers or follow-up: `useProjectLayer` keeps the last data of the current key, so PJ5b's keep-last-good builds on it. No live sub on the project file yet (PJ5b).

### 2026-10-16 - Claude Opus 5.5 orchestrator (PJ4b)

- Task: device text scale. Sonnet coder; orchestrator reviewed and merged the duplicated round/clamp code into `snapTextScale`; Haiku gate and merge.
- Files changed: `web/src/settings/device.ts` (`mdv-text-scale` store, integer percent 50-200 in steps of 10, 100 removes the key, global only and outside the `setDeviceChoice` seam, fed into the device layer and boot step), new `useTextScale.ts`, `useTextScaleKeys.ts` (`onTextScaleKey`), `TextScaleControls.tsx` (A−, percent reset, A+), tests; `Layout.tsx`; content CSS `clamp(8px, ..., 48px)` (text/code 0.9 of that, top 43.2px); header fits 320 px (theme select may shrink, title truncates first); e2e in `settings.spec.ts` (Ctrl keys skipped on the ipad project); `docs/Architecture.md` PJ4b notes.
- Result: web tests 368 passed, coverage 96.4% lines; `make e2e` 263 passed, 1 skipped.
- Blockers or follow-up: `ViewFileView.test.tsx` "falls back to the project kind" failed once under `make -j32` load and passed on every rerun (possible flaky timing; investigate if it repeats).

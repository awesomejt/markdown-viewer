# Project Memory

Persistent project memory for this repository.

Agents should update this file after meaningful decisions, milestones, blockers, research findings, or workflow changes. Keep entries short and durable; do not paste full chat transcripts here.

## Current Status

- Current phase: Phase 1 MVP
- Last major milestone: R2.10 workspace tree live updates (2026-10-12)
- Next recommended task: V1 [Human] deploy on the VM + iPad checklist (`docs/Deployment.md`); agents can continue with Phase 2 (R2.11) meanwhile
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
- Since FIX-18, `useLiveSubscription(root, path, true)` is a low-priority sub (Markdown images, and since R2.10 every shown workspace-tree folder): it only fills slots under the 32-sub cap left by normal subs. A folder sub does not report content changes of its children (only add/remove), so watch files directly when content matters.
- Since FIX-7, `/api/events` allows 16 streams per client IP. E2E runs every browser from one IP, so keep Playwright workers ≤ 16 (16 today) or raise the cap for tests. Behind a reverse proxy all tabs share the proxy IP.
- Since FIX-5, opening mdv by hostname (for example `http://nas.local:8080` on the iPad) needs that name in `MDV_ALLOWED_HOSTS`; IP literals and `localhost` always work.
- Go module path: `github.com/awesomejt/markdown-viewer`; binary `mdv`; env prefix `MDV_`.

- D2 Go module path is `github.com/d2lang/d2` (v0.9.0). Do not use `oss.terrastruct.com/d2` (frozen at v0.7.2).
- `@terrastruct/d2` npm WASM package is stale (Aug 2025) and ~60 MB, so D2 is rendered server-side.
- D2 Go API (P0.5): `d2lib.Compile` + `d2svg.Render`, pure Go (no CGO/JS), ~1-3 ms for small diagrams, +22 MB binary, deterministic SVG with embedded fonts; details in `agents/Research.md`.
- SMB/NFS mounts often emit no fsnotify events, so a polling fallback is required.
- Task tracking is `TODO.md` and state is `status.yaml` (D-16). No AWB.

## Known Limitations And Accepted Risks

Open items carried from archived run log entries (`agents/Memory-History.md`). R1 confirmed these as accepted; new R1 defects are FIX-4 to FIX-14 in `TODO.md` (all done).

- Live reload: any missing `sub` path makes `/api/events` return 404 for the whole stream, and the client has no special handling, so deleting a viewed file can break live reload for that tab (B6/B7).
- Live reload: late height changes (Shiki, diagrams) after the scroll restore can shift the position slightly (F6), and so can an open TOC panel above the body when the heading count changes (R2.6).
- Watchers: fsnotify `Add`/`Remove` bypass the FS timeouts (local disks only). A deleted root stays unwatched until restart. Delete + create of a parent with the file present merges to `modified`. Poll treats a file-to-dir swap as `modified` (B6/B7).
- Subscribe validates subs sequentially (worst case 32 × `MDV_FS_TIMEOUT` on a hung mount; accepted). `HostPath` has a small TOCTOU gap that leaks only "changed".
- D2: a cached render timeout persists until LRU eviction or restart (per spec).
- Bundle: the >500 kB chunk warning (MarkdownView/index) remains. KaTeX fonts add ~1.2 MB (woff2/woff/ttf) to the embedded bundle; browsers fetch only woff2. Dev-only `npm audit` items in the markdownlint-cli2 chain are FIX-20.
- Code view (R2.5): extensionless names (`Makefile`, `Dockerfile`) stay plain, as the server classifies them `other`.
- Math (R2.7): as on GitHub, a `$...$` pair is math even in prose ("$5 and $10"); escape with `\$`. Any `$` (also in code) loads the KaTeX chunk and briefly delays the body.
- Remote `http(s)` images in Markdown load automatically (third parties see IP and open time; `no-referrer` only). Accepted for the LAN MVP (D-26).
- Startup (FIX-8): a root that is missing, erroring or hung at boot starts `available:false` and is reopened by the probe; a root path that is a file still fails startup. If the mount point exists but the NAS is not mounted yet, the open binds the empty directory and switches within ~2 s of the mount appearing (FIX-16); `:fsnotify` roots may still miss events after a remount (host-path inotify watches are not re-added). Boot ordering is documented in `docs/Deployment.md`. Compose binds the parent of the NAS mount points with `rslave` (FIX-9).
- D2 layout (R2.9): the Layout select is per figure and not persisted; `d2-config` themes in a source are ignored (the app theme wins).
- Oversized diagrams (FIX-2): "Load anyway" fetches the source, but D2 render bodies are capped at 256 KiB and Mermaid at ~50 KB, so a diagram that large shows the error figure.
- `docs/Deployment.md` fstab options and the systemd `RequiresMountsFor=` drop-in are untested on the real VM; V1 must validate them (DOC1).
- `/view/...%2f..` returns 200 because it is an SPA route; the API path guard is the boundary (T1).

## Open Questions

- Which voice-over extensions to build, and which existing convention to follow (Fountain, SSML, directives).
- Initial NAS roots and the UID/GID owning the VM mount.
- Whether a desktop wrapper is still wanted after the web app works.

## Blockers

- None.

## Agent Run Log

Newest entries first. Keep only the last three entries here; when adding a new one, move the oldest to the top of `agents/Memory-History.md` and carry any still-open follow-up into "Known Limitations And Accepted Risks".

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.10)

- Task: Workspace tree live updates on create/delete/rename (FR-5.2); done in the orchestrator without a subagent.
- Files changed: `web/src/workspace/WorkspaceTree.tsx` (`TreeChildren` calls `useLiveSubscription(root, dir, true)`), `WorkspaceTree.test.tsx` (fake `EventSource` asserts the sub set on expand/collapse), `e2e/tests/live.spec.ts` (add, delete, rename at two tree levels), `docs/Architecture.md`, `README.md`.
- Result: component test and e2e (4/4) red without the change. `make check` exit 0, `make e2e` 212 passed; logs `build/r210-*.log`.
- Blockers or follow-up: None. Tree and image subs share the low tier (sorted, so past the cap some deep folders or images go unwatched).

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.9)

- Task: D2 ELK layout option; theme-aware re-render (FR-4.5, FR-4.9); done in the orchestrator without a subagent.
- Files changed: `internal/d2render/render.go` (resolver uses the engine name, so `d2-config.layout-engine` applies when no layout is requested; empty layout is its own cache key) + test, `internal/api/render.go` (comment), `web/src/api/client.ts` (`D2Layout`), `D2Diagram.tsx` (Layout select, `keepPreviousData`), `DiagramFigure.tsx` (`tools`, `busy`, keeps the old image until the new URL exists), `MermaidDiagram.tsx` (keeps last SVG), unit tests, `e2e/tests/diagrams.spec.ts`, `examples/d2.md`, `docs/Architecture.md`, `README.md`.
- Result: Go test red before the resolver fix; viewer-persistence test red with the old figure condition. `make check` exit 0 (245 unit), `make e2e` 208 passed; logs `build/r29-*.log`. Example checked on a live server (Auto = ELK ≠ dagre).
- Blockers or follow-up: Theme re-render already existed (F4); now it no longer flashes "Rendering…". The R2.8 "viewer closes on live reload" limitation is fixed.

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.8)

- Task: Diagram source toggle, pan/zoom, full screen, iPad pinch (FR-4.6, FR-4.7); done in the orchestrator without a subagent.
- Files changed: new `web/src/diagrams/panzoom.ts` (pure zoom/pan/pinch/wheel math), `DiagramViewer.tsx` (native modal `dialog` portaled to `body`), `DiagramFigure.tsx` (tools row), `app/app.css`, unit tests (`panzoom.test.ts`, `viewer.test.tsx`), `e2e/tests/diagrams.spec.ts`, `docs/Architecture.md`, `README.md`.
- Result: `make check` exit 0 (242 unit), `make e2e` 204 passed (synthetic touch pointers pinch on all 4 projects); logs `build/r28-*.log`.
- Blockers or follow-up: R2.9's "re-render on theme change" already exists since F4; only the ELK option remains there.

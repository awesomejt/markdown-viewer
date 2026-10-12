# Project Memory

Persistent project memory for this repository.

Agents should update this file after meaningful decisions, milestones, blockers, research findings, or workflow changes. Keep entries short and durable; do not paste full chat transcripts here.

## Current Status

- Current phase: Phase 1 MVP
- Last major milestone: R2.4 home-screen manifest and icons (2026-10-12)
- Next recommended task: V1 [Human] deploy on the VM + iPad checklist (`docs/Deployment.md`); agents can continue with Phase 2 (R2.5) meanwhile
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
- Since FIX-18, `useLiveSubscription(root, path, true)` is a low-priority sub (Markdown images): it only fills slots under the 32-sub cap left by normal subs. A folder sub does not report content changes of its children (only add/remove), so watch files directly when content matters.
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
- Live reload: late height changes (Shiki, diagrams) after the scroll restore can shift the position slightly (F6). The workspace tree has no subscriptions of its own (R2.10).
- Watchers: fsnotify `Add`/`Remove` bypass the FS timeouts (local disks only). A deleted root stays unwatched until restart. Delete + create of a parent with the file present merges to `modified`. Poll treats a file-to-dir swap as `modified` (B6/B7).
- Subscribe validates subs sequentially (worst case 32 × `MDV_FS_TIMEOUT` on a hung mount; accepted). `HostPath` has a small TOCTOU gap that leaks only "changed".
- D2: a cached render timeout persists until LRU eviction or restart (per spec).
- Bundle: the >500 kB chunk warning (MarkdownView/index) remains. `npm audit` low-severity katex advisory via mermaid (R2.7).
- Remote `http(s)` images in Markdown load automatically (third parties see IP and open time; `no-referrer` only). Accepted for the LAN MVP (D-26).
- Startup (FIX-8): a root that is missing, erroring or hung at boot starts `available:false` and is reopened by the probe; a root path that is a file still fails startup. If the mount point exists but the NAS is not mounted yet, the open binds the empty directory and switches within ~2 s of the mount appearing (FIX-16); `:fsnotify` roots may still miss events after a remount (host-path inotify watches are not re-added). Boot ordering is documented in `docs/Deployment.md`. Compose binds the parent of the NAS mount points with `rslave` (FIX-9).
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

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.4)

- Task: Web-app manifest and home-screen icons (FR-6.3); done in the orchestrator without a subagent.
- Files changed: new `web/icons/icon.svg` + `mkicons.sh` (rsvg-convert → committed `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`), `web/public/manifest.webmanifest`, `favicon.svg` (M-arrow mark replaces the Vite logo), `web/index.html` (manifest, touch icon, Apple meta, two `theme-color` metas), `app/theme.ts` (`THEME_COLOR`, `applyTheme` syncs the metas), `internal/web/web.go` (`.webmanifest` → `application/manifest+json`), unit/Go tests, `e2e/tests/shell.spec.ts`, `docs/Architecture.md`, `docs/Deployment.md`.
- Result: Go test red (text/plain) before the MIME fix. `make check` exit 0, `make e2e` 180 passed; logs `build/r24-*.log`.
- Blockers or follow-up: Standalone mode hides Safari's back button and reload; V1 should add to Home Screen on the iPad and check icon, title, status bar and back navigation.

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.3)

- Task: Recent files/folders (FR-2.6); done in the orchestrator without a subagent.
- Files changed: new `web/src/recent/recent.ts` (`pushRecent`/`parseRecent`, shared `useSyncExternalStore` store, `mdv-recent`, 10 items, follows `storage`, in-memory fallback), `RecentList.tsx` (`useRecordRecent`, list + "Clear recent"), `BrowseView.tsx`/`ViewFileView.tsx` (record dir once listed, file once in its parent listing), `RootsView.tsx` + `Layout.tsx` (home page; sidebar outside a workspace except on `/`), `app/app.css`, `recent.test.tsx`, `e2e/tests/recent.spec.ts`, `docs/Architecture.md`.
- Result: component test red with recording disabled. `make check` exit 0 (207 unit), `make e2e` 172 passed twice; logs `build/r23-*.log`.
- Blockers or follow-up: None. A recent item whose file was later deleted stays listed (its link shows the normal not-found state).

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.2)

- Task: Copy-code button and front matter panel (FR-3.2, FR-3.4); done in the orchestrator without a subagent.
- Files changed: new `web/src/markdown/copy.ts` (`copyText`: async clipboard in secure contexts, else `execCommand` on an off-screen textarea), `CopyButton.tsx`, `frontMatter.ts` (`extractFrontMatter`, remark-frontmatter `yaml` fences), `MarkdownView.tsx` (`.code-block` wrapper; collapsed `details.front-matter` above `.markdown-body`), `app/app.css`, unit tests, `e2e/tests/markdown.spec.ts`, `docs/Architecture.md`.
- Result: 4 component tests red without the wiring. `make check` exit 0 (198 unit), `make e2e` 168 passed; logs `build/r22-*.log`.
- Blockers or follow-up: The plain-HTTP `execCommand` fallback is unit-tested only (e2e runs on `localhost`, a secure context); V1 should tap Copy on the iPad.

# Project Memory

Persistent project memory for this repository.

Agents should update this file after meaningful decisions, milestones, blockers, research findings, or workflow changes. Keep entries short and durable; do not paste full chat transcripts here.

## Current Status

- Current phase: Phase 1 MVP
- Last major milestone: FIX-7 SSE stream and missing-path caps merged (2026-10-11)
- Next recommended task: FIX-8 [S] startup resilience for roots that are down at boot, then FIX-9 to FIX-11, then DOC1
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
- E2E: `workspace tree works in the mobile drawer` failed once on webkit during FIX-4 (element not found) and passed on re-run; likely the drawer auto-close race from T1. Watch for recurrence.
- `/view/...%2f..` returns 200 because it is an SPA route; the API path guard is the boundary (T1).

## Open Questions

- Which voice-over extensions to build, and which existing convention to follow (Fountain, SSML, directives).
- Initial NAS roots and the UID/GID owning the VM mount.
- Whether a desktop wrapper is still wanted after the web app works.

## Blockers

- None.

## Agent Run Log

Newest entries first. Keep only the last three entries here; when adding a new one, move the oldest to the top of `agents/Memory-History.md` and carry any still-open follow-up into "Known Limitations And Accepted Risks".

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (FIX-7)

- Task: SSE limits.
- Files changed: `internal/watch/hub.go` (`MaxMissing`, `entry.missing` kept for the entry's life), `internal/api/events.go` + `api.go` (stream limiter keyed by `RemoteAddr` host), tests, `docs/Architecture.md`.
- Result: No new env vars. The orchestrator reviewed the diff and re-ran `go test -race -count=3` (watch, api), `make check` and `make e2e` (124 passed, 16 workers); all exit 0, logs in `build/fix7/`.
- Blockers or follow-up: None.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (FIX-6)

- Task: D2 cache byte bound.
- Files changed: `internal/d2render/cache.go` (byte accounting, per-entry cap, 64 B overhead so negative entries count), `internal/d2render/render.go` (`Options.CacheBytes` 64 MiB, `MaxEntryBytes` 4 MiB clamped to `CacheBytes`), `render_test.go`, `docs/Architecture.md`.
- Result: Not exposed as an env var (only `MDV_D2_CACHE_ENTRIES` stays configurable). The orchestrator reviewed the diff and re-ran `go test -race -count=3 ./internal/d2render/` and `make check` (both exit 0, logs in `build/fix6/`). No e2e needed (no API/UI change).
- Blockers or follow-up: None.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 review (FIX-5)

- Task: DNS rebinding Host allowlist (🔒).
- Files changed: `internal/config/config.go` (`MDV_ALLOWED_HOSTS`), `internal/api/api.go` (`hostGuard`, 421 `host_not_allowed`), `cmd/mdv/main.go` (healthcheck `Host: localhost`, `*` warning), `compose.yaml`, tests in config/api/web/cmd, `docs/Architecture.md`.
- Result: Opus review found no bypass (odd IPv4 forms, brackets, trailing dots, absolute-form requests checked) and approved; its follow-ups were applied. `TestServeAndShutdown` hung 5 s because `Shutdown` treats a pooled but unused (`StateNew`) conn as idle only after 5 s; the test now closes idle client conns. `make check` exit 0, `make e2e` 124 passed.
- Blockers or follow-up: None.

# Project Memory

Persistent project memory for this repository.

Agents should update this file after meaningful decisions, milestones, blockers, research findings, or workflow changes. Keep entries short and durable; do not paste full chat transcripts here.

## Current Status

- Current phase: Phase 1 MVP
- Last major milestone: FIX-4 D2 render CSRF guard merged (2026-10-11)
- Next recommended task: FIX-5 🔒 [S] DNS rebinding Host allowlist, then FIX-6 to FIX-11, then DOC1
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

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 review (FIX-4)

- Task: D2 render CSRF + CSP (🔒).
- Files changed: `internal/api/render.go`, `internal/api/api.go` (`codeUnsupported`), `internal/api/render_test.go`, `web/src/api/client.test.ts`, `docs/Architecture.md` (415 row, render row, proxy note; tables re-padded for MD060).
- Result: Stdlib `http.CrossOriginProtection` guards the route (over plain HTTP it compares `Origin` with `Host`, so a reverse proxy must keep `Host` or terminate TLS). Opus reviewer found no remaining cross-site path and approved. `make check` exit 0 and `make e2e` 124 passed (logs in `build/fix4/`).
- Blockers or follow-up: One flaky webkit drawer e2e failure on the first run (see Known Limitations).

### 2026-10-11 - Claude Opus 5.5 (R1)

- Task: MVP phase review against Success Criteria 1 to 5 and the Security Model.
- Files changed: `TODO.md`, `MEMORY.md`, `agents/Decisions.md` (D-26), `agents/Memory-History.md`, `docs/Implementation.md` (R2.1), `docs/Tech-Stack.md` and `docs/Architecture.md` (drift fixes).
- Result: Three parallel Opus reviewers (backend security, frontend security, requirements/deployment); the orchestrator re-checked each logged finding in source. Path guard, sanitizer, `resolveLink`, diagram `<img>` isolation and `/api/file` headers hold. Main defects: `POST /api/render/d2` is cross-site postable (`text/plain`) and returns SVG without CSP (reproduced with `javascript:` links), no Host check (DNS rebinding), D2 cache unbounded by bytes, SSE watch cap exhaustible, a down NAS at boot stops the server. Outputs in `build/r1/`.
- Blockers or follow-up: FIX-4 to FIX-11 block DOC1. A part A reviewer's `pkill -f build/r1/mdv` may have killed another reviewer's probe server (harmless).

### 2026-10-11 - Claude Haiku 4.5 + Opus 5.5 verification (T2)

- Task: Full validation run (plus CH1: `MEMORY.md` streamlined, old run log in `agents/Memory-History.md`).
- Files changed: `TODO.md`, `MEMORY.md` (T2 is validation only).
- Result: `make check`, `go test -race ./...`, `make e2e` (124 passed) and `docker compose build` all exit 0. The orchestrator checked the exit-code files and log summaries in `build/t2/` directly rather than trusting the Haiku report.
- Blockers or follow-up: None. R1 should start from "Known Limitations And Accepted Risks".

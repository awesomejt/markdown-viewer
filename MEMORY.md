# Project Memory

Persistent project memory for this repository.

Agents should update this file after meaningful decisions, milestones, blockers, research findings, or workflow changes. Keep entries short and durable; do not paste full chat transcripts here.

## Current Status

- Current phase: Phase 1 MVP
- Last major milestone: T1 cross-browser e2e (chromium, firefox, webkit, iPad) (2026-10-11)
- Next recommended task: T2 [H] Full validation run
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

Open items carried from archived run log entries (`agents/Memory-History.md`). R1 should confirm or log them as `FIX-n`.

- Live reload: any missing `sub` path makes `/api/events` return 404 for the whole stream, and the client has no special handling, so deleting a viewed file can break live reload for that tab (B6/B7).
- Live reload: late height changes (Shiki, diagrams) after the scroll restore can shift the position slightly (F6). The workspace tree has no subscriptions of its own (R2.10).
- Watchers: fsnotify `Add`/`Remove` bypass the FS timeouts (local disks only). A deleted root stays unwatched until restart. Delete + create of a parent with the file present merges to `modified`. Poll treats a file-to-dir swap as `modified` (B6/B7).
- Subscribe validates subs sequentially (worst case 32 × `MDV_FS_TIMEOUT` on a hung mount; accepted). `HostPath` has a small TOCTOU gap that leaks only "changed".
- D2: a cached render timeout persists until LRU eviction or restart (per spec).
- Bundle: the >500 kB chunk warning (MarkdownView/index) remains. `npm audit` low-severity katex advisory via mermaid (R2.7).
- `/view/...%2f..` returns 200 because it is an SPA route; the API path guard is the boundary (T1).

## Open Questions

- Which voice-over extensions to build, and which existing convention to follow (Fountain, SSML, directives).
- Initial NAS roots and the UID/GID owning the VM mount.
- Whether a desktop wrapper is still wanted after the web app works.

## Blockers

- None.

## Agent Run Log

Newest entries first. Keep only the last three entries here; when adding a new one, move the oldest to the top of `agents/Memory-History.md` and carry any still-open follow-up into "Known Limitations And Accepted Risks".

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (T1)

- Task: Cross-browser e2e suite + iPad viewport.
- Files changed: `e2e/playwright.config.ts` (projects chromium, firefox, webkit, ipad), `e2e/tests/flow.spec.ts` (new), `e2e/tests/workspace.spec.ts` (`openTree` drawer helper).
- Result: 124 e2e tests (31 per project), no skips. iPad Pro 11 portrait is 834 px, so specs that use the sidebar must open the drawer, and must first wait for the drawer to auto-close after navigation (otherwise they race it). The orchestrator added a 200 control to the traversal test and re-ran `make e2e` (124 passed) and `make check` (exit 0).
- Blockers or follow-up: `/view/...%2f..` returns 200 (SPA route; the API is the guard), so traversal is tested on `/api/*` only.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (D1)

- Task: Dockerfile + compose.yaml.
- Files changed: `Dockerfile`, `.dockerignore`, `compose.yaml`, `Makefile` (`docker` target), `docs/Tech-Stack.md`.
- Result: Images `node:24.21-bookworm-slim`, `golang:1.27.2-bookworm`, `gcr.io/distroless/static-debian12:nonroot` (image user 65532). Compose overrides with `MDV_UID`/`MDV_GID` (default 1000:1000), `MDV_PORT` (8080), `MDV_VERSION` (image tag + build arg). No tmpfs needed (nothing writes temp files). `.dockerignore` excludes `*.md`, docs, examples, e2e, testdata. The orchestrator re-ran hadolint/yamllint, `docker compose build`/`up` (healthy; `/healthz`, `/api/list`, SPA route, `POST /api/render/d2` 200 on the read-only rootfs; inspect shows RO, CapDrop ALL, no-new-privileges, unless-stopped) and `make check` (exit 0).
- Blockers or follow-up: Real NAS UID/GID still open (Needs Attention). Port 8080 was busy on the dev host; smoke tests used `MDV_PORT=18080`.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (EX1)

- Task: Example Markdown set.
- Files changed: `examples/` (README index, `gfm-tour.md`, `mermaid.md`, `d2.md`, `flowchart.mmd`, `network.d2`, `guide/` nested cross-linked pages, `images/`, `broken-diagrams.md`, `broken.mmd`, `broken.d2`).
- Result: markdownlint clean (broken files excluded by existing `examples/broken*` ignore). Opus verified: all Mermaid sources parse with the project's `mermaid` (jsdom), the broken ones fail. Fresh-build server returns 200 for every valid D2 source and 422 for the broken ones. All folders list and both images serve. `make check` passes. Sonnet's sequence diagram cited non-existent endpoints; corrected.
- Blockers or follow-up: Browser render of examples is covered by T1 (e2e over examples).

# Project Memory

Persistent project memory for this repository.

Agents should update this file after meaningful decisions, milestones, blockers, research findings, or workflow changes. Keep entries short and durable; do not paste full chat transcripts here.

## Current Status

- Current phase: Planning (research complete)
- Last major milestone: Requirements, tech stack, and architecture drafted (2026-10-11)
- Next recommended task: Planning: fill `docs/Implementation.md`, finalize API/repo layout, phase the TODO
- Current blocker: None

## Key Decisions

Full log: `agents/Decisions.md`.

- LAN web app first. Must work on iPad Safari. Desktop wrapper deferred.
- Files come from the server host and network shares mounted on it (no in-app SMB).
- No auth (trusted LAN), read-only, restricted to configured roots.
- Viewer only, with live reload.
- Go server confirmed 2026-10-11 (single binary, embedded React SPA, native D2). Markdown and Mermaid render client-side.
- Deployment: Docker Compose on a VM; NAS mounted on the VM and bind-mounted `:ro` into the container (D-11).
- Future (post-MVP): voice-over script Markdown extensions (see `docs/Requirements.md`, VO-1..VO-8).

## Milestones

- 2026-10-11: Research phase drafted requirements, stack, and architecture.

## Important Context

- D2 Go module path is `github.com/d2lang/d2` (v0.9.0). Do not use `oss.terrastruct.com/d2` (frozen at v0.7.2).
- `@terrastruct/d2` npm WASM package is stale (Aug 2025) and ~60 MB, so D2 is rendered server-side.
- SMB/NFS mounts often emit no fsnotify events, so a polling fallback is required.
- AWB is not configured (`.awb/config.yaml` removed by owner); use `TODO.md` and `status.yaml`.

## Open Questions

- Which voice-over extensions to build, and which existing convention to follow (Fountain, SSML, directives).
- Initial NAS roots and the UID/GID owning the VM mount.
- Whether a desktop wrapper is still wanted after the web app works.

## Blockers

- None.

## Agent Run Log

Newest entries first.

### 2026-10-11 - Claude Code (Opus 5.5)

- Task: Record backend decision and future voice-over scope.
- Files changed: `docs/Requirements.md`, `docs/Tech-Stack.md`, `docs/Architecture.md`, `docs/Implementation.md`, `agents/Decisions.md`, `README.md`, `TODO.md`, `MEMORY.md`, `status.yaml`.
- Result: Go confirmed. Voice-over extensions added as post-MVP candidates (VO-1..VO-8). Status set to active / planning.
- Blockers or follow-up: Deployment decided later the same day: Docker Compose on a VM (D-11).

### 2026-10-11 - Claude Code (Opus 5.5)

- Task: Research tech stack; fill requirements; collect early decisions.
- Files changed: `docs/Requirements.md`, `docs/Tech-Stack.md`, `docs/Architecture.md`, `docs/Implementation.md`, `agents/Decisions.md`, `agents/Research.md`, `README.md`, `TODO.md`, `MEMORY.md`, `status.yaml`.
- Result: Requirements and stack recommendation drafted. Owner decided file access, auth, and scope.
- Blockers or follow-up: Owner to confirm Go backend; then Planning phase.

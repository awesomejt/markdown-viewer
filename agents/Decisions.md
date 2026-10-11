# Decisions

## Purpose

This file contains a log of important decisions.

## 2026-10-11: Initial Scope And Stack

| # | Decision | Status | Rationale |
| --- | --- | --- | --- |
| D-1 | Deliver as a LAN web app; desktop wrapper deferred | Decided | Must work from an iPad and any LAN device. A browser is the only universal client. |
| D-2 | Files come from the server host and shares mounted on it | Decided (owner) | Simplest, most reliable way to reach network drives. No in-app SMB client or credential storage. |
| D-3 | No authentication (trusted LAN) | Decided (owner) | Home LAN use. Mitigated by read-only access, the root allowlist, and not exposing it to the internet. |
| D-4 | Viewer only, with live reload | Decided (owner) | Keeps the server read-only and simple. Editing may come later. |
| D-5 | Backend in Go | Decided (owner, 2026-10-11) | Native D2 library, single-binary deployment with the UI embedded, cross-compilation to NAS/Pi. Python would need the external `d2` CLI. The backend choice does not affect iPad access. |
| D-6 | React 19 + TypeScript + Vite frontend | Decided (owner preference for React) | Rich Markdown ecosystem. Static build embeds into the server. |
| D-7 | Markdown and Mermaid render client-side; D2 renders server-side | Decided (follows D-5) | Mermaid is browser-only. D2's maintained library is Go, and its WASM build is stale and heavy for an iPad. |
| D-8 | Live reload with fsnotify + polling fallback, delivered over SSE | Proposed | Network mounts often emit no change events. SSE is simple and reconnects in Safari. |
| D-9 | Desktop app: post-MVP. Prefer browser/web-app install, then Wails v3 (once stable), then Electron | Deferred | Wails v3 is still beta (beta.28). Electron is a heavier fallback. |
| D-10 | Voice-over script Markdown extensions considered after MVP, as remark/rehype plugins | Deferred (owner) | Useful for VO scripts (speaker labels, directions, timing, teleprompter). Needs research into existing conventions first. |
| D-11 | Deploy with Docker Compose on a VM server. NAS shares are mounted on the VM and bind-mounted read-only into the container | Decided (owner) | The owner's preferred target. The OS handles SMB/NFS. Network-mounted roots default to polling for live reload, because NAS-side changes emit no inotify events. |
| D-12 | Multi-agent delivery with model tiers (Haiku deterministic, Sonnet moderate, Opus judgment); one commit per task | Decided (owner) | Optimizes token usage. Tiers are assigned per task in `docs/Implementation.md`. |
| D-13 | Per-task Git workflow: clean `main` → feature branch → grouped commits with tests → quality gate → `--no-ff` merge → re-validate on `main`; no pushes without the owner | Decided (owner) | Keeps changes reviewable and grouped. Leftover branches signal an unfinished task. |
| D-14 | YAML preferred for config; all config/code linted (golangci-lint, ESLint, yamllint, markdownlint, hadolint, shellcheck); coverage ≥ 80% (fsroot ≥ 90%) | Decided (owner) | Owner preference for YAML and high test coverage. Missing host tools run as pinned Docker images. |
| D-15 | Build outputs under ignored `build/`; Vite bundle in ignored `internal/web/dist/` | Decided | `go:embed` cannot reference paths outside its package, so the bundle lives beside the embedding package. |
| D-16 | Track tasks in `TODO.md` and state in `status.yaml`; no Agent Workbench | Decided (owner) | Simpler for a single-owner project. `.awb/config.yaml` removed (f1ced02). |
| D-17 | Use TypeScript 6.0 (Vite template default) instead of 7.0 for now; `go.mod` uses `ignore ./web` | Decided | `typescript-eslint` 8.x pins TS 6. npm `flatted` ships Go files that `./...` would otherwise build and lint. |
| D-18 | Model tiers: Haiku = Git management + running tools (no authoring); Sonnet = coding, research, planning, per-task review; Opus = big reviews (🔒, phases), debates/challenges, escalations | Decided (owner) | In P0.1 and P0.2, Haiku authoring needed Sonnet rework and its reports overstated success. Supersedes the tier table from D-12. |
| D-19 | P0.6 plan hardening applied (C-1…C-15) | Decided | An Opus plan challenge found gaps in SSE connection use, dead-mount handling, file serving XSS, D2 imports and resource limits, path guard design, and sequencing. All 15 findings are applied to Architecture and Implementation. |
| D-20 | Env-only configuration in MVP (C-14); no YAML config file or `MDV_CONFIG` | Decided (owner) | Compose sets env vars directly, so a config file adds parsing and tests for no MVP gain. Revisit if the config grows. |
| D-21 | Minimal large-file "load anyway" button (`force=1`) in MVP, in F5 (C-11) | Decided (owner) | Without it, files over `MDV_MAX_FILE_BYTES` are unreadable in the UI. Only virtualized listings stay in R2.11. |

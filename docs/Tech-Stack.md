# Technical Stack

## Purpose

This document lists the chosen languages, frameworks, and libraries, with the reasons for each choice. Versions are the latest stable releases as of 2026-10-11 and should be pinned when the project is scaffolded. Research sources are in [agents/Research.md](../agents/Research.md).

## Summary

| Layer | Choice | Version |
| --- | --- | --- |
| Server language | Go | 1.27.x (1.27.2) |
| HTTP | Go standard library `net/http` (method/pattern routing), `log/slog` | stdlib |
| D2 rendering | `github.com/d2lang/d2` (`d2lib`, `d2svg`, dagre/ELK layouts) | v0.9.0 |
| File watching | `github.com/fsnotify/fsnotify` + polling fallback | v1.10.1 |
| Asset embedding | Go `embed.FS` (the built React app ships inside the binary) | stdlib |
| Frontend framework | React + TypeScript | React 19.3, TS 6.0 |
| Build tool | Vite | 8.3 |
| Routing | React Router | 8.4 |
| Server state | TanStack Query | 5.104 |
| Long lists | TanStack Virtual (`@tanstack/react-virtual`) | 3.14 |
| Markdown | `react-markdown` (unified/remark/rehype) | 10.1 |
| Markdown plugins | `remark-gfm` 4, `remark-frontmatter` 5, `rehype-slug` 6, `rehype-raw` 7, `rehype-sanitize` 6 | — |
| Code highlighting | Shiki (`shiki/core`, JS regex engine, `@shikijs/langs`/`themes`, `hast-util-to-jsx-runtime`) | 4.5 |
| Mermaid | `mermaid` (lazy-loaded, client-side) | 12.1 |
| Math (should-have, R2.7) | KaTeX via `remark-math` / `rehype-katex` | 0.19 |
| Diagram pan/zoom (R2.8) | Small custom handler (`web/src/diagrams/panzoom.ts`, Pointer Events), no dependency | — |
| Server tests | `go test` (table tests, `httptest`) | stdlib |
| Frontend tests | Vitest | 5.0 |
| End-to-end tests | Playwright (Chromium, Firefox, **WebKit** to approximate iPad Safari) | 1.64 |
| Build | `make`; all outputs under the ignored `build/` | — |
| Linting | golangci-lint (Docker image), ESLint + Prettier, yamllint, markdownlint-cli2, hadolint and shellcheck (Docker images) | v2.14 / 9 / 1.38 / 0.23 / 2.15.1 / 0.11 |
| Packaging | Docker image (multi-stage: Node build, then Go build, then minimal runtime) run with **Docker Compose** on a VM | — |

## Architecture In One Paragraph

A Go server reads files from configured roots and returns directory listings and raw file contents through a small JSON/HTTP API. It renders D2 source to SVG on request, and pushes file-change events to the browser over Server-Sent Events (SSE). The React single-page app does all Markdown rendering in the browser, renders Mermaid there, and sends D2 code blocks to the server to be turned into SVG. The built app is embedded in the Go binary, so deployment is one file. See [Architecture](./Architecture.md).

## Recommendations And Reasons

### Delivery model: web app first

- The goal is "any device on my LAN", including an iPad. A browser is the only client that every one of those devices already has. iPadOS cannot run Electron, Wails, or Tauri desktop apps.
- A server on the host that owns the files (and the network mounts) avoids giving each client its own access to the shares.
- A desktop wrapper can be added later around the same server and UI. See [Desktop app option](#desktop-app-option).

### Backend: Go vs Python

**Decision: Go** (confirmed by the owner 2026-10-11, mainly for native D2 support). Python was the second choice. The backend's job is small (list directories, stream files, render D2, watch files) and close to the CLI-style Go the owner already uses.

| Factor | Go | Python (FastAPI 0.143) |
| --- | --- | --- |
| D2 rendering | **Native**: D2 is written in Go and the official `d2lib`/`d2svg` packages are imported directly. No external tools. | Must shell out to the `d2` CLI (install it on every host) or run the D2 WASM build in Node. Extra process per render and an extra install dependency. |
| Deployment | **One static binary** with the UI embedded. Cross-compiles to Linux x86-64/ARM64 (NAS, Raspberry Pi), Windows, and macOS. | Needs a Python runtime + venv, or Docker, plus the `d2` binary. |
| File watching | `fsnotify` (mature) | `watchfiles` (mature) |
| Concurrency (SSE, slow mounts, timeouts) | Goroutines and `context` timeouts fit naturally. | async works, but blocking filesystem calls on slow SMB mounts need thread offloading. |
| Desktop path later | Wails v3 reuses the Go backend directly. | Electron/Tauri with a Python sidecar. |
| Owner familiarity | Comfortable (CLI-focused) | Strong |

The deciding factor is D2. Its only first-class library is Go, and the browser/WASM package (`@terrastruct/d2` 0.1.33) has not been updated since August 2025 and is about 60 MB unpacked. That is a poor fit for an iPad. Rendering D2 on the server in Go keeps the client light and uses the current D2 release.

**iPad note:** the backend language makes no difference to iPad access. The iPad is only a Safari client either way. What matters for the iPad is the frontend (responsive layout, Safari compatibility) and not downloading heavy WASM to the device. Server-side D2 helps with the second point.

### Frontend: React + TypeScript + Vite

- React was named as the preferred UI library. React 19 has a mature ecosystem for Markdown (unified/remark/rehype), and Vite 8 gives fast builds and a static `dist/` that Go can embed.
- TypeScript catches API-contract mistakes between the server and the UI. The project uses TypeScript 6.0 (the Vite template's pin), not the Go-native TypeScript 7, until `typescript-eslint` officially supports 7 (D-17).
- React Router provides bookmarkable URLs for every path (FR-6). TanStack Query handles caching and refetching of listings and files, and invalidates them when SSE change events arrive.

### Markdown rendering: client-side unified pipeline

- `react-markdown` + `remark-gfm` covers CommonMark and GFM. `rehype-sanitize` handles safe inline HTML (FR-3.5). Custom component overrides let `mermaid`/`d2` code blocks become diagram components, and turn relative links/images into in-app navigation and file URLs (FR-2.3).
- Shiki gives VS Code-quality highlighting with light/dark themes. Languages are loaded on demand to keep the bundle small.
- **Why not render on the server with goldmark?** Mermaid has to run in a browser anyway, and the remark/rehype ecosystem (alerts, math, slugging, sanitizing) is richer, and custom remark plugins are the natural home for future voice-over script extensions (see [Requirements](./Requirements.md#future-voice-over-script-extensions)). Rendering on the client also keeps the server a simple file API, and leaves the door open to a future "open a folder from this device" mode that needs no server.

### Diagrams

- **Mermaid 12.1 renders client-side.** It is the reference implementation and is browser-only. It is lazy-loaded only when a page contains a Mermaid block, because the bundle is large.
- **D2 renders server-side via `github.com/d2lang/d2` v0.9.0.** The client POSTs the D2 source and theme to `/api/render/d2` and receives an SVG. Results are cached by a hash of the source and options (FR-4.8). Dagre is the default layout and ELK is optional. Both are open source; TALA is proprietary and excluded.
- **Note:** the D2 Go module path is now `github.com/d2lang/d2`. The older `oss.terrastruct.com/d2` path stops at v0.7.2 and must not be used.
- Rendered SVG is inserted after sanitizing, or placed inside an isolated `<img>`/`<object>`, to keep diagram output from executing scripts.

### Live reload: fsnotify + SSE + polling fallback

- `fsnotify` uses inotify/FSEvents/ReadDirectoryChangesW on local disks. SMB/NFS mounts often deliver no events, so the server polls modification times for watched paths on network mounts (FR-5.3).
- SSE (one long-lived HTTP response) is simpler than WebSockets, works through any proxy, and reconnects automatically in Safari.

### Network drives

- Shares are mounted on the host by the OS (`/etc/fstab` CIFS/NFS, autofs, Windows mapped drives) and listed as roots. This was chosen over a built-in SMB client. The only Go SMB library (`hirochachacha/go-smb2`) has had no release since 2022, and an in-app client would need credential storage.
- Every filesystem call on a mount gets a timeout through `context`, so a dead mount returns an error instead of hanging the UI (FR-1.9).

### Testing

- Go: table-driven tests for path resolution and security (traversal, symlink escape), listing, and D2 rendering. `httptest` for the API.
- Vitest for the Markdown pipeline (link rewriting, sanitizing, diagram block detection).
- Playwright end-to-end tests in WebKit (closest automated proxy for iPad Safari), Chromium, and Firefox, plus manual checks on a real iPad.

### Deployment

**Target (decided 2026-10-11): Docker Compose on a VM server.**

```text
NAS (SMB/NFS share)
  -> mounted on the VM by the OS (fstab/autofs), e.g. /mnt/nas/markdown
    -> bind-mounted read-only into the container, e.g. /data/markdown
      -> configured as a root, e.g. MDV_ROOTS=markdown=/data/markdown
```

- Multi-stage `Dockerfile`: a `node` stage runs `vite build`. A `golang` stage builds a static binary (`CGO_ENABLED=0`) with the SPA embedded. The runtime is distroless `static` running as a non-root user.
- `compose.yaml`: one service with a published port, a read-only bind of the parent of the NAS mount points with `propagation: rslave` (late mounts and remounts appear in the container), environment-based config, `restart: unless-stopped`, and a healthcheck running `mdv healthcheck` against `/healthz` (distroless has no curl). Hardening: `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`. No internet access is needed at runtime.
- The container user's UID/GID must be able to read the NAS mount on the VM. Make it configurable (`user:` in Compose) to match the mount's ownership. Compose reads `MDV_UID`/`MDV_GID` (default `1000:1000`; the real NAS values are still open) and `MDV_PORT` (default `8080`). Images: `node:24.21-bookworm-slim`, `golang:1.27.2-bookworm`, `gcr.io/distroless/static-debian12:nonroot`.
- **Live reload:** files changed on the NAS by other machines do not generate inotify events inside the container. Roots on network mounts therefore default to mtime polling (configurable interval), with fsnotify used only when a root is marked local.
- Configuration: environment variables only, set in `compose.yaml` (a config file is deferred, D-20). Example: `MDV_LISTEN=:8080`, `MDV_ROOTS=markdown=/data/markdown`, `MDV_POLL_INTERVAL=2s`.
- `make build` / `make docker` wrap the builds. The plain binary still works for local development without Docker. Images are built for linux/amd64 (the VM); arm64 is optional.

## Desktop App Option

Deferred to post-MVP. Options in order of preference:

1. **No wrapper.** Run the server locally and open a browser tab, or install it as a web app (Chrome/Edge "Install app", Safari "Add to Dock"/"Add to Home Screen"). Costs nothing to build and gives most of the benefit.
2. **Wails v3** (Go + system WebView). Reuses the Go backend and React UI directly and produces a small binary. Currently **v3.0.0-beta.28**; reconsider once it is stable.
3. **Electron 44.** Mature and consistent across platforms (bundles Chromium). Would run the Go server as a sidecar process and load its URL. The installer is large (~100+ MB), but it is the safe fallback if Wails v3 is still in beta.
4. Tauri v2. Small and mature, but its native side is Rust, which adds a third language for little gain over Wails.

## Alternatives Considered

- **Existing tools** (Hads, mdview, Markbrowse, Veldoc, MarkdownManager): several already serve folders with Mermaid, but none supports D2, live reload over network mounts, and an iPad-first UI together. They are useful as UX references.
- **Python/FastAPI backend:** viable, but rejected for D2 dependency and deployment reasons (see above).
- **Node.js backend:** one language end to end, but D2 would still need WASM or a CLI, and it is not one of the owner's preferred languages.
- **Java/Spring:** familiar to the owner, but heavyweight for a small file server, as the owner already noted.
- **Server-side Markdown (goldmark v1.8):** see the reasoning above. Kept as a fallback if client rendering performance on the iPad proves inadequate.

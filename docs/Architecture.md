# Project Architecture

## Purpose

High-level architecture for the LAN Markdown viewer. Detailed API contracts and module layout are finalized in the planning phase ([Implementation Plan](./Implementation.md)). This document reflects the Go backend chosen in [Tech Stack](./Tech-Stack.md).

## System Diagram

```mermaid
flowchart LR
    subgraph Clients["LAN clients"]
        iPad["iPad Safari"]
        Desktop["Desktop browsers"]
        Phone["Phone browsers"]
    end

    subgraph Host["VM: Docker Compose"]
        subgraph Server["Go server container (single binary)"]
            Static["Embedded React SPA (embed.FS)"]
            API["JSON API (/api/...)"]
            D2["D2 renderer (d2lib + d2svg) + SVG cache"]
            Watch["Watcher (fsnotify + polling)"]
            SSE["SSE event stream (/api/events)"]
            Guard["Root/path guard (read-only)"]
        end
        Local[("Local folders")]
        Mounts[("NAS mounts (VM, bind-mounted :ro)")]
    end

    Clients -- "HTTP: SPA, API, SSE" --> Server
    API --> Guard
    Watch --> Guard
    Guard --> Local
    Guard --> Mounts
    Watch --> SSE
    API --> D2
```

## Request Flow: Viewing A Markdown File

```mermaid
sequenceDiagram
    participant B as Browser (React SPA)
    participant S as Go server
    participant FS as Filesystem / mount

    B->>S: GET /api/file?root=docs&path=guide/intro.md
    S->>S: Resolve + validate path inside root
    S->>FS: read (with timeout)
    FS-->>S: bytes
    S-->>B: text/markdown (+ ETag, mtime)
    B->>B: remark/rehype -> React tree (sanitized)
    B->>B: mermaid blocks -> render in browser (lazy-loaded)
    B->>S: POST /api/render/d2 {source, theme, layout}
    S->>S: hash lookup / d2lib.Compile + d2svg.Render
    S-->>B: image/svg+xml
    B->>S: GET /api/events?root=docs&path=guide/intro.md (SSE)
    FS-->>S: change (fsnotify or poll)
    S-->>B: event: changed
    B->>S: refetch file (TanStack Query invalidation)
```

## Components

| Component | Responsibility |
| --- | --- |
| Config | Loads roots (name → absolute path), listen address, poll interval, size limits, and per-root mount hints (watch vs. poll). |
| Root/path guard | Turns `(root, relative path)` into a real path. Rejects `..`, absolute paths, and symlinks that resolve outside the root. Every file access goes through this. |
| Listing API | Directory entries with type, size, mtime. Paginated or streamed for large folders. Applies timeouts. |
| File API | Serves raw bytes with a content type, ETag/Last-Modified, and range support for media. Serves HTML/SVG files with a restrictive CSP or as attachments. |
| D2 renderer | Compiles D2 source to SVG with dagre/ELK. Bounded concurrency and timeout per render. LRU cache keyed by hash. |
| Watcher + SSE | Subscribes each client to the paths it is viewing. Uses fsnotify on local disks and mtime polling on network mounts. Sends coalesced change events. |
| SPA: Shell | Layout, theme, responsive sidebar drawer, routing (`/view/:root/*`). |
| SPA: Browser | Root list, folder listing, breadcrumbs, filter, workspace tree. |
| SPA: Document view | Markdown pipeline, link/image rewriting, TOC, Mermaid and D2 diagram components, error boundaries. |

## Proposed HTTP API (draft)

| Method & path | Purpose |
| --- | --- |
| `GET /api/roots` | List configured roots (names only, never host paths). |
| `GET /api/list?root=&path=` | Directory listing. |
| `GET /api/file?root=&path=` | Raw file contents. |
| `POST /api/render/d2` | Render D2 source to SVG. |
| `GET /api/events?root=&path=` | SSE stream of change events for a file or folder. |
| `GET /healthz` | Health check. |
| `GET /*` | SPA assets with fallback to `index.html`. |

## Security Model

- Trusted LAN, no authentication (owner decision). Read-only. Host paths are never shown to clients, only `root` names and relative paths.
- Markdown HTML is sanitized. Diagram SVG is sanitized or isolated. User-supplied HTML files never run in the app origin.
- Binds to a configured address. The README warns against port-forwarding it or exposing it publicly.

# Project Requirements

## Purpose

A self-hosted, web-based Markdown viewer for a home/local network. One server process runs on a host machine and exposes that machine's folders, including network shares mounted on it, to any device on the LAN through a browser (iPad, phone, laptop, desktop). It renders Markdown with GitHub-style fidelity, including Mermaid and D2 diagrams, and refreshes automatically when files change.

## Related Documents

- [Tech Stack](./Tech-Stack.md)
- [Architecture](./Architecture.md)
- [Implementation Plan](./Implementation.md)
- [Diagrams](./diagrams/)
- Research notes and sources: [agents/Research.md](../agents/Research.md)
- Decision log: [agents/Decisions.md](../agents/Decisions.md)

## Users And Environment

- Primary user: the project owner, on a trusted home LAN.
- Client devices: iPad (Safari) is a first-class target. Also desktop Chrome, Firefox, Safari, Edge, and phone browsers.
- Server host: any always-on or desktop machine (Linux first; Windows/macOS should work). Network drives are mounted on this host with OS tooling (SMB/CIFS, NFS).

## Decisions Already Made

See [agents/Decisions.md](../agents/Decisions.md) for rationale.

| Topic | Decision | Status |
| --- | --- | --- |
| Delivery model | Web application served on the LAN; desktop wrapper deferred | Decided |
| File access | Server host filesystem + shares mounted on that host | Decided |
| Access control | None (trusted LAN); read-only; restricted to configured roots | Decided |
| Scope | Viewer only, with live reload; no editing | Decided |
| Backend language | Go (single binary, native D2 library) | Decided (2026-10-11) |
| Deployment | Docker Compose on a VM; NAS mounted on the VM and bind-mounted read-only into the container | Decided (2026-10-11) |
| Desktop app | Deferred to post-MVP; options documented in Tech Stack | Deferred |
| Voice-over script extensions | Considered after MVP; see [Future: Voice-Over Script Extensions](#future-voice-over-script-extensions) | Deferred |

## Key Features

1. Browse configured root folders on the server host, including mounted network shares.
2. Open a folder as a workspace with a navigable file tree and working relative links.
3. Render Markdown (CommonMark + GitHub Flavored Markdown).
4. Render Mermaid and D2 diagrams, both inline in Markdown and as standalone diagram files.
5. Live reload when the viewed file or folder changes on disk.
6. Responsive, touch-friendly UI usable on an iPad.
7. Project files (`*.mdv.yaml`) that gather folders and files for a course or project and carry display settings, layered over global preferences and per-device adjustments.
8. A polished reading experience: reading styles and bundled open-source fonts, a focus mode for reading voice-over scripts, and read-time estimates.

## Functional Requirements

Priority: **M** = MVP must-have, **S** = should-have (post-MVP refinement), **C** = could-have / future.

### FR-1 File Browsing

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-1.1 | Server exposes one or more configured **roots** (absolute paths, each with a display name). Nothing outside the roots is reachable. | M |
| FR-1.2 | Browse folders within a root: list subfolders and files with name, size, and modified time. Sort by name (default) or date. | M |
| FR-1.3 | All file types are listed. Markdown files are highlighted, and a toggle can limit the list to Markdown/diagram files. | M |
| FR-1.4 | Hidden files/folders (dot-prefixed) are hidden by default, with a toggle to show them. | S |
| FR-1.5 | Non-Markdown files: images display inline, text/code files show with syntax highlighting, and other files offer a raw download/open link. | M (images, text), S (highlighting) |
| FR-1.6 | Breadcrumb navigation for the current path. | M |
| FR-1.7 | Filter files by name within the current folder/workspace. | M |
| FR-1.8 | Full-text search across Markdown files in a workspace. | C |
| FR-1.9 | Slow or unavailable network mounts must not hang the UI. Directory reads time out with a clear error. | M |
| FR-1.10 | Symlinks are followed only if the resolved target stays inside a configured root. | M |

### FR-2 Folder Workspace

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-2.1 | "Open folder" turns any browsed folder into a workspace: a collapsible sidebar tree of the folder; the tree follows the browse "Markdown and diagrams only" toggle (shared per device, default off). | M |
| FR-2.2 | Opening a folder shows its `README.md` / `index.md` when present, otherwise a file listing. | M |
| FR-2.3 | Relative links between Markdown files navigate inside the viewer. Relative image paths resolve against the file's folder. | M |
| FR-2.4 | Links to headings (`file.md#section`) scroll to the anchor. | M |
| FR-2.5 | Per-document table of contents built from headings. | S |
| FR-2.6 | Recently opened folders/files list (stored per browser). | S |
| FR-2.7 | Pinned/favourite folders shared across devices (stored server-side). Superseded by project files (FR-7, D-30): a project stored on the NAS is shared across devices with no server write path. | C |
| FR-2.8 | A file opened outside a workspace or project (from Recent, a link, or a bookmark) shows the supported files of its folder in the sidebar, so siblings are one tap away. | S |

### FR-3 Markdown Rendering

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-3.1 | CommonMark plus GFM: tables, task lists (read-only), strikethrough, autolinks, footnotes. | M |
| FR-3.2 | Syntax-highlighted fenced code blocks, with a copy-code button. | M (highlight), S (copy) |
| FR-3.3 | Heading anchor IDs compatible with GitHub's slug rules. | M |
| FR-3.4 | YAML front matter is not rendered as body text. Optionally show it as a collapsible metadata panel. | M (hide), S (panel) |
| FR-3.5 | Inline HTML is supported but **sanitized** (no scripts, event handlers, or iframes). | M |
| FR-3.6 | Math (`$...$`, `$$...$$`) via KaTeX. | S |
| FR-3.7 | GitHub-style alerts/admonitions (`> [!NOTE]`). | S |
| FR-3.8 | Light and dark themes, following the OS by default with a manual override. | M |
| FR-3.9 | Print-friendly / export-to-HTML view. | C |

### FR-4 Diagrams

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-4.1 | Fenced ` ```mermaid ` blocks render as Mermaid diagrams. | M |
| FR-4.2 | Fenced ` ```d2 ` blocks render as D2 diagrams. | M |
| FR-4.3 | Standalone diagram files (`.mmd`, `.mermaid`, `.d2`) render as a full-page diagram. | M |
| FR-4.4 | A diagram with a syntax error shows an inline error message and the source, and does not break the rest of the page. | M |
| FR-4.5 | Diagrams follow the active light/dark theme. | S |
| FR-4.6 | Toggle between the rendered diagram and its source. | S |
| FR-4.7 | Pan/zoom and an "open full screen" view for large diagrams (pinch-zoom on iPad). | S |
| FR-4.8 | Rendered D2 output is cached by content hash, so unchanged diagrams are not re-laid-out. | S |
| FR-4.9 | D2 layout engines: dagre (default) and ELK. TALA (proprietary) is out of scope. | M (dagre), S (ELK) |
| FR-4.10 | Optional download of a diagram as SVG/PNG. | C |

### FR-5 Live Reload

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-5.1 | When the currently viewed file changes on disk, the view re-renders automatically and keeps the scroll position where practical. | M |
| FR-5.2 | When files are added, removed, or renamed in the open workspace, the sidebar tree updates. | S |
| FR-5.3 | Network mounts that don't deliver filesystem change events (common for SMB/NFS) fall back to polling at a configurable interval. | M |

### FR-6 Navigation And URLs

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-6.1 | Every folder and file has a stable, bookmarkable URL (for example `/view/<root>/<path>`), so links can be shared between devices. | M |
| FR-6.2 | Browser back/forward works for all navigation. | M |
| FR-6.3 | The app can be added to the iPad/phone home screen as a web app with its own icon and title. | S |

### FR-7 Project Files

A project file is a YAML file named `*.mdv.yaml` inside a root. The owner writes it in any editor; mdv only reads it (D-30).

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-7.1 | A project file (schema `version: 1`) has an optional `name`, an optional `open` file shown first, an `include` list of folders and files, and an optional `settings` block (FR-8.1). Paths are relative to the project file's folder. | S |
| FR-7.2 | Opening a project file from a listing opens project mode: the sidebar lists the included folders (expandable trees) and files, and the view shows `open` (else the first included Markdown file, else the project's entries). The project stays active while navigating to its entries and its `settings` apply while it is active. | S |
| FR-7.3 | References that cannot be resolved (missing paths, a file where a folder was expected, paths that leave the root, unknown keys, invalid setting values, cross-root references before FR-7.8) are listed as warnings in the project panel. Valid entries still work. YAML syntax or schema-version errors show an error with the line and the project is not applied. | S |
| FR-7.4 | Changes to the open project file apply live (live reload). | S |
| FR-7.5 | Project files are listed with their own kind and icon. A "Projects only" filter limits a listing to project files. | S |
| FR-7.6 | A "Recent projects" list in the sidebar (per browser, like FR-2.6) reopens recent projects. | S |
| FR-7.7 | Project paths get the same root and path guards as every other request (no `..`, no symlink escapes, no host paths in responses). Project files have size and complexity limits. | S |
| FR-7.8 | Cross-root references (`<root>:<path>` in `include` and `open`). Until built, they are reported as unsupported warnings (FR-7.3). | C |
| FR-7.9 | Save device adjustments back to the project file (the first write path). | C |

### FR-8 Display Settings And Preferences

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-8.1 | Settings: `theme` (`system`/`light`/`dark`), `style` (reading style, FR-9.1), `font` and `codeFont` (font category or bundled family, FR-9.3), `fontSize` (px), `lineHeight`, `contentWidth` (`narrow`/`normal`/`wide`/`full`), `markdownOnly`, `showHidden`, `sort` (`name`/`date`), `readTime` (FR-9.8). | S |
| FR-8.2 | Global preferences: an optional server-side `preferences.yaml` with the same `settings` keys, applying to every device. A missing file means built-in defaults; an invalid file logs a warning, falls back to defaults and shows a notice. | S |
| FR-8.3 | Precedence, lowest to highest: built-in defaults, global preferences, the active project, this device's adjustments. Leaving a project restores the lower layers. | S |
| FR-8.4 | Device text size: A−/A+/reset controls and Ctrl/Cmd `+`, `−`, `0`. The adjustment is a per-device scale relative to the resolved `fontSize` (for example 110%), stored in the browser. It never changes the project or preferences file. | S |
| FR-8.5 | Device choices for theme and the listing toggles (`markdownOnly`, `showHidden`, `sort`) override the resolved settings on that device, with a way to return to the project/preferences default. | S |

### FR-9 Reading Experience

Inspired by how Typora, Obsidian and VS Code Markdown preview extensions present Markdown. mdv's styles are its own CSS, not copies of those themes (D-31).

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-9.1 | Reading styles: a small set of presets (for example the current GitHub-like style, a clean sans style, a serif "book" style and a large airy style), each with light and dark variants. A style sets the fonts, sizes, spacing, heading treatment, and code and table looks. | S |
| FR-9.2 | Bundled open-source fonts (SIL OFL 1.1) served by mdv itself, with no internet access: woff2 files, Latin and Latin Extended subsets, about 3 MB in total at most. A device fetches a font only when the active style or setting uses it, and its browser caches it for later visits. | S |
| FR-9.3 | Font categories `sans`, `serif`, `mono` and `system` resolve to a bundled family first and then to good local fonts for each OS (for example Charter or Georgia for serif on Apple devices). A specific bundled family can also be named. | S |
| FR-9.4 | Focus mode shows only the current file's content: no sidebar, toolbar, breadcrumbs or TOC. Toggle it with a toolbar button, a keyboard shortcut or `?focus=1` (bookmarkable, also from the home screen); exit with Esc or a small control that appears on tap or mouse movement. Live reload and the scroll position keep working. Text size shortcuts (FR-8.4) still work. | S |
| FR-9.5 | Focus mode extras for recording: keep the screen awake (Screen Wake Lock, where supported), optional full screen (Fullscreen API, where supported), and no animations or pop-ups (for example no copy buttons) while it is on. | S |
| FR-9.6 | Read-time estimate for Markdown files, computed in the browser when a file opens or reloads: word count and minutes, shown near the top of the document. It always excludes front matter, diagrams, math, HTML comments and image text. Headings and code blocks are excluded by default and can be included (FR-9.8). | S |
| FR-9.7 | Per-section read times next to each heading in the table of contents. | S |
| FR-9.8 | Read-time settings, set in global preferences and overridable per project (not per device): `readTime.wpm` (default 160, the owner's measured script-reading speed), `readTime.includeHeadings` (default false) and `readTime.includeCode` (default false, for projects whose scripts are read aloud from code blocks). | S |

## Non-Functional Requirements

| ID | Category | Requirement |
| --- | --- | --- |
| NFR-1 | Compatibility | Fully usable in current iPad Safari (iPadOS 18+) and current desktop Chrome, Edge, Firefox, Safari. Usable on phones. |
| NFR-2 | Responsiveness | Layout adapts from phone to wide desktop. On narrow screens the sidebar collapses into a drawer. Touch targets are at least 44px. |
| NFR-3 | Performance | Folder listings of up to 10,000 entries stay responsive (lazy-loaded tree, virtualized long lists). A typical document (under 1 MB) with up to 10 diagrams renders in under 2 seconds on an iPad. Large files show a size warning with a "load anyway" button (`force=1`) before rendering (MVP, D-21). |
| NFR-4 | Security | Read-only. Only configured roots are accessible. Path traversal and symlink escapes are rejected server-side. Markdown HTML is sanitized. Raw HTML files are served with a restrictive Content-Security-Policy or as downloads, never executed in the app origin. Binds to a configurable address. Documentation warns against exposing it to the internet. |
| NFR-5 | Offline/LAN | No runtime dependency on the internet or CDNs. All assets are bundled and served by the server. No telemetry. |
| NFR-6 | Deployment | Runs as a Docker Compose service on a VM server. NAS shares are mounted on the VM and bind-mounted read-only into the container. Configured by environment variables set in `compose.yaml`. Restarts automatically and exposes a healthcheck. |
| NFR-7 | Portability | The server builds and runs on Linux (x86-64, ARM64). Windows and macOS are supported on a best-effort basis. |
| NFR-8 | Observability | Structured logs (request, error, slow-mount timeouts) to stdout. A health endpoint is available for service monitors. |
| NFR-9 | Maintainability | Typed frontend (TypeScript). Server, rendering, and UI concerns are separated. Automated tests cover path safety, rendering, and key UI flows. |
| NFR-10 | Licensing | All dependencies under permissive or weak-copyleft licenses (MIT, BSD, Apache-2.0, MPL-2.0). Bundled fonts under SIL OFL 1.1, with their license files shipped alongside them. |

## Out Of Scope (Initial Release)

- Editing, creating, renaming, or deleting files.
- Authentication, user accounts, and TLS/HTTPS. A reverse proxy can add these later if needed.
- Exposure to the public internet.
- A built-in SMB/NFS client (shares are mounted on the host by the OS instead).
- Opening folders that live on the client device (browser File System Access API). This is a possible future feature for Chromium desktop browsers only.
- Desktop app packaging (Electron/Wails/Tauri). This is a post-MVP option; see [Tech Stack](./Tech-Stack.md#desktop-app-option).

## Future: Voice-Over Script Extensions

The owner wants to consider Markdown additions that help when a document is a voice-over script. This is **not in MVP scope**. Research and selection come after MVP. Each item below is a priority **C** candidate. Extensions should still read cleanly as plain Markdown in other tools.

| ID | Candidate | Notes |
| --- | --- | --- |
| VO-1 | Speaker/role labels | Mark lines by speaker (for example `NARRATOR:` or a directive). Each speaker gets its own colour, with a filter to show one speaker's lines. |
| VO-2 | Delivery directions | Inline cues such as `[pause 2s]`, `(softly)`, or `[beat]`, shown in a distinct style, with a toggle to hide them while reading. |
| VO-3 | Pronunciation guides | Annotate hard words with a phonetic spelling (ruby-style text above the word, or a tooltip). |
| VO-4 | Timing estimates | Word count and estimated read time per section and per document at a configurable words-per-minute rate. Optional target-duration warnings. Document and per-section read time are now FR-9.6 and FR-9.7; VO-4 adds target-duration warnings on top. |
| VO-5 | Teleprompter mode | Builds on focus mode (FR-9.4). Auto-scrolls the document at the read-time rate (FR-9.8 `wpm`, so the same inclusion rules apply) by default. The speed can be adjusted while it runs. Spacebar starts and pauses. The mouse wheel (and touch drag on iPad) moves forward or backward, with auto-scroll continuing from the new position. Later options: hidden directions, mirroring. Planned as FUT9. |
| VO-6 | Audio/visual cue columns | Two-column A/V script layout (visual or B-roll cues beside narration). |
| VO-7 | Line/take numbering | Stable line numbers for referencing takes during recording sessions. |
| VO-8 | SSML export | Export to SSML for text-to-speech previews. |

Conventions to research before designing a syntax: Fountain (screenplay format), SSML, CriticMarkup, Pandoc fenced divs, and the generic directives proposal (`remark-directive`). The client-side remark/rehype pipeline in the [Tech Stack](./Tech-Stack.md) is the intended place to add these as plugins.

## Success Criteria

1. From an iPad on the LAN, the owner can open the server URL, browse to a folder on a mounted network share, open it as a workspace, and read its Markdown with working relative links and images.
2. A document containing both Mermaid and D2 blocks renders both diagrams correctly in iPad Safari and desktop Chrome/Firefox.
3. Editing a file on the host (in any editor) updates the open view within about 2 seconds for local disks, or within the polling interval for network mounts.
4. Requests for paths outside configured roots, including `..` and symlink escapes, are rejected (covered by automated tests).
5. `docker compose up -d` on the VM starts the viewer with the NAS roots mounted read-only. It runs without internet access and survives restarts.

## Open Questions

- Which fonts and reading styles to ship (FR-9.1 to FR-9.3): RX0 proposes a shortlist for the owner to pick from.
- Desktop app: once the web app works, is a wrapper still wanted, or is a browser tab / home-screen web app enough?
- Voice-over extensions: which of the candidates below are worth building, and is there an existing script convention to follow?

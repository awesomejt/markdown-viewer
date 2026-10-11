# Research

## Purpose

Track AI-assisted research and references - saved for later reference if needed.

## 2026-10-11: Tech Stack Research

### Findings

- **D2 Go library**: the official module is `github.com/d2lang/d2`, latest v0.9.0 (2026-09-07), MPL-2.0. The legacy path `oss.terrastruct.com/d2` stops at v0.7.2. The library usage is `d2lib.Compile` + `d2svg.Render`, with examples in the repo under `docs/examples/lib`. The library is pure Go, with dagre and ELK layouts.
- **D2 in the browser**: `@terrastruct/d2` (D2.js, WASM + web worker) latest 0.1.33, published 2025-08-17, about 60 MB unpacked. It is stale compared with the Go release and heavy for mobile.
- **Mermaid**: npm `mermaid` 12.1.0 (2026-10-02), MIT. Browser-only rendering. v11.13 (Apr 2026) added Venn/Ishikawa diagrams.
- **Desktop frameworks (2026)**: Electron 44 (bundles Chromium). Tauri v2 (Rust, system WebView, mature). Wails v3 (Go, system WebView) still beta: latest `v3.0.0-beta.28`.
- **SMB from Go**: `github.com/hirochachacha/go-smb2` last release v1.1.0 (2022-03). This supports mounting shares at the OS level instead.
- **Existing self-hosted Markdown browsers**: Hads (Node, Mermaid, search), mdview (Go CLI, Mermaid, directory browser), Markbrowse, Veldoc, MarkdownManager (PHP). None found combining D2 + Mermaid + network-mount live reload + iPad-first UI.

### Versions Checked (npm registry / Go proxy / PyPI, 2026-10-11)

| Package | Version | License |
| --- | --- | --- |
| Go | 1.27.2 (1.26.9 previous) | BSD |
| github.com/d2lang/d2 | v0.9.0 | MPL-2.0 |
| github.com/fsnotify/fsnotify | v1.10.1 | BSD-3 |
| github.com/yuin/goldmark | v1.8.6 | MIT |
| github.com/wailsapp/wails/v3 | v3.0.0-beta.28 | MIT |
| goreleaser v2 | v2.18.3 | MIT |
| react | 19.3.0 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| vite | 8.3.4 | MIT |
| react-router | 8.4.0 | MIT |
| @tanstack/react-query | 5.104.1 | MIT |
| react-markdown | 10.1.0 | MIT |
| remark-gfm / remark-frontmatter / remark-math | 4.0.1 / 5.0.0 / 6.0.0 | MIT |
| rehype-raw / rehype-sanitize / rehype-slug / rehype-katex | 7.0.0 / 6.0.0 / 6.0.0 / 7.0.1 | MIT |
| shiki / @shikijs/rehype | 4.5.0 | MIT |
| mermaid | 12.1.0 | MIT |
| @terrastruct/d2 | 0.1.33 | MPL-2.0 |
| katex | 0.19.0 | MIT |
| svg-pan-zoom | 3.6.2 | BSD-2 |
| vitest | 5.0.3 | MIT |
| @playwright/test | 1.64.0 | Apache-2.0 |
| electron | 44.7.0 | MIT |
| fastapi (PyPI) | 0.143.0 | MIT |

### Sources

- D2 Go module: https://pkg.go.dev/github.com/d2lang/d2
- D2 library packages: https://pkg.go.dev/github.com/d2lang/d2/d2lib
- D2.js README: https://cdn.jsdelivr.net/npm/@terrastruct/d2@0.1.33/README.md
- D2 WASM package: https://pkg.go.dev/github.com/d2lang/d2/d2js/d2wasm
- Mermaid releases: https://gittrend.io/repo/mermaid-js/mermaid
- Mermaid CLI (Arch package): https://archlinux.org/packages/extra/any/mermaid-cli/
- Desktop framework comparison (2026): https://www.digitalapplied.com/blog/desktop-apps-web-stack-tauri-electron-deno-wails-2026
- Wails vs Tauri: https://toolradar.com/compare/wails-vs-tauri
- Hads: https://github.com/Julienbideau/hads
- mdview: https://pkg.go.dev/github.com/jere-mie/mdview
- MarkdownManager: https://piefed.nullspace.lol/post/77547
- Markbrowse: https://peerlist.io/anantshri/project/markbrowse
- Veldoc: https://awesome.ecosyste.ms/projects/github.com%2Faredoff%2Fveldoc

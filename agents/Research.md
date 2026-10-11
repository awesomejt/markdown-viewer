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

- D2 Go module: <https://pkg.go.dev/github.com/d2lang/d2>
- D2 library packages: <https://pkg.go.dev/github.com/d2lang/d2/d2lib>
- D2.js README: <https://cdn.jsdelivr.net/npm/@terrastruct/d2@0.1.33/README.md>
- D2 WASM package: <https://pkg.go.dev/github.com/d2lang/d2/d2js/d2wasm>
- Mermaid releases: <https://gittrend.io/repo/mermaid-js/mermaid>
- Mermaid CLI (Arch package): <https://archlinux.org/packages/extra/any/mermaid-cli/>
- Desktop framework comparison (2026): <https://www.digitalapplied.com/blog/desktop-apps-web-stack-tauri-electron-deno-wails-2026>
- Wails vs Tauri: <https://toolradar.com/compare/wails-vs-tauri>
- Hads: <https://github.com/Julienbideau/hads>
- mdview: <https://pkg.go.dev/github.com/jere-mie/mdview>
- MarkdownManager: <https://piefed.nullspace.lol/post/77547>
- Markbrowse: <https://peerlist.io/anantshri/project/markbrowse>
- Veldoc: <https://awesome.ecosyste.ms/projects/github.com%2Faredoff%2Fveldoc>

## 2026-10-11: D2 Library Spike (P0.5)

Spike code: `cmd/spike-d2` (throwaway; deleted in B5, whose implementation is `internal/d2render`).

**Module and imports.** `go.mod` of v0.9.0 declares `module github.com/d2lang/d2` (Go 1.27). Imports used:
`github.com/d2lang/d2/{d2lib, d2graph, d2renderers/d2svg, d2layouts/d2dagrelayout, d2layouts/d2elklayout, d2themes/d2themescatalog, lib/log, lib/textmeasure}` and `github.com/d2lang/util-go/go2` (for `go2.Pointer`).

**Working call sequence.**

```go
ruler, _ := textmeasure.NewRuler() // reusable
renderOpts := &d2svg.RenderOpts{Pad: go2.Pointer(int64(5)), ThemeID: go2.Pointer(int64(0))}
compileOpts := &d2lib.CompileOptions{
    Ruler: ruler,
    LayoutResolver: func(string) (d2graph.LayoutGraph, error) {
        return d2dagrelayout.DefaultLayout, nil // or d2elklayout.DefaultLayout
    },
}
ctx, cancel := context.WithTimeout(log.WithDefault(context.Background()), 10*time.Second)
defer cancel()
diagram, _, err := d2lib.Compile(ctx, src, compileOpts, renderOpts)
if err != nil { /* user error text */ }
svg, err := d2svg.Render(diagram, renderOpts) // []byte
```

`log.WithDefault(ctx)` is required (the library logs through the context).

**Themes.** Neutral Default = 0 (light), Dark Mauve = 200 (dark default used), Dark Flagship Terrastruct = 201, Neutral Grey = 1. `RenderOpts.DarkThemeID` exists for a theme that follows `prefers-color-scheme`. B5 should render one SVG per theme ID (light 0, dark 200). **Layouts:** dagre and ELK, both pure Go. TALA is not imported.

**CGO and JS runtime.** None. `elk-go` is a Go port of ELK, and dagre is native Go. No goja or V8 appears in `go list -deps`. Builds work with `CGO_ENABLED=0`.

**Timings** (`arch.d2`, 1 edge; compile plus render, excluding `NewRuler`): dagre first 2.5 ms, warm 0.75 to 0.9 ms; ELK first 3.0 ms, warm 1.1 to 1.7 ms. Whole process about 17 ms. Larger diagrams were not measured; B5 tests should keep the timeout.

**Sizes** (`CGO_ENABLED=0 -trimpath -s -w`): `cmd/mdv` 1.2 MB with 0 module deps; the spike binary is 23.9 MB with 22 deps (about +22.7 MB, mostly embedded fonts and the D2 stack).

**Errors.** Compile errors are plain text with `line:col:` prefixes, one per line. For `broken.d2`: `compile: 1:1: connection missing destination` then `1:6: maps must be terminated with }`. Suitable as the 422 body.

**Context.** ELK honours cancellation (`failed to ELK layout: context deadline exceeded` with a 1 ns timeout). Dagre did NOT fail with a 1 ns timeout on the tiny input, so do not rely on ctx alone. B5 should also enforce a wall-clock limit around the call, the semaphore, and the 256 KiB source cap.

**SVG notes.** No `<script>` elements. Two `<style>` blocks. Two `@font-face` rules with `data:application/font-woff` fonts embedded, so no external fetches. Output is self-contained (8.5 KB for `arch.d2`). Still sanitize or serve through `<img>`/`<object>`, since D2 source can include links and user text.

**Determinism.** Repeated runs of the same input and options gave byte-identical SVG (same sha256), so a sha256 of source plus options is a valid cache and ETag key. IDs inside the SVG derive from a content hash; `RenderOpts.Salt` can alter them.

**Recommendations for B5.** Create one `textmeasure.Ruler` at startup and reuse it. Concurrency safety of the Ruler is unverified, so the semaphore should bound concurrent renders and a Ruler per worker is the safe fallback. Key the LRU on source plus theme ID plus layout. Pin the version in the cache key so upgrades invalidate it.

# Memory History

Archived Agent Run Log entries moved out of `MEMORY.md` to keep session start-up small. Newest first. Read only when you need the detail behind an old task; open items from these entries are summarized in `MEMORY.md` under "Known Limitations And Accepted Risks".

## Agent Run Log (archived)

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-23)

- Task: Markdown remounted diagrams and code blocks on every re-render; Sonnet coder, orchestrator reviewed the diff and ran the gates.
- Files changed: `web/src/markdown/MarkdownView.tsx` (`useMemo` for components and the `<Markdown>` element, hoisted `remarkRehypeOptions`), `web/src/markdown/MarkdownView.test.tsx` (render-stability test).
- Result: Mermaid renders once per diagram across TOC, same-props and hash re-renders; the new test fails on the old code (4 renders for 2 diagrams). `make check` exit 0 (vitest 253), `make e2e` 224 passed; logs `build/fix23-*.log`.
- Blockers or follow-up: FIX-24 re-measures NFR-3 now that the double render is gone.

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-22)

- Task: One bad image or tree sub kills live reload; Sonnet implementer, orchestrator reviewed the diff and re-ran the gates.
- Files changed: `internal/watch/hub.go` (`Sub.Low`, `overCapLocked`), `internal/api/events.go` (`lsub`), `web/src/live/logic.ts` (`capSubs` returns `{sub, lsub}`), tests in both, `e2e/tests/live.spec.ts` + `livefs` fsnotify root in `e2e/playwright.config.ts`, `Makefile` (cleans `build/e2e/livefs`), `docs/Architecture.md`.
- Result: server-side drop chosen over the client-side listing/control-char filter (covers every case in one place). `make check` exit 0, `make e2e` 224 passed. First `make check` failed on MD060 table alignment, a `WorkspaceTree` test parsing only `sub`, and staticcheck QF1006; all fixed.
- Blockers or follow-up: a normal `sub` that fails (viewed file's directory deleted on an `:fsnotify` root) still fails the stream (Known Limitations).

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-21)

- Task: Root swap escape (🔒); coded in the orchestrator, Opus security review in a subagent (3 rounds).
- Files changed: `internal/fsroot/lazy.go` (`pinPath`, `openPinned`, `HostDir`), new `nofollow_linux.go`/`nofollow_other.go`, `access.go`/`watchops.go` (`hostDirFn`), `lazy_test.go` (4 tests), `go.mod` (`golang.org/x/sys` direct), `docs/Deployment.md`, `docs/Architecture.md`.
- Result: `go run ./build/r213/_swap` prints "blocked". Review round 1 found the pin followed a pre-restart symlink and parent swaps; round 2 found `O_RDONLY` broke search-only parents (now `O_PATH`). `make check` exit 0, `make e2e` 220 passed; logs `build/fix21-*.log`.
- Blockers or follow-up: FIX-28 (flaky `TestEventsGlobalStreamCap` under `make -j`).

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.13)

- Task: Phase 2 review + NFR-3 performance check. Three parallel Opus reviewers (backend, frontend, conformance + perf); orchestrator verified each medium finding in source and re-ran the root-swap repro.
- Files changed: `TODO.md`, `MEMORY.md`, `agents/Decisions.md` (D-27), `agents/Memory-History.md` only. No source changes.
- Result: 14/15 Phase 2 requirements met, NFR-3 partial. Perf (median of 3, WebKit iPad Pro 11 emulation): 10k listing first row 121 ms, scroll-to-end 23 ms, filter key ≤ 25 ms; 459 KB doc with 5 Mermaid + 5 D2 all ready 3.7 s (chromium 1.4 s, chromium 4× CPU 5.4 s; target 2 s). `go vet`, `go test -race`, vitest 249 all green. Logged FIX-21 to FIX-27, DOC2, CH2.
- Blockers or follow-up: Perf rerun: `docker run --rm -u $(id -u):$(id -g) -v $PWD:/src -w /src/build/r213 --ipc=host -e HOME=/src/build/.cache/home -e CI=1 mcr.microsoft.com/playwright:v1.64.0-noble npx playwright test` (fixtures from `python3 build/r213/gen.py`, server `build/mdv` on 18081 with `MDV_ROOTS=perf=build/r213/perf`).

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.12)

- Task: Full Phase 2 validation run (as T2); run in the orchestrator (tool runs only, no authoring).
- Files changed: `TODO.md`, `MEMORY.md`, `agents/Memory-History.md` only.
- Result: `make check`, `go test -race ./...`, `make e2e` (220 passed), `docker compose build` all exit 0; extra Compose smoke (healthy, SPA 200, roots API, bundle contains the virtualizer); logs `build/r212/`.
- Blockers or follow-up: First smoke attempt failed only because host port 8080 is taken by another container; reran with `MDV_PORT=18080`.

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.11)

- Task: Virtualized long listings (NFR-3); done in the orchestrator without a subagent.
- Files changed: `web/src/browse/BrowseView.tsx` (`EntryList` → `VirtualEntryList` at ≥ 200 entries, `EntryRow`), `browse.css`, `web/src/workspace/WorkspaceTree.tsx` (`TREE_PAGE` 200, "Show more"), `tree.css`, `web/package.json` (`@tanstack/react-virtual` ^3.14.17, `npm audit --omit=dev` clean), unit tests, new `e2e/tests/large.spec.ts` (2,000 files in the `live` root), `docs/Architecture.md`, `docs/Tech-Stack.md`, `README.md`.
- Result: e2e 8/8 red without the change. `make check` exit 0 (249 unit), `make e2e` 220 passed; logs `build/r211-*.log`.
- Blockers or follow-up: jsdom tests must stub `HTMLElement.offsetHeight` (the virtualizer measures with it). The app has no route scroll restoration (pre-existing), so Back to a long folder does not return to the clicked row.

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.10)

- Task: Workspace tree live updates on create/delete/rename (FR-5.2); done in the orchestrator without a subagent.
- Files changed: `web/src/workspace/WorkspaceTree.tsx` (`TreeChildren` calls `useLiveSubscription(root, dir, true)`), `WorkspaceTree.test.tsx` (fake `EventSource` asserts the sub set on expand/collapse), `e2e/tests/live.spec.ts` (add, delete, rename at two tree levels), `docs/Architecture.md`, `README.md`.
- Result: component test and e2e (4/4) red without the change. `make check` exit 0, `make e2e` 212 passed; logs `build/r210-*.log`.
- Blockers or follow-up: None. Tree and image subs share the low tier (sorted, so past the cap some deep folders or images go unwatched).

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.9)

- Task: D2 ELK layout option; theme-aware re-render (FR-4.5, FR-4.9); done in the orchestrator without a subagent.
- Files changed: `internal/d2render/render.go` (resolver uses the engine name, so `d2-config.layout-engine` applies when no layout is requested; empty layout is its own cache key) + test, `internal/api/render.go` (comment), `web/src/api/client.ts` (`D2Layout`), `D2Diagram.tsx` (Layout select, `keepPreviousData`), `DiagramFigure.tsx` (`tools`, `busy`, keeps the old image until the new URL exists), `MermaidDiagram.tsx` (keeps last SVG), unit tests, `e2e/tests/diagrams.spec.ts`, `examples/d2.md`, `docs/Architecture.md`, `README.md`.
- Result: Go test red before the resolver fix; viewer-persistence test red with the old figure condition. `make check` exit 0 (245 unit), `make e2e` 208 passed; logs `build/r29-*.log`. Example checked on a live server (Auto = ELK ≠ dagre).
- Blockers or follow-up: Theme re-render already existed (F4); now it no longer flashes "Rendering…". The R2.8 "viewer closes on live reload" limitation is fixed.

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.8)

- Task: Diagram source toggle, pan/zoom, full screen, iPad pinch (FR-4.6, FR-4.7); done in the orchestrator without a subagent.
- Files changed: new `web/src/diagrams/panzoom.ts` (pure zoom/pan/pinch/wheel math), `DiagramViewer.tsx` (native modal `dialog` portaled to `body`), `DiagramFigure.tsx` (tools row), `app/app.css`, unit tests (`panzoom.test.ts`, `viewer.test.tsx`), `e2e/tests/diagrams.spec.ts`, `docs/Architecture.md`, `README.md`.
- Result: `make check` exit 0 (242 unit), `make e2e` 204 passed (synthetic touch pointers pinch on all 4 projects); logs `build/r28-*.log`.
- Blockers or follow-up: R2.9's "re-render on theme change" already exists since F4; only the ELK option remains there.

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-19)

- Task: Recent e2e flake; done in the orchestrator without a subagent.
- Files changed: `e2e/tests/recent.spec.ts` (`newestRecent` reads `mdv-recent`; `expect.poll` after each folder/file visit before moving on).
- Result: red/green shown by temporarily delaying `recordRecent` 500 ms (old spec fails, new passes on 4 projects; delay reverted). `make check` exit 0, `make e2e` 192 passed three times; logs `build/fix19-*.log`.
- Blockers or follow-up: None. Pattern for future e2e: wait on the recorded state, not on visible content, before a full `goto`.

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.7)

- Task: KaTeX math (FR-3.6) and GitHub alerts (FR-3.7); done in the orchestrator without a subagent.
- Files changed: new `web/src/markdown/alerts.ts`, `math.ts` (`useMathPlugin`, `mayHaveMath`), `katex.ts` (lazy chunk + CSS); `pipeline.ts` (remark-math, remarkAlerts, schema classes), `MarkdownView.tsx` (body waits on `ready`), `toc.ts` (TeX annotation text), `app.css`, `package.json` (`overrides.katex`), unit tests, `testdata/fixtures/docs/math.md`, `e2e/tests/markdown.spec.ts`, `examples/gfm-tour.md`, `docs/Architecture.md`, `README.md`.
- Result: 7 unit tests red with the plugins removed. `make check` exit 0 (229 unit), `make e2e` 196 passed; logs `build/r27-*.log`.
- Blockers or follow-up: FIX-20 (dev-tooling audit: smol-toml override, braces unfixed upstream).

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.6)

- Task: Table of contents (FR-2.5); done in the orchestrator without a subagent.
- Files changed: new `web/src/markdown/toc.ts` (`collectHeadings` from the rendered DOM, `mdv-toc-open`), `Toc.tsx`, `MarkdownView.tsx` (`.markdown-doc` wrapper, layout-effect heading read), `app/app.css` (sticky column at ≥ 1400 px), unit tests, `e2e/tests/markdown.spec.ts`, `docs/Architecture.md`, `README.md`.
- Result: `make check` exit 0 (220 unit), `make e2e` 192 passed twice; logs `build/r26-*.log`.
- Blockers or follow-up: First e2e run hit an unrelated `recent.spec.ts` race (logged as FIX-19). With the panel open above the body, a live reload that changes the heading count can shift the restored scroll.

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.5)

- Task: Syntax highlighting for standalone text/code files (FR-1.5); done in the orchestrator without a subagent.
- Files changed: `web/src/markdown/highlight.ts` (`languageForFile`: extension → fence alias/id, plus `h`/`hpp`/`jsonc`/`kts`/`pyi`...), new `web/src/fileview/CodeFile.tsx` (lazy `CodeBlock` reuse, plain above 100,000 chars), `ViewFileView.tsx`, `fileview.css`, unit/component tests, `e2e/tests/workspace.spec.ts`, `docs/Architecture.md`, `README.md`.
- Result: new e2e red (chromium) with the old plain view. `make check` exit 0 (215 unit), `make e2e` 184 passed; logs `build/r25-*.log`.
- Blockers or follow-up: Extensionless names (`Makefile`, `Dockerfile`) stay plain, as the server classifies them `other`.

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.4)

- Task: Web-app manifest and home-screen icons (FR-6.3); done in the orchestrator without a subagent.
- Files changed: new `web/icons/icon.svg` + `mkicons.sh` (rsvg-convert → committed `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`), `web/public/manifest.webmanifest`, `favicon.svg` (M-arrow mark replaces the Vite logo), `web/index.html` (manifest, touch icon, Apple meta, two `theme-color` metas), `app/theme.ts` (`THEME_COLOR`, `applyTheme` syncs the metas), `internal/web/web.go` (`.webmanifest` → `application/manifest+json`), unit/Go tests, `e2e/tests/shell.spec.ts`, `docs/Architecture.md`, `docs/Deployment.md`.
- Result: Go test red (text/plain) before the MIME fix. `make check` exit 0, `make e2e` 180 passed; logs `build/r24-*.log`.
- Blockers or follow-up: Standalone mode hides Safari's back button and reload; V1 should add to Home Screen on the iPad and check icon, title, status bar and back navigation.

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.3)

- Task: Recent files/folders (FR-2.6); done in the orchestrator without a subagent.
- Files changed: new `web/src/recent/recent.ts` (`pushRecent`/`parseRecent`, shared `useSyncExternalStore` store, `mdv-recent`, 10 items, follows `storage`, in-memory fallback), `RecentList.tsx` (`useRecordRecent`, list + "Clear recent"), `BrowseView.tsx`/`ViewFileView.tsx` (record dir once listed, file once in its parent listing), `RootsView.tsx` + `Layout.tsx` (home page; sidebar outside a workspace except on `/`), `app/app.css`, `recent.test.tsx`, `e2e/tests/recent.spec.ts`, `docs/Architecture.md`.
- Result: component test red with recording disabled. `make check` exit 0 (207 unit), `make e2e` 172 passed twice; logs `build/r23-*.log`.
- Blockers or follow-up: None. A recent item whose file was later deleted stays listed (its link shows the normal not-found state).

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.2)

- Task: Copy-code button and front matter panel (FR-3.2, FR-3.4); done in the orchestrator without a subagent.
- Files changed: new `web/src/markdown/copy.ts` (`copyText`: async clipboard in secure contexts, else `execCommand` on an off-screen textarea), `CopyButton.tsx`, `frontMatter.ts` (`extractFrontMatter`, remark-frontmatter `yaml` fences), `MarkdownView.tsx` (`.code-block` wrapper; collapsed `details.front-matter` above `.markdown-body`), `app/app.css`, unit tests, `e2e/tests/markdown.spec.ts`, `docs/Architecture.md`.
- Result: 4 component tests red without the wiring. `make check` exit 0 (198 unit), `make e2e` 168 passed; logs `build/r22-*.log`.
- Blockers or follow-up: The plain-HTTP `execCommand` fallback is unit-tested only (e2e runs on `localhost`, a secure context); V1 should tap Copy on the iPad.

### 2026-10-12 - Claude Opus 5.5 orchestrator (R2.1)

- Task: Hidden-files toggle (FR-1.4); small enough to do in the orchestrator without a subagent.
- Files changed: new `web/src/browse/showHidden.ts` (shared `useSyncExternalStore` store, `mdv-show-hidden`, follows the `storage` event, works in memory when storage throws), `browse/logic.ts` (`filterEntries` `showHidden`), `BrowseView.tsx` (checkbox), `workspace/logic.ts` + `WorkspaceTree.tsx`, unit/component tests, `e2e/tests/browse.spec.ts`, `docs/Architecture.md`.
- Result: 5 new unit/component tests red with the filter forced on, green with it. `make check` exit 0 (184 unit), `make e2e` 160 passed; logs `build/r21-*.log`.
- Blockers or follow-up: None. Tests that render the store must call `resetShowHiddenCache()` (module cache survives `localStorage.clear()`).

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-18)

- Task: Live reload for images embedded in Markdown; done in the orchestrator without a subagent.
- Files changed: new `web/src/markdown/MarkdownImage.tsx` (version from `useList(parentDir)`, `src` held until the listing settles, low-priority file sub), `links.ts` (asset result carries `path`), `MarkdownView.tsx`, `live/logic.ts` (`capSubs(keys, low)`), `live/controller.ts` + `LiveProvider.tsx` (`low` flag), `baseName` moved to `fileview/logic.ts`, unit tests, `e2e/tests/live.spec.ts`, `docs/Architecture.md`.
- Result: E2E red on 4/4 projects with the version disabled, and again with a folder sub instead of a file sub (the first draft; folder subs miss content changes, and the test now changes one file at a time so a listing refresh cannot mask it). `make check` exit 0 (175 unit), `make e2e` 156 passed; logs `build/fix18-*.log`.
- Blockers or follow-up: Images past the free sub slots (about 31 per page) still version correctly on any listing refetch but get no live events of their own. A truncated listing (`MDV_MAX_LIST_ENTRIES`) can omit an image, which then uses the plain URL.

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-16)

- Task: Reopen a root whose mount appeared after boot; small enough to do in the orchestrator without a subagent.
- Files changed: `internal/fsroot/lazy.go` (`get` claims a check at most every `rootCheckInterval` (2 s); `revalidate` stats `cfg.Path` and compares `fileID` dev/ino with the opened dir; `reopen` swaps and retires the old root, closed at the next swap or `Close`; a failed reopen clears the root so the next call retries; a failed host stat keeps the root), `inode_unix.go`/`inode_other.go` (`fileIdentity`), tests in `lazy_test.go` (dir replacement simulates a mount), README, `docs/Deployment.md`, `docs/Architecture.md`.
- Result: `TestOpenHandleMountsLater` and `TestLazyRootReopensReplacedDir` red with detection disabled, green with it (`-race -count=3`). `make check` exit 0 (fsroot 98.1%), `make e2e` 152 passed; logs `build/fix16-*.log`.
- Blockers or follow-up: Not tested against a real CIFS/NFS mount (V1 can: start mdv before mounting). `:fsnotify` roots keep their host-path inotify watches on the old directory after a swap.

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-14)

- Task: Mermaid temp ids vs heading slugs; small enough to fix in the orchestrator without a subagent.
- Files changed: `web/src/diagrams/mermaid.ts` (id `mdv-mermaid-N` → `mdvMermaid-N`; slugs are lowercase, raw-HTML ids are `user-content-` prefixed), `web/src/diagrams/mermaid.test.tsx`, look-alike headings appended to `testdata/fixtures/diagrams/inline.md` (no new fixture file, so Go list counts are unchanged), `e2e/tests/diagrams.spec.ts`.
- Result: Unit test (headings survive) and e2e (4/4 projects) red without the fix, green with it. `make check` exit 0 (172 unit), `make e2e` 152 passed; logs `build/fix14-*.log`.
- Blockers or follow-up: None. Mermaid also removes existing `#id` elements before rendering, so any future temp id must stay outside the slug alphabet (uppercase) and be CSS-selector safe.

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-13)

- Task: `HostPath` NFC/NFD join; small enough to fix in the orchestrator without a subagent.
- Files changed: `internal/fsroot/watchops.go` (`HostPath` runs its own `withRetry` stat and joins the name that succeeded; `HostPathMissing` inherits it), tests in `internal/fsroot/watchops_test.go` and `internal/watch/hub_test.go`.
- Result: New hub test (NFC sub, NFD names, file + dir keys) is red in fsnotify mode without the fix (file key silent, dir key Add fails) and green with it in both modes. `make check` exit 0, `make e2e` 148 passed; logs `build/fix13-*.log`.
- Blockers or follow-up: The retry is whole-path only; a path whose components mix NFC and NFD on disk is still not found (unchanged, pre-existing).

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-12)

- Task: `/api/file` write deadline; small enough to fix in the orchestrator without a subagent.
- Files changed: `internal/api/file.go` (`chunkWriter` arms `writeTimeout` (10 s) before every `ServeContent` chunk and hides `io.ReaderFrom`), new `internal/api/file_test.go`, `docs/Architecture.md`, comments in `events.go`/`api.go`/`cmd/mdv/main.go`.
- Result: Stalled raw-TCP client test hangs 15 s without the wrapper and passes in 0.3 s with it. No explicit deadline clear is needed: `net/http` resets the write deadline before reusing a kept-alive connection (keep-alive test guards it). `make check` exit 0, `make e2e` 148 passed; logs `build/fix12-*.log`.
- Blockers or follow-up: Minimum throughput is now 32 KiB per 10 s per chunk; a slower client is cut off (fine on a LAN).

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-3)

- Task: Live reload for image views; small enough to fix in the orchestrator without a subagent.
- Files changed: `web/src/api/client.ts` (`fileUrl` optional `version` → `v=`), `web/src/fileview/ViewFileView.tsx` (`ImageFile` uses `<mtime>-<size>` from the listing entry), unit tests, `e2e/tests/live.spec.ts`.
- Result: New e2e (SVG rewritten, `naturalWidth` 10 → 40) fails on 4/4 projects with the cache-buster disabled and passes with it. `make check` exit 0 (171 unit), `make e2e` 148 passed; logs `build/fix3-*.log`.
- Blockers or follow-up: Images embedded in Markdown still use plain URLs; they refresh only when the Markdown re-renders with a new `<img>` (logged as FIX-18).

### 2026-10-12 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (FIX-2)

- Task: Oversized standalone diagram "Load anyway"; `/view` fallback kinds.
- Files changed: `web/src/fileview/ViewFileView.tsx` (diagram case wrapped in `TextGate`), `web/src/diagrams/DiagramPage.tsx` (takes `source`, no fetch), `web/src/fileview/logic.ts` + new `logic.test.ts` (`fileKind` mirrors `ClassifyName`), `testdata/mkfixtures.sh` (`large.d2` ~6 MiB), `e2e/tests/diagrams.spec.ts`.
- Result: The orchestrator checked the extension lists against `internal/fsroot/kind.go` (identical) and re-ran `make check` (171 unit, exit 0); `make e2e` 144 passed. Logs `build/fix2-*.log`.
- Blockers or follow-up: A forced diagram over 5 MiB still cannot render (D2 render body cap 256 KiB, Mermaid `maxTextSize` ~50 KB), so it shows the error figure; recorded under Known Limitations (raising the caps is an owner call).

### 2026-10-12 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (DOC1)

- Task: README + deployment docs.
- Files changed: `README.md` (rewritten: quick start, config table, hostname allowlist, live reload, startup, troubleshooting), new `docs/Deployment.md` (CIFS/NFS fstab, attribute caching, docker.service `RequiresMountsFor=` drop-in, `rslave` bind, `.env`).
- Result: The orchestrator checked env vars, defaults, make targets, `503 busy` sources and the healthcheck against the code, and fixed a merged bullet. `make lint-md` and `make check` exit 0.
- Blockers or follow-up: The fstab options and systemd drop-in are untested on the real VM. V1 must validate them.

### 2026-10-12 - Claude Opus 5.5 orchestrator (FIX-15, FIX-17)

- Task: E2E flakes (drawer, firefox live folder); small enough to fix in the orchestrator without a subagent.
- Files changed: `e2e/tests/workspace.spec.ts` (closed drawer asserted via `#sidebar`: `visibility: hidden` drops it from role queries), `internal/api/events.go` + test (stream starts with `: open`), `docs/Architecture.md`.
- Result: FIX-17 root cause: Firefox did not fire EventSource `open` on headers alone, so refetch-on-open never ran and a file created before the poll baseline was missed (3/3 red before, 3/3 green after, 140 passed each). `make check` exit 0; logs `build/fix15-*`, `build/fix17-*`.
- Blockers or follow-up: None.

### 2026-10-12 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (FIX-11)

- Task: FR-1.2 date sort.
- Files changed: `web/src/browse/logic.ts` (`sortEntries`, `loadSort`/`saveSort`, key `mdv-sort`), `BrowseView.tsx` ("Sort by" select), `browse.css`, unit/component tests, `e2e/tests/browse.spec.ts` (live root folder with `utimesSync` mtimes, persists across reload).
- Result: Folders first in both modes; date = newest first, name tie-break, missing mtime last. The orchestrator reviewed the diff and re-ran `make check` (154 unit) and `make e2e` twice (140 passed); all exit 0, logs `build/fix11-*.log`.
- Blockers or follow-up: FIX-17 (firefox live-folder flake seen once by the subagent).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (FIX-10)

- Task: E2E gaps (back/forward, relative image, offline guard).
- Files changed: `e2e/tests/fixtures.ts` (new auto fixture: aborts and records any non-local http(s) request, fails at teardown; `allowedRemote` option for D-26 remote images), all specs import `test`/`expect` from it, new tests in `flow`, `markdown`, `diagrams` specs.
- Result: The route matches `^https?:` only, because routing `blob:` breaks WebKit diagram images. The orchestrator reviewed the diff and re-ran `make e2e` (136 passed) and `make check`; both exit 0, logs `build/fix10-*.log`.
- Blockers or follow-up: None.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (FIX-9)

- Task: Compose/defaults.
- Files changed: `compose.yaml` (`${MDV_ROOTS:-...}`, `${MDV_POLL_INTERVAL:-2s}`, commented long-syntax NAS bind of the parent dir with `rslave` and `create_host_path: false`), `internal/config/config.go` + test (poll default 2s), `docs/Architecture.md`, `docs/Tech-Stack.md`.
- Result: `docker compose config` verified with and without overrides and with the NAS block uncommented; `make check` exit 0; `make e2e` 124 passed on re-run (first run: drawer flake, now FIX-15). Logs in `build/fix9/`.
- Blockers or follow-up: FIX-15 (drawer flake, second occurrence), FIX-16 (root opened before the NAS mounts stays on the empty dir).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 orchestrator (FIX-8)

- Task: Startup resilience for roots down at boot.
- Files changed: `internal/fsroot/lazy.go` (new `lazyRoot`), `access.go` (`OpenHandle` boot check via `run`, `StartupErr`), `registry.go` (concurrent open, `StartupErrors`), `guard.go` (`OpenRoot` maps a non-directory to `ENOTDIR`), `internal/config/config.go` (no `os.Stat`), `cmd/mdv/main.go` (warning), tests, `docs/Architecture.md`.
- Result: The orchestrator reviewed the diff and re-ran `go test -race -count=3` (fsroot, config, cmd/mdv), `make check` and `make e2e` (124 passed); all exit 0, logs in `build/fix8/`.
- Blockers or follow-up: None. A mount point that exists but is not mounted yet opens the empty directory and needs a restart after the NAS mounts (Known Limitations; DOC1 boot ordering).

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

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 review (FIX-4)

- Task: D2 render CSRF + CSP (🔒).
- Files changed: `internal/api/render.go`, `internal/api/api.go` (`codeUnsupported`), `internal/api/render_test.go`, `web/src/api/client.test.ts`, `docs/Architecture.md` (415 row, render row, proxy note; tables re-padded for MD060).
- Result: Stdlib `http.CrossOriginProtection` guards the route (over plain HTTP it compares `Origin` with `Host`, so a reverse proxy must keep `Host` or terminate TLS). Opus reviewer found no remaining cross-site path and approved. `make check` exit 0 and `make e2e` 124 passed (logs in `build/fix4/`).
- Blockers or follow-up: One flaky webkit drawer e2e failure on the first run (see Known Limitations).

### 2026-10-11 - Claude Haiku 4.5 + Opus 5.5 verification (T2)

- Task: Full validation run (plus CH1: `MEMORY.md` streamlined, old run log in `agents/Memory-History.md`).
- Files changed: `TODO.md`, `MEMORY.md` (T2 is validation only).
- Result: `make check`, `go test -race ./...`, `make e2e` (124 passed) and `docker compose build` all exit 0. The orchestrator checked the exit-code files and log summaries in `build/t2/` directly rather than trusting the Haiku report.
- Blockers or follow-up: None. R1 should start from "Known Limitations And Accepted Risks".

### 2026-10-11 - Claude Opus 5.5 (R1)

- Task: MVP phase review against Success Criteria 1 to 5 and the Security Model.
- Files changed: `TODO.md`, `MEMORY.md`, `agents/Decisions.md` (D-26), `agents/Memory-History.md`, `docs/Implementation.md` (R2.1), `docs/Tech-Stack.md` and `docs/Architecture.md` (drift fixes).
- Result: Three parallel Opus reviewers (backend security, frontend security, requirements/deployment); the orchestrator re-checked each logged finding in source. Path guard, sanitizer, `resolveLink`, diagram `<img>` isolation and `/api/file` headers hold. Main defects: `POST /api/render/d2` is cross-site postable (`text/plain`) and returns SVG without CSP (reproduced with `javascript:` links), no Host check (DNS rebinding), D2 cache unbounded by bytes, SSE watch cap exhaustible, a down NAS at boot stops the server. Outputs in `build/r1/`.
- Blockers or follow-up: FIX-4 to FIX-11 block DOC1. A part A reviewer's `pkill -f build/r1/mdv` may have killed another reviewer's probe server (harmless).

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

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (F6)

- Task: Live reload client.
- Files changed: `web/src/live/{logic,controller,scrollAnchor}.ts`, `LiveProvider.tsx` + tests, `web/src/app/App.tsx`, `web/src/{fileview/ViewFileView,browse/BrowseView,markdown/MarkdownView}.tsx`, `web/vite.config.ts` (`src/live` in coverage), `e2e/{playwright.config.ts,tests/live.spec.ts}`, `Makefile` (e2e clears `build/e2e/live`), `docs/Architecture.md`.
- Result: `useLiveSubscription(root, path)` is a no-op without a provider (existing tests unchanged). Each reopen fires `open`, which invalidates active roots/list/file queries (one extra refetch per navigation that changes the sub set; accepted per spec). D2 render queries are never invalidated. Markdown scroll snapshot is taken in render and restored in a layout effect, and suppresses the hash scroll once. E2E has a second root `live=build/e2e/live:poll` with `MDV_POLL_INTERVAL=300ms`, created in the Playwright config; specs use unique `t-<uuid>` folders. The orchestrator reviewed the diff and re-ran `make check` (147 web tests, 93.46% lines) and `make e2e` (28).
- Blockers or follow-up: FIX-3 (image files never refresh: plain `<img src>`). Late height changes (Shiki, diagrams) after restore can shift scroll slightly. Workspace tree still has no own subscriptions (R2.10).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (F5)

- Task: Workspace tree + file views by kind + large-file load button.
- Files changed: `web/src/workspace/{logic,WorkspaceTree}.ts(x)` + tests + `tree.css`, `web/src/fileview/{ViewFileView.tsx,logic.ts,fileview.css}`, `web/src/app/{Layout,routes,states,views}.tsx` + tests (`RouteError.test.tsx`), `web/src/browse/{logic.ts,BrowseView.tsx}` + tests, `testdata/mkfixtures.sh` (`generated/large.txt`), `e2e/tests/workspace.spec.ts`, `docs/Architecture.md`.
- Result: `/view` takes the kind from the parent folder's `useList` entry (server classification, no client duplicate); fallback by extension covers only markdown/diagram, else `other`. Views wait on that cached listing. With `?ws=` the sidebar shows "Workspace" and a lazy tree (fetch on expand, dot-files hidden, folders first); without `ws` the sidebar is unchanged. `scopeWs` closes the F2 follow-up. `TextGate` handles 413 for markdown/text with size from the listing. `RouteError` sits on a pathless route inside `Layout`. The orchestrator reviewed the diff and re-ran `make check` (129 web tests) and `make e2e` (24).
- Blockers or follow-up: FIX-2 (oversized `.d2`/`.mmd` has no "Load anyway"; fallback kind misses image/text). F6 should invalidate both the file and its parent `['list', ...]` query, since the view kind depends on it.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (F4)

- Task: Mermaid + D2 diagram components.
- Files changed: `web/src/diagrams/**` (Diagram, DiagramBoundary, MermaidDiagram, D2Diagram, DiagramFigure, DiagramError, DiagramPage, mermaid.ts, useResolvedTheme, kinds + tests), `web/src/api/client.ts` (`renderD2`), `web/src/markdown/MarkdownView.tsx`, `web/src/app/{views.tsx,app.css}`, `web/package.json` (mermaid 12.1.0), `e2e/tests/diagrams.spec.ts`, `docs/Architecture.md`, `agents/Decisions.md` (D-25).
- Result: Both kinds render as `<img src=blob:>` (D-25). Mermaid uses `suppressErrorRendering: true` so syntax errors reject, and leftover temp nodes are removed. Fence text has its trailing newline stripped. Mermaid is only in lazy chunks (verified in the dist). Markdown tests that render diagrams now need a `QueryClientProvider`, a mocked `../diagrams/mermaid` and a stubbed `fetch`. The orchestrator re-ran `make check` (116 web tests, `src/diagrams` 97.4% lines) and `make e2e` (18).
- Blockers or follow-up: `npm audit` reports a low-severity katex advisory via mermaid (pinned `^0.16`); deferred to R2.7. One unit test waits about 3 s for TanStack retry backoff on 503.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (F3b)

- Task: Shiki syntax highlighting.
- Files changed: `web/src/markdown/{highlight.ts,CodeBlock.tsx,highlight.test.tsx,MarkdownView.tsx}`, `web/src/app/app.css`, `web/package.json` (shiki, @shikijs/langs/themes/types 4.5, hast-util-to-jsx-runtime 2.3), `testdata/fixtures/docs/code.md`, `e2e/tests/markdown.spec.ts`, `docs/{Architecture,Tech-Stack}.md`, `agents/Decisions.md` (D-24).
- Result: Highlighting runs in the `pre` component, not via `@shikijs/rehype` (D-24). Shiki loads only when a block has a supported language; the index and MarkdownView chunks only reference it by dynamic import (verified in the dist). Real Shiki with the JS engine works in jsdom. The orchestrator re-ran `make check` (98 web tests) and `make e2e` (14).
- Blockers or follow-up: R2.5 can reuse `highlightToHast` for standalone code files. The existing >500 kB chunk warning (MarkdownView/index) is unchanged.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 review/verification (F3)

- Task: Markdown pipeline (🔒).
- Files changed: `web/src/markdown/{pipeline,links,scroll}.ts`, `MarkdownView.tsx` + tests, `web/src/app/{views.tsx,app.css,App.test.tsx,viewfile.test.tsx}`, `web/package.json` (react-markdown 10, remark-gfm 4, remark-frontmatter 5, rehype-raw 7, rehype-sanitize 6, rehype-slug 6), `e2e/tests/markdown.spec.ts`, `docs/Architecture.md`.
- Result: Footnotes were broken by default (sanitize double-prefixed ids); fixed with `clobberPrefix: ''`. Diagram detection lives in the `pre` component (avoids nested `pre`). `ViewFileView` renders `.md`/`.markdown` only; other kinds stay placeholders for F5. The Opus review found no XSS; it found that raw HTML `data-footnote-*` links bypassed `resolveLink`, which is now fixed and tested. Also added `no-referrer` on images, and empty hrefs render as text. The orchestrator re-ran `make check` (87 web tests, `src/markdown` 97.5%) and `make e2e` (13).
- Blockers or follow-up: F5 should add a route `errorElement` (lazy chunk or render failure shows the router default page). F3b adds Shiki after `rehype-slug`.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (F2)

- Task: Browse views.
- Files changed: `web/src/browse/{logic,RootsView,BrowseView,Breadcrumbs,KindIcon}.tsx/ts` + tests, `browse.css`, `web/src/app/views.tsx`, `web/src/api/client.ts` + test, `e2e/tests/browse.spec.ts`.
- Result: `withWorkspace` now checks `ws !== undefined`, so `?ws=` (empty) means the whole root is the workspace, distinct from no workspace. "Open as workspace" goes to README.md, then index.md (case-insensitive), else the folder listing. The markdown-only toggle is stored under `mdv-md-only`. Dot-files are always hidden (the toggle comes in R2.1). The filter is component state. The orchestrator fixed two defects on review: the filter persisted across folders (the folder view is now keyed by path), and breadcrumbs kept `ws` above the workspace folder (`isWithin`). `make check` and `make e2e` are green (46 unit, 10 e2e).
- Blockers or follow-up: entry links inside a browse view that is itself outside the workspace keep `ws`. This is only reachable by a hand-typed URL; F5 should apply `isWithin` in general when it owns workspace navigation.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (T0)

- Task: Playwright scaffold + smoke test.
- Files changed: `e2e/{package.json,package-lock.json,playwright.config.ts,tsconfig.json,eslint.config.js,.prettierrc.yaml}`, `e2e/tests/{smoke,shell}.spec.ts`, `Makefile` (`e2e`, `deps-e2e`, `lint-e2e`), `go.mod` (`ignore ./e2e`), `.yamllint.yaml`, `CONTRIBUTING.md`, `docs/Implementation.md`.
- Result: `make e2e` depends on `build`, `fixtures` and an npm-ci stamp, then runs Playwright in the pinned image as the host user (`--ipc=host`, HOME under `build/.cache/home`). The webServer runs the static `build/mdv` on `127.0.0.1:18080` (`E2E_PORT`) with root `fixtures=testdata/fixtures`. Output goes to `build/e2e/{report,test-results}`. Scenarios: root list + browse, traversal 4xx, drawer at 600 px, sidebar at 1200 px, theme survives a reload. The orchestrator replaced the coder's nested `e2e/go.mod` with `ignore ./e2e` (same approach as D-17) and re-ran `make check` and `make e2e`. About 3 s warm.
- Blockers or follow-up: T1 adds the firefox, webkit and iPad projects. F-tasks add scenarios under `e2e/tests/`.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (F1)

- Task: App shell.
- Files changed: `web/src/api/{types,client,hooks}.ts` + test, `web/src/app/{App,routes,Layout,views,states,theme,preloadError}.tsx/ts`, `app.css` + test, `web/{index.html,vite.config.ts,eslint.config.js,package.json}`, `web/src/{main.tsx,test/setup.ts}`, `docs/Architecture.md`.
- Result: Route hrefs encode each segment; the API `path` goes through `URLSearchParams`. `ApiError` has `status`/`code` (client codes `network`, `unknown`); aborts are rethrown, not wrapped. Query keys are `['roots']`, `['list', root, path]`, `['file', root, path, force]`. Root list at `/` is `<h1>Roots</h1>` + `<ul aria-label="Available roots">` (T0 target). Browse/view are placeholders for F2/F5. Dev proxy `/api`, `/healthz` to `:8080`. ESLint: base `no-undef`/`no-unused-vars` off in favour of the TS rule; RTL `cleanup()` registered in setup. Orchestrator reviewed the diff, re-ran `make check`, and smoke-tested the embedded build. 96.2% `src/api`.
- Blockers or follow-up: F1's e2e scenario moves to T0 (T0 depends on F1). The drawer breakpoint is checked only by jsdom so far; T0/T1 should check it in a real viewport. F6 may want to tune `staleTime`/`refetchOnWindowFocus` (TanStack defaults now).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (FIX-1)

- Task: Re-arm fsnotify watches when a watched host directory is deleted and recreated.
- Files changed: `internal/watch/{fsn,hub}.go`, `internal/watch/hub_test.go` (6 `TestRearm*` tests), `docs/Architecture.md`.
- Result: Kernel watches are refcounted in `fsnotifier.refs`, shared by armed and ancestor watches. A Remove/Rename of a watched dir disarms every dependent watch and drops its refs; a goroutine (hub WaitGroup, 5 s timeout) walks host dir to root via `Handle.HostPath`, arming the deepest valid real directory, stepping down on Create of the next component. Catch-up: dir key `modified` (+`created` if reported deleted), file key `created` if present. Orchestrator reviewed the diff (lock ordering, ref clearing) and re-ran the new tests with `-race -count=30` and `make check`. 92.6% watch.
- Blockers or follow-up: If a file's parent is recreated with the file already present, delete + create merge to `modified`. If the root directory itself is deleted, the watch stays disarmed (Warn log). A path missing at subscribe and later created as a dir is still a file key (existing behaviour).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (B7)

- Task: Concurrency review of the B6 watch hub + SSE.
- Files changed: `internal/watch/{hub,poll}.go` + tests, `internal/fsroot/watchops.go` (`HostPathMissing`) + test, `internal/api/{api,events}.go` + tests, `docs/Architecture.md`.
- Result: Sonnet review found no races (`go test -race -count=20`), sound lock ordering and shutdown ordering. Fixed: each SSE write/ping gets a 10 s deadline (a non-reading client could pin the handler); non-GET on `/api/events` is 405 (HEAD opened an endless stream); a missing `sub` path is accepted with a not-present baseline and later emits `created` (fsnotify needs the parent dir; poll accepts any); poll follows kind swaps (reported as `modified`); `Options.MaxWatches` (256 distinct keys) returns 503 `busy`. Orchestrator reviewed the diff and re-ran race ×5 and `make check`. 94.9% watch / 94.2% api / 98.2% fsroot.
- Blockers or follow-up: FIX-1 (fsnotify recreated dir stays silent). F6: EventSource treats any non-200 (503 cap/shutdown) as fatal, so the client must reopen with backoff itself. Subscribe validates subs sequentially (worst case 32 × `MDV_FS_TIMEOUT` on a hung mount; accepted).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (B6)

- Task: Watch hub + SSE.
- Files changed: `internal/watch/{hub,poll,fsn,event,doc}.go` + tests, `internal/fsroot/{watchops,inode_unix,inode_other}.go` + tests, `internal/api/{api,events}.go` + tests, `cmd/mdv/main.go`, `go.mod` (fsnotify v1.10.1, goleak v1.3.0), `docs/Architecture.md`.
- Result: Directory subs emit `created`/`deleted` on child paths and `modified` on the dir when its mtime changes (child content changes need a file sub). Poll keeps the previous state on timeout (an outage is never a deletion); one goroutine per key, ticks dropped while a poll is pending. fsnotify uses one hub-wide inotify instance, refcounted per host dir; `Handle.HostPath` validates via `os.Root` before joining to the host dir. `api.Server.Close()` ends streams; `cmd/mdv` registers it with `RegisterOnShutdown` (after close: 503 `busy`). goleak in the watch package. Orchestrator reviewed the diff and re-ran `make check`; the coder ran `-race -count=5`. 94.8% watch / 94.2% api / 98.1% fsroot.
- Blockers or follow-up: (B7/F6) any missing `sub` path fails the whole stream with 404, so a deleted file breaks live reload for the tab; F6 must drop that sub and reopen, or B7 should consider allowing missing paths. fsnotify `Add`/`Remove` bypass the Handle timeouts (it is meant for local disks). `HostPath` has a small TOCTOU gap (leaks only "changed"). Poll treats a file-to-dir swap at the same path as `modified`.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (B5)

- Task: D2 render endpoint + cache.
- Files changed: `internal/d2render/{render,cache,errors,doc}.go` + tests, `internal/api/{api,render}.go` + tests, `docs/Architecture.md`, `agents/Research.md`; `cmd/spike-d2` deleted.
- Result: Verified in D2 v0.9.0 that `CompileOptions.FS` nil falls back to `os.Open` (`d2ir/import.go`), so an explicit `emptyFS` is always passed; all import forms tested fail with 422. One `textmeasure.Ruler` per slot. Cache key = sha256 of length-prefixed (version, layout, theme ID, source). Identical concurrent requests share one detached render (singleflight), so a cancelled client cannot poison the cache. Theme defaults to light, layout to dagre; `elk` also accepted. Orchestrator reviewed the diff and re-ran `make check` plus 10x `-race` runs of the new tests. 94.4% d2render / 95.7% api; `make check` green.
- Blockers or follow-up: A cached timeout persists until LRU eviction or restart (per spec). The SVG response has no CSP; F4 must insert it sanitized or via `<img src=blob:>`.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 verification (B4b)

- Task: SPA embed and lifecycle.
- Files changed: `internal/web/{web.go,web_test.go,doc.go}`, `cmd/mdv/{main.go,main_test.go}`, `docs/Architecture.md`.
- Result: `web.Handler()` / `web.NewHandler(fs.FS)` serve the embedded `dist` (works empty: plain-text 503 "web UI not built"). Non-asset static files are `no-cache`; trailing-slash paths fall back to `index.html`; never lists directories. `cmd/mdv`: `run(ctx, args, getenv, stdout, stderr)`; `serve` mounts the SPA on `api.Server.Mux()` at `/`, JSON slog, `ReadHeaderTimeout` 10 s, no `WriteTimeout`, 10 s shutdown drain. `healthcheck` reads only `MDV_LISTEN`. Smoke test against a real binary passed. Orchestrator reviewed the diff (no separate reviewer: small, non-🔒). 95.2% coverage; `make check` green.
- Blockers or follow-up: B6 must end SSE streams on shutdown (`srv.RegisterOnShutdown` or a server-scoped ctx), because `http.Server.Shutdown` waits for active connections and would hit the 10 s drain. SPA index.html has no ETag (refetched each load; small).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 review (B4a)

- Task: HTTP API core (🔒).
- Files changed: `internal/api/{api,file,ino_unix,ino_other}.go` + tests, `internal/fsroot/{reader.go,access.go,ops.go,registry.go,doc.go}` + tests, `docs/Architecture.md`, `agents/Decisions.md` (D-23).
- Result: `api.New(reg, cfg, logger)`; `Mux()` for B4b/B5/B6 routes, `Handler()` wraps recover + slog (call after registering). `/api/file` does Open, then `Handle.FileStat`, and streams through `Handle.Reader` (64 KiB timed `ReadAt` chunks). The allowlist is explicit in `file.go`. CSP + nosniff on every `/api/file` response, 405 included. The Opus review found no security blockers; it found fail-fast slots truncated parallel streams, so `run` now waits for a slot within `MDV_FS_TIMEOUT` (D-23). Late panics re-panic `http.ErrAbortHandler`. 94.7% api / 98.9% fsroot; `make check` green.
- Blockers or follow-up: B6 must use `http.ResponseController` (the middleware's `statusWriter` has `Unwrap`, but not `Flusher`). `classify` uses `path.Ext`, so `.env` is served as text while `ClassifyName` says other (harmless: text/plain).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 orchestration (B3)

- Task: Listing + reads with timeouts, in-flight cap, NFC/NFD retry.
- Files changed: `internal/fsroot/{access,ops,kind,registry}.go` + tests, `guard.go` (`KindTimeout`/`ErrTimeout`), `go.mod` (`x/text` direct), `testdata/mkfixtures.sh` (NFD fixture), `docs/Architecture.md`.
- Result: `Handle` runs each fs op in a goroutine under `MDV_FS_TIMEOUT`; the non-blocking in-flight slot is held until the call returns, so a dead mount never holds more than the cap. Only the handle's own timeout marks a root unavailable (caller cancel and a full cap give 504 but don't). One probe stat at a time restores it. `List` on a file is 400; symlinks that escape/dangle/loop are omitted; `Listing.Path` is `"."` for the root (B4a maps to `""`). `ClassifyName` is exported for the B4a allowlist. Sonnet review: no blockers; 3 weak tests fixed. 98.7% coverage; `make check` green.
- Blockers or follow-up: B4a must not trust reads from an opened `*os.File` on a dead mount (outside the timeout), and must map `KindTimeout` to 504 `fs_timeout`. Probe has no own timeout (bounded by its slot).

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 review (B2)

- Task: Path guard on `os.Root` (🔒).
- Files changed: `internal/fsroot/{guard.go,guard_test.go,doc.go}`, `docs/Architecture.md`, `docs/Implementation.md`, `agents/Decisions.md` (D-22).
- Result: `Resolve(rel)` lexical prechecks (400) plus guarded `Open`/`Stat`/`Lstat`/`ReadDir` returning `*PathError` with `Kind`, sentinels, and `KindOf`. Escapes are matched on `os.Root`'s unexported "path escapes from parent" text (pinned by `TestEscapeErrorContract`, fail-closed to 500). `Open` uses `O_NONBLOCK` + fstat and refuses FIFOs/devices (403). The Opus review found no blockers; all 7 findings were fixed on the branch. 98.2% coverage; `make check` green.
- Blockers or follow-up: B4a must send only `PathError.PublicMessage()` to clients (`Error()`, `File.Name()` and file-method errors contain host paths). B3 should add context-aware wrappers, not change these signatures.

### 2026-10-11 - Claude Sonnet 5.5 + Opus 5.5 review (B1)

- Task: Env-only config package.
- Files changed: `internal/config/{config.go,config_test.go,doc.go}`.
- Result: `config.Load(getenv)` / `FromEnv()`. Validates every `MDV_*` var, stats roots (absolute, existing dir), and joins all errors. The `:poll`/`:fsnotify` suffix is split off only when it is a known mode, so other colons stay in the path. 100% coverage; `make check` green. Not yet wired into `main` (B4b).
- Blockers or follow-up: None. Ready for B2.

### 2026-10-11 - Claude Sonnet 5.5 (P0.6 apply)

- Task: Apply the 15 accepted plan-challenge findings (C-1 to C-15).
- Files changed: `docs/Architecture.md`, `docs/Implementation.md`, `docs/Requirements.md`, `docs/Tech-Stack.md`, `TODO.md`, `MEMORY.md`, `agents/Decisions.md`.
- Result: SSE is one stream per tab (`sub=`); dead-mount in-flight cap; allowlist file serving; D2 empty FS, busy/timeout codes; `os.Root` guard; env-only config (D-20); minimal large-file button in MVP (D-21); B4 split into B4a/B4b, F3 into F3/F3b, T0 added. Decisions D-19 to D-21.
- Blockers or follow-up: B3 adds an NFD fixture via `mkfixtures.sh`. Ready for B1.

### 2026-10-11 - Claude Code (Opus 5.5) - P0.5 review

- Task: Verify P0.5 and fix `make clean` (read-only Go module cache under `build/.cache`).
- Result: `make check` and `make clean` verified on the branch. For B5: dagre ignores ctx, so it needs its own wall-clock limit; `Ruler` concurrency safety is unverified.

### 2026-10-11 - Claude Sonnet 5.5 (P0.5)

- Task: Spike the D2 Go library.
- Files changed: `cmd/spike-d2/main.go`, `go.mod`, `go.sum`, `agents/Research.md`.
- Result: Renders light (0) and dark (200) SVG with dagre and ELK; findings (API, timings, sizes, errors, determinism) recorded in `agents/Research.md`. The spike is deleted when B5 lands.
- Blockers or follow-up: Dagre ignored a 1 ns ctx timeout, so B5 needs its own wall-clock limit. Ready for P0.6.

### 2026-10-11 - Claude Sonnet 5.5 (P0.4)

- Task: Test fixture tree and generator script.
- Files changed: `testdata/fixtures/**`, `testdata/mkfixtures.sh`, `testdata/README.md`, `Makefile`, `.gitignore`.
- Result: Committed edge-case fixtures; `testdata/fixtures/generated/` (symlinks, ~6 MiB `large.md`) is created by an idempotent script with `--verify`. `make fixtures` runs it, and `test-go` depends on it. The generated dir replaces the `links/` name in `.gitignore`.
- Blockers or follow-up: None. Ready for P0.5.

### 2026-10-11 - Claude Sonnet 5.5 (P0.3)

- Task: Lint configs and per-tool `make lint-*` targets.
- Files changed: `.golangci.yml`, `.yamllint.yaml`, `.markdownlint-cli2.yaml`, `.hadolint.yaml`, `.shellcheckrc`, `Makefile`, `web/package.json`, `CONTRIBUTING.md`, plus fixes to existing Markdown, Go, and web formatting.
- Result: golangci-lint, hadolint, and shellcheck run from pinned Docker images as the host user with caches in `build/.cache/`. markdownlint-cli2 is a web devDependency. Docker and shell lint skip when no files exist. No lint rules disabled except MD013 (long table rows) and gosec in tests.
- Blockers or follow-up: None. Ready for P0.4.

### 2026-10-11 - Claude Haiku 4.5 (P0.2)

- Task: Makefile with build/test/check targets, Vitest test harness, covercheck coverage gate tool.
- Files changed: `web/package.json`, `web/package-lock.json`, `web/vite.config.ts`, `web/src/App.test.tsx`, `web/src/test/setup.ts`, `Makefile`, `.coverage.yaml`, `tools/covercheck/main.go`, `tools/covercheck/main_test.go`.
- Result: Root Makefile with build/test/check targets; all outputs under `build/` and `internal/web/dist/`. Web harness is Vitest 5 + `@vitest/coverage-v8` + jsdom 30 + Testing Library 16 (no deprecation warnings), coverage to `build/coverage/web` with an 80% lines threshold. `.coverage.yaml` uses a `packages` mapping and prefix `exclude` (cmd/ only). Covercheck is a thin `main` over a tested `run()` at 99.3% coverage and computes coverage from statements, counting duplicate blocks once. Gate verified: `make check` exits 0, and a config with `default: 100` makes covercheck exit 1. `make clean` leaves no artifacts.
- Blockers or follow-up: None. Ready for P0.3 (lint configs).

### 2026-10-11 - Claude Code (Opus 5.5) - P0.1 review

- Task: Verify and fix P0.1 before merge.
- Files changed: `go.mod` (`ignore ./web`), removed `web/README.md` and `web/public/icons.svg`, `docs/Tech-Stack.md`, `agents/Decisions.md` (D-17).
- Result: `go ./...` no longer scans `node_modules`. TypeScript 6.0 is recorded. Build, lint, and tests pass.
- Blockers or follow-up: none. Next is P0.2.

### 2026-10-11 - Claude Haiku 4.5 (P0.1)

- Task: Scaffold Go module, internal packages, Vite React-TS app with outDir configuration.
- Files changed: `go.mod`, `cmd/mdv/main.go`, `cmd/mdv/main_test.go`, internal package `doc.go` files, Vite React app in `web/`, `eslint.config.js`, `.prettierrc.yaml`, `vite.config.ts`, build output placeholders.
- Result: Go module initialized. All tests pass. `go build`, `go vet`, `go test` succeed. `npm run build` and `npm run lint` pass. Build outputs properly ignored except `.gitkeep` files.
- Blockers or follow-up: None. Ready for P0.2 (Makefile).

### 2026-10-11 - Claude Code (Opus 5.5) - workflow and quality gates

- Task: Define Git workflow, quality gates, build-artifact handling; commit plan.
- Files changed: `.gitignore`, `AGENTS.md`, `docs/Implementation.md`, `docs/Tech-Stack.md`, `TODO.md`, `MEMORY.md`, `agents/Decisions.md`.
- Result: `.gitignore` covers `web/node_modules`, the Vite bundle, test binaries, and reports. Phase 0 is re-split (P0.1 to P0.5). EX1 example set added.
- Blockers or follow-up: resolved. The owner committed the `.awb` deletion (f1ced02) and chose `TODO.md` tracking (D-16).

### 2026-10-11 - Claude Code (Opus 5.5) - Docker Compose deployment

- Task: Record Docker Compose deployment; commit decisions; plan implementation.
- Files changed: `docs/Architecture.md`, `docs/Implementation.md`, `TODO.md`, `AGENTS.md`, `agents/Decisions.md`, `MEMORY.md`, `status.yaml` (deployment docs in commit 59b6cf1).
- Result: API/config/layout finalized. Phases 0 to 3 broken into tiered tasks.
- Blockers or follow-up: NAS roots and UID/GID needed before D1/V1.

### 2026-10-11 - Claude Code (Opus 5.5) - backend decision

- Task: Record backend decision and future voice-over scope.
- Files changed: `docs/Requirements.md`, `docs/Tech-Stack.md`, `docs/Architecture.md`, `docs/Implementation.md`, `agents/Decisions.md`, `README.md`, `TODO.md`, `MEMORY.md`, `status.yaml`.
- Result: Go confirmed. Voice-over extensions added as post-MVP candidates (VO-1..VO-8). Status set to active / planning.
- Blockers or follow-up: Deployment decided later the same day: Docker Compose on a VM (D-11).

### 2026-10-11 - Claude Code (Opus 5.5) - tech stack research

- Task: Research tech stack; fill requirements; collect early decisions.
- Files changed: `docs/Requirements.md`, `docs/Tech-Stack.md`, `docs/Architecture.md`, `docs/Implementation.md`, `agents/Decisions.md`, `agents/Research.md`, `README.md`, `TODO.md`, `MEMORY.md`, `status.yaml`.
- Result: Requirements and stack recommendation drafted. Owner decided file access, auth, and scope.
- Blockers or follow-up: Owner to confirm Go backend; then Planning phase.

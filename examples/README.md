# mdv examples

Sample files for manual testing and demos. Point mdv at this folder (for example `MDV_ROOTS=examples=./examples`) and click around. Edge-case test fixtures live separately in `testdata/fixtures/`.

![Logo](images/logo.svg)

## Pages

- [gfm-tour.md](gfm-tour.md): GitHub Flavored Markdown tour with front matter, code, tables and footnotes.
- [mermaid.md](mermaid.md): flowchart, sequence, class, state and gantt diagrams.
- [d2.md](d2.md): D2 shapes, containers, SQL tables and a sequence diagram.

## Standalone diagram files

- [flowchart.mmd](flowchart.mmd): a small Mermaid flowchart.
- [network.d2](network.d2): a small D2 network diagram.

## Nested folder

- [guide/README.md](guide/README.md): guide index with relative links in both directions.
- [guide/setup.md](guide/setup.md): setup page with a PNG image.
- [guide/advanced/README.md](guide/advanced/README.md): deeper folder index.
- [guide/advanced/tuning.md](guide/advanced/tuning.md): links up to the root pages and an SVG image.

## Images

- [images/logo.svg](images/logo.svg): hand-written SVG logo.
- [images/swatches.png](images/swatches.png): small generated PNG of colour swatches.

## Project

- [projects/demo.mdv.yaml](projects/demo.mdv.yaml): a project file. Click it in the listing to open it as a project: the sidebar shows the guide folder and two pages, and `gfm-tour.md` opens first. It also contains six deliberately broken items (a missing folder, a file written as a folder, a path outside the root, a cross-root reference, an unknown key and an out-of-range `fontSize`). Their warnings in the warnings panel are intentional. See [Project files](../README.md#project-files) in the main README.

## Intentionally broken

These show the error boundary for invalid diagrams.

- [broken-diagrams.md](broken-diagrams.md): invalid Mermaid and D2 blocks next to valid ones.
- [broken.mmd](broken.mmd): invalid standalone Mermaid file.
- [broken.d2](broken.d2): invalid standalone D2 file.

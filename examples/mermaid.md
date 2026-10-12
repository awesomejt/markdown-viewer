# Mermaid diagrams

Each fenced `mermaid` block is rendered to SVG. A standalone version lives in [flowchart.mmd](flowchart.mmd).

## Flowchart

```mermaid
flowchart TD
  A[Open file] --> B{Is Markdown?}
  B -->|yes| C[Render page]
  B -->|no| D[Show raw text]
  C --> E[Done]
  D --> E
```

## Sequence diagram

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as Server
  B->>S: GET /api/file?root=examples&path=d2.md
  S-->>B: Markdown source
  B->>B: Render Markdown and Mermaid
  B->>S: POST /api/render/d2
  S-->>B: SVG
```

## Class diagram

```mermaid
classDiagram
  class Document {
    +String path
    +render() String
  }
  class Diagram {
    +String source
    +toSVG() String
  }
  Document "1" --> "*" Diagram : contains
```

## State diagram

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Rendering : request
  Rendering --> Idle : success
  Rendering --> Failed : error
  Failed --> Idle : retry
```

## Gantt chart

```mermaid
gantt
  title Demo plan
  dateFormat YYYY-MM-DD
  section Build
  Design     :done,    d1, 2026-01-01, 5d
  Implement  :active,  d2, after d1, 10d
  section Ship
  Review     :         d3, after d2, 3d
```

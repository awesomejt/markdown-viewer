# Project TODO

Prioritized project task list. When Agent Workbench is configured, use `awb task next` / `awb task list` instead of reading this file directly. This file serves as the fallback when AWB is not available and as the initial task list before tasks are imported into AWB.

## Needs Attention

Items that require a human decision, credential, source file, or manual validation before work can continue.

- [ ] Provide the initial NAS roots (VM mount paths) and the UID/GID that can read them (needed before Deployment).
- [ ] Reconfigure AWB (`awb init`) or keep using this file. `.awb/config.yaml` is currently deleted.

## Research

- [ ] (Post-MVP) Research voice-over script conventions (Fountain, SSML, CriticMarkup, `remark-directive`) and choose syntax for VO-1..VO-8 in `docs/Requirements.md`.
- [ ] (Optional) Spike: render a sample D2 block with `github.com/d2lang/d2` v0.9.0 and a Mermaid block in iPad Safari to confirm both paths before MVP.

## Planning

- [ ] Write `docs/Implementation.md`: MVP / Refinement / Finalization phases mapped to FR IDs in `docs/Requirements.md`.
- [ ] Finalize the API contract and repo layout (`cmd/`, `internal/`, `web/`) in `docs/Architecture.md`.
- [ ] Define the config file format and defaults.
- [ ] Define the test strategy and the iPad manual test checklist.
- [ ] Break MVP into ordered implementation tasks in this file (or AWB).

## Implementation

- [ ] (Populated during Planning.)

## Validation

- [ ] Run the project test suite.
- [ ] Run lint, type checks, build checks, or equivalent validation.
- [ ] Record any manual validation findings in `MEMORY.md`.

## Deployment

- [ ] Document deployment targets and release steps.
- [ ] Validate deployment or publishing workflow.

## Blocked

Move blocked tasks here with the reason and exact next action needed.

- [ ]

## Done

Move completed tasks here with a brief result note.

- [x] 2026-10-11: Read project template files and replaced placeholders in README and docs.
- [x] 2026-10-11: Researched tech stack (D2, Mermaid, Markdown pipeline, desktop wrappers, SMB). Notes in `agents/Research.md`.
- [x] 2026-10-11: Filled `docs/Requirements.md`, `docs/Tech-Stack.md`, and `docs/Architecture.md`.
- [x] 2026-10-11: Owner confirmed Go backend (D-5).
- [x] 2026-10-11: Owner chose Docker Compose on a VM with NAS bind mounts (D-11).
- [x] 2026-10-11: Collected owner decisions: host mounts only, no auth, viewer + live reload (`agents/Decisions.md`).

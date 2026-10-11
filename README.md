# LAN Markdown Viewer

A self-hosted, read-only Markdown viewer for the local network. A single server on a host machine lets any LAN device (iPad, phone, desktop) browse that host's folders and mounted network shares, open folders as workspaces, and read Markdown with Mermaid and D2 diagrams. Pages reload live when files change.

**Status:** planning phase. Stack chosen: Go server + React/TypeScript UI. No code yet.

- Requirements: [docs/Requirements.md](docs/Requirements.md)
- Tech stack and rationale: [docs/Tech-Stack.md](docs/Tech-Stack.md)
- Architecture: [docs/Architecture.md](docs/Architecture.md)
- Decisions: [agents/Decisions.md](agents/Decisions.md)

> Intended for a trusted home LAN only. It has no authentication. Do not expose it to the internet.

This repository uses the AI-ready project template conventions described below.

## Root Contract

AI assistants and humans should start with the root files:

- `AGENTS.md` - operating instructions for AI assistants.
- `README.md` - human-facing project overview and setup notes.
- `TODO.md` - prioritized task list and blockers.
- `MEMORY.md` - persistent project memory, decisions, milestones, and run notes.
- `status.yaml` - current project state for humans and automation.

## Supporting Folders

- `docs/` - requirements, architecture, tech stack, implementation notes, and diagrams.
- `agents/` - optional supplemental agent references, decision logs, research notes, and chat templates.
- `.agents/chats/` - local chat transcript workspace. Transcript files are ignored by Git.
- `working/` - temporary scratch space ignored by Git.
- `build/` - build artifacts ignored by Git when a project needs them.

## Agent Workflow

Agents should read `AGENTS.md`, `MEMORY.md`, `TODO.md`, `status.yaml`, and relevant files in `docs/` before starting work. For automated or recurring work, follow `AGENT_WORKFLOW.md`.

Runtime logs and full chat transcripts should not be committed. Store local transcripts under `.agents/chats/` when useful, and mirror agent-managed logs or transcripts to external storage such as:

- `/var/log/hermes`
- `/mnt/hermes/logs`
- `/mnt/hermes/output/<project-name>/`

For other workflow managers such as n8n or OpenClaw, use equivalent configured output and log storage.

## Setup

After creating a new project from this template:

```bash
git config commit.template .gitmessage
```

Then fill in:

1. `README.md`
2. `docs/Requirements.md`
3. `docs/Tech-Stack.md`
4. `TODO.md`
5. `MEMORY.md`

## Git

Use Conventional Commits. Commits involving AI assistance should keep the AI attribution fields from `.gitmessage`.

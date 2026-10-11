# AI Ready Project Template

General-purpose starter template for AI-assisted projects. Use it for interactive work with coding assistants, research-heavy projects, documentation projects, or as a light baseline for agentic workflows.

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

# Instructions for AI Coding Assistants

Start here before doing any work in this repository.

## Project Purpose

This repository is a general AI-ready project template. It is meant to work for interactive AI-assisted work first, while still being structured enough for light agentic workflows.

For project-specific requirements, read `docs/Requirements.md`.

## Required First Reads

Before planning or editing, read:

- `README.md`
- `MEMORY.md`
- `docs/Requirements.md`
- Run `awb task next` to get the next recommended task, or read `TODO.md` if AWB is not configured.
- `docs/Tech-Stack.md`
- Any files directly related to the requested task

If the task touches architecture, sequencing, or delivery, also read `docs/Architecture.md` and `docs/Implementation.md`.

## Root Files

The root files are the durable handoff contract:

- `AGENTS.md` - AI assistant instructions.
- `README.md` - human-facing project overview.
- `TODO.md` - task tracking, priorities, blockers, and completed work (fallback when AWB is not configured).
- `MEMORY.md` - persistent decisions, milestones, context, and run notes.
- `status.yaml` - project state fallback (used when AWB is not configured).
- `.awb/config.yaml` - Agent Workbench per-repo config (API URL and project slug).
- `.gitmessage` - Conventional Commit template with AI attribution fields.

## Working Rules

- Check `git status` before editing.
- Pull latest changes before starting when network and permissions allow.
- Do not overwrite user changes.
- Keep edits focused on the current task.
- Record meaningful decisions, blockers, and milestones in `MEMORY.md`.
- Keep `TODO.md` current when tasks are added, started, blocked, or completed.
- Update docs when behavior, setup, requirements, or workflows change.
- Add tests or validation steps appropriate to the project and risk.
- Do not commit secrets or credentials.

## Task Workflow

Task state is tracked using Agent Workbench (`awb`). Set your agent name once per session:

```bash
export AWB_AGENT=<your-agent-name>
```

Then use standard AWB commands:

```bash
awb task next                                                  # get the next recommended task
awb task claim <task-id>                                       # claim it
awb task complete <task-id> --summary "What was done"          # mark complete
awb task block <task-id> --reason "<exact blocker>"            # mark blocked
awb task create --title "..." --priority high                  # add a new task
```

The `.awb/config.yaml` file auto-loads `api_url` and `project` — only `AWB_AGENT` needs to be set per session.

**Fallback (no AWB):** If `.awb/config.yaml` has unresolved placeholders or AWB is unreachable, use `TODO.md` for task tracking.

## Status Workflow

Project status is tracked using `awb status`:

```bash
awb status show                                                            # view current status
awb status create --status active --phase <phase> --summary "..."          # create a record
awb status update <id> --version <n> --status blocked --reason "..."       # update a record
```

**Fallback (no AWB):** Edit `status.yaml` directly. Status values:

- `active` - work may proceed.
- `paused` - do not perform automated work.
- `blocked` - waiting on a human decision, credential, source file, or validation.
- `working` - a human or agent is actively changing the repo; other agents should skip.
- `error` - repo or automation state is unsafe; stop and request recovery.
- `stopped` - project is complete or intentionally shut down.

Automated agents should return to `active`, `blocked`, `error`, or `stopped` before ending a run.

## Project Structure

```text
/                         # Root folder with the durable handoff files
  README.md               # Human-facing overview and setup
  AGENTS.md               # AI assistant instructions
  TODO.md                 # Prioritized tasks and blockers
  MEMORY.md               # Persistent project memory
  status.yaml             # Agent/human workflow state
  .gitmessage             # Commit template with AI attribution

  docs/                   # Requirements, architecture, stack, implementation notes
    Requirements.md
    Architecture.md
    Tech-Stack.md
    Implementation.md
    diagrams/

  agents/                 # Optional supplemental AI context
    Chat-Template.md      # Template for local or external chat transcripts
    Decisions.md          # Optional decision log when more detail is useful
    Research.md           # Optional research notes and references

  .agents/chats/          # Local transcript workspace; transcript files ignored

  src/                    # Project source, when applicable
  build/                  # Build artifacts; ignored by Git
  working/                # Temporary scratch files; ignored by Git
```

## Chat Logs And External Agent Logs

Chat transcript files are useful for context but should not be committed by default. Keep temporary transcripts under `.agents/chats/` if needed; Git ignores Markdown files in that folder while keeping the folder placeholder.

Agent workflow managers should copy or mirror full transcripts and runtime logs to their own storage. Hermes-compatible defaults are:

- Runtime logs: `/var/log/hermes`
- Mirrored logs: `/mnt/hermes/logs`
- Project output and transcripts: `/mnt/hermes/output/<project-name>/`

For n8n, OpenClaw, or another orchestrator, use equivalent configured storage.

## Commit Guidance

Use Conventional Commits:

```text
type(scope): short description
```

Include AI attribution for AI-assisted commits using `.gitmessage`.

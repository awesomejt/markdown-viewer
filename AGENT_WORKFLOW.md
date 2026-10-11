# Agent Workflow

Operating loop for interactive assistants and recurring local or cloud agents.

## Single Session Mode

Use this mode when a human starts an assistant manually.

1. Read `AGENTS.md`.
2. Read `README.md` and `MEMORY.md`. Read project docs relevant to the task, especially `docs/Requirements.md`.
3. Run `awb task next` for the next recommended task, or read `TODO.md` if AWB is not configured.
4. Check `git status`.
5. Plan the work, ask for critical decisions, then implement the selected task.
6. Run appropriate tests or validation.
7. Mark the task complete with `awb task complete <id> --summary "..."` (or update `TODO.md`).
8. Update `MEMORY.md` and docs as needed.
9. Summarize the result and any follow-up.

## Agentic Loop

Use this loop for scheduled or autonomous agents.

1. Pull the latest changes.
2. Read `AGENTS.md` and `MEMORY.md`. Append runtime logs to the agent manager's log storage, not to Git.
3. Check project status via `awb status show` (fall back to reading `status.yaml`). Act on the current status:
   - `stopped` - halt.
   - `paused` - halt without work.
   - `blocked` - halt until the blocker is resolved.
   - `working` - another worker is active; skip this cycle.
   - `error` - halt and require human recovery.
   - `active` - continue.
4. Run `awb task next` to get the next task (fall back to the highest-priority unblocked task in `TODO.md`).
5. Claim the task: `awb task claim <task-id>` (or move it to `In Progress` in `TODO.md`).
6. Work only that task.
7. Update tests, docs, and `MEMORY.md`.
8. If blocked:
   - `awb task block <task-id> --reason "<exact blocker>"` (or move to `Blocked` in `TODO.md`).
   - `awb status create --status blocked --phase <phase> --reason "..."` (or set `status: blocked` in `status.yaml`).
   - Record the exact next human action needed in `MEMORY.md`.
9. If complete:
   - `awb task complete <task-id> --summary "..."` (or move to `Done` in `TODO.md`).
   - `awb status create --status active --phase <phase> --summary "..."` (or return `status.yaml` to `active`).
10. Commit only coherent changes when the workflow explicitly calls for commits.

## Chat Logs

Full transcripts are not committed. Temporary local transcripts may be written under `.agents/chats/`, but Markdown transcript files there are ignored by Git.

Workflow managers should copy transcripts and runtime logs to external storage. Hermes-compatible defaults:

- Runtime logs: `/var/log/hermes`
- Mirrored logs: `/mnt/hermes/logs`
- Project outputs and transcripts: `/mnt/hermes/output/<project-name>/`

For n8n, OpenClaw, or another manager, use equivalent configured output storage.

## Blocker Handling

When blocked:

1. Stop the task.
2. Run `awb task block <task-id> --reason "<exact blocker>"` (or move the task to `Blocked` in `TODO.md`).
3. Update project status: `awb status create --status blocked --phase <phase> --reason "..."` (or set `status: blocked` in `status.yaml`).
4. Add a concise entry to `MEMORY.md` with the blocker and the exact human action needed.

Do not guess on credentials, account access, platform policy, security-sensitive behavior, or current external facts.

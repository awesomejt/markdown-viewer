#!/usr/bin/env bash
# PreToolUse hook: refuse to start a new task branch unless main is clean and
# every local branch is merged into main (AGENTS.md "Git Workflow", step 1).
set -euo pipefail

cmd=$(jq -r '.tool_input.command // ""')

# Only branch creation is gated; everything else passes through.
if ! grep -Eq '(^|[;&|[:space:]])git[[:space:]]+(switch[[:space:]]+(-c|--create|-C)|checkout[[:space:]]+-b|branch[[:space:]]+[^-[:space:]])' <<<"$cmd"; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
problems=()
[[ "$(git branch --show-current)" == main ]] || problems+=("not on main")
[[ -z "$(git status --porcelain)" ]] || problems+=("working tree is not clean")
unmerged=$(git branch --no-merged main --format='%(refname:short)')
[[ -z "$unmerged" ]] || problems+=("unmerged branches: ${unmerged//$'\n'/, }")

if ((${#problems[@]})); then
  msg=$(printf '%s; ' "${problems[@]}")
  printf 'Blocked: finish the previous task first (%s). Merge or report it before branching.\n' "${msg%; }" >&2
  exit 2
fi
exit 0

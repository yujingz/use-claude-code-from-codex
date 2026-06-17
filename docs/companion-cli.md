# Optional Companion CLI

The companion CLI is for advanced use cases where plain `$claude-from-codex` usage is not enough.

Use it when you need:

- setup diagnostics for the Codex-vs-terminal environment
- stricter child-process environment filtering
- background Claude jobs
- cancellation, result retrieval, and state pruning

It has no npm dependencies, but it requires Node.

## Setup Diagnostics

From the repo root:

```sh
node skills/claude-from-codex/scripts/claude-companion.mjs setup --json
```

From an installed global skill:

```sh
node "$HOME/.agents/skills/claude-from-codex/scripts/claude-companion.mjs" setup --json
```

## Foreground Run

Set `PROMPT` to the task text you want Claude to receive, then pass it on stdin:

```sh
printf '%s\n' "$PROMPT" | node skills/claude-from-codex/scripts/claude-companion.mjs run --json
```

Write-capable runs should be used only when the user explicitly asks for edits:

```sh
printf '%s\n' "$PROMPT" | node skills/claude-from-codex/scripts/claude-companion.mjs run --write --json
```

After any write-capable run, inspect the full workspace diff before continuing.

## Background Jobs

Start a background job:

```sh
printf '%s\n' "$PROMPT" | node skills/claude-from-codex/scripts/claude-companion.mjs run --background --json
```

Manage background jobs:

```sh
node skills/claude-from-codex/scripts/claude-companion.mjs status --json
node skills/claude-from-codex/scripts/claude-companion.mjs status <job-id> --json
node skills/claude-from-codex/scripts/claude-companion.mjs result <job-id> --json
node skills/claude-from-codex/scripts/claude-companion.mjs cancel <job-id> --json
node skills/claude-from-codex/scripts/claude-companion.mjs prune --older-than 7d --json
```

Background state is stored outside the repo under:

```text
${CLAUDE_FROM_CODEX_STATE_ROOT:-${XDG_STATE_HOME:-~/.local/state}/claude-from-codex}
```

Set `CLAUDE_FROM_CODEX_STATE_ROOT` if you want to keep job state in a custom owner-only directory.

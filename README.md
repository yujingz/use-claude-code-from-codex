# Claude from Codex

A plain Codex skill for asking the local Claude Code CLI to help from inside Codex.

The skill has two paths:

- Basic path: no JavaScript required. Codex calls the user's `claude` CLI directly for simple second opinions, review, and investigation.
- Advanced path: Node required. Codex uses the optional companion script for setup diagnostics, environment filtering, background jobs, cancellation, and pruning.

Claude auth, cc-switch, provider routing, and `~/.claude/settings.json` remain external user setup. This repo does not edit them.

## Install

There are two install paths. The simple path does not require Node. The `npx` path is just a convenience wrapper around the same symlink.

### Simple Symlink

Clone or download this repo, then link the skill folder into the documented Codex user-scope skills directory:

```sh
git clone https://github.com/yujingz/use-claude-code-from-codex.git
cd use-claude-code-from-codex
mkdir -p "$HOME/.agents/skills"
ln -s "$PWD/skills/claude-from-codex" "$HOME/.agents/skills/claude-from-codex"
```

`~/.codex/skills` works in some local Codex versions, but `$HOME/.agents/skills` is the documented portable target.

### Optional npx Installer

If Node is available, the package also exposes a tiny installer that creates the same symlink:

```sh
npx -y github:yujingz/use-claude-code-from-codex
```

From a local checkout:

```sh
pnpm install:skill
```

The installer refuses to overwrite an existing different skill unless you pass `--force`:

```sh
claude-from-codex-skill install --force
```

### Verify Discovery

Restart Codex or start a new Codex session, then check that `$claude-from-codex` appears in the available skills. A no-model-call local check is:

```sh
codex debug prompt-input '$claude-from-codex discovery check; do not run commands' | rg 'claude-from-codex'
```

## Basic Usage

This path only needs Claude Code CLI.

```sh
claude --setting-sources user,project,local auth status --json
```

Read-biased prompt:

```sh
printf '%s\n' "$PROMPT" | claude -p --output-format json --setting-sources user,project,local --permission-mode plan --allowedTools Read,Grep,Glob --disable-slash-commands --no-session-persistence
```

If Codex cannot find `claude` on PATH, try the common local install path:

```sh
printf '%s\n' "$PROMPT" | "$HOME/.local/bin/claude" -p --output-format json --setting-sources user,project,local --permission-mode plan --allowedTools Read,Grep,Glob --disable-slash-commands --no-session-persistence
```

Use write-capable Claude only when the user explicitly asks for it:

```sh
printf '%s\n' "$PROMPT" | claude -p --output-format json --setting-sources user,project,local --permission-mode default --disable-slash-commands --no-session-persistence
```

After any write-capable run, inspect the workspace diff before continuing.

## Advanced Usage

The companion script is optional and has no npm dependencies, but it requires Node.

Setup diagnostics:

```sh
node skills/claude-from-codex/scripts/claude-companion.mjs setup --json
```

Foreground run through the companion:

```sh
printf '%s\n' "$PROMPT" | node skills/claude-from-codex/scripts/claude-companion.mjs run --json
```

Background run:

```sh
printf '%s\n' "$PROMPT" | node skills/claude-from-codex/scripts/claude-companion.mjs run --background --json
```

Manage background jobs:

```sh
node skills/claude-from-codex/scripts/claude-companion.mjs status --json
node skills/claude-from-codex/scripts/claude-companion.mjs result <job-id> --json
node skills/claude-from-codex/scripts/claude-companion.mjs cancel <job-id> --json
node skills/claude-from-codex/scripts/claude-companion.mjs prune --older-than 7d --json
```

Background state is stored outside the repo under:

```text
${CLAUDE_FROM_CODEX_STATE_ROOT:-${XDG_STATE_HOME:-~/.local/state}/claude-from-codex}
```

## Validate

Author-time validation uses Node's built-in test runner through pnpm:

```sh
pnpm test
```

The tests use a fake Claude executable. They do not call the real Claude API.

For a non-generative live setup check:

```sh
node skills/claude-from-codex/scripts/claude-companion.mjs setup --json
```

Live foreground smoke tests can spend Claude tokens, so run them only when you intend to verify the current Claude CLI contract.

## Deferred Scope

This v1 does not include a Codex plugin wrapper, marketplace packaging, Windows background cancellation, rich transcript sync, or automatic full-session context transfer. Those can be added after the plain skill proves useful.

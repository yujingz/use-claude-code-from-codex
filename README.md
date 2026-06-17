# Claude from Codex

A Codex skill for asking the local Claude Code CLI to help from inside Codex.

The skill has two paths:

- Basic path: no JavaScript required. Codex calls the user's `claude` CLI directly for simple second opinions, review, and investigation.
- Advanced path: Node required. Codex uses the optional companion script for setup diagnostics, environment filtering, background jobs, cancellation, and pruning.

Claude auth, cc-switch, provider routing, and `~/.claude/settings.json` remain external user setup. This repo does not edit them.

## Install

Use [`vercel-labs/skills`](https://github.com/vercel-labs/skills) as the default installer:

```sh
npx skills add yujingz/use-claude-code-from-codex --skill claude-from-codex -g -a codex -y
```

This installs the skill globally for Codex.

### Manual Install

If you do not want to use `npx skills`, download or clone this repo and link the skill folder yourself:

```sh
git clone https://github.com/yujingz/use-claude-code-from-codex.git
cd use-claude-code-from-codex
mkdir -p "$HOME/.agents/skills"
ln -s "$PWD/skills/claude-from-codex" "$HOME/.agents/skills/claude-from-codex"
```

If your Codex setup uses a different skills directory, link the same `skills/claude-from-codex` folder there instead.

### Verify Discovery

Restart Codex or start a new Codex session, then check that `$claude-from-codex` appears in the available skills. No-model-call local checks:

```sh
npx skills list -g -a codex
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

## Optional Companion CLI

The companion script is useful when you want setup diagnostics, cleaner child-process environment handling, or background Claude jobs. It has no npm dependencies, but it requires Node.

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

## Development

Run the test suite with pnpm:

```sh
pnpm test
```

The tests use a fake Claude executable. They do not call the real Claude API.

For a non-generative live setup check:

```sh
node skills/claude-from-codex/scripts/claude-companion.mjs setup --json
```

Live foreground smoke tests can spend Claude tokens, so run them only when you intend to make a real Claude call.

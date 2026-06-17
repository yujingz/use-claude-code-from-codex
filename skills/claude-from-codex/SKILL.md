---
name: claude-from-codex
description: Delegate explicit Codex tasks to the local Claude Code CLI for parallel investigation, review, second opinions, and bounded implementation slices.
---

# Claude From Codex

## When To Use

Use this skill when the user wants Codex to involve local Claude Code as a second model or parallel worker. Good fits include:

- Independent investigation or review while Codex keeps working.
- A second opinion on a plan, diff, failure, or design choice.
- A bounded implementation slice where the user explicitly allows Claude to write.
- Long-running analysis that should continue in the background.

Do not use this skill to configure Claude auth, provider routing, cc-switch, or `~/.claude/settings.json`. Those are external user setup. Run setup diagnostics and tell the user what must be fixed outside Codex.

## Choose The Path

Use the simplest path that fits the task.

- Basic path, no JavaScript required: call the user's `claude` CLI directly for simple foreground review, second opinion, or investigation.
- Advanced path, Node required: use `scripts/claude-companion.mjs` for setup diagnostics, Codex-vs-terminal environment debugging, background jobs, cancellation, state pruning, or stricter env filtering.

## Rules

- Pass the task prompt on stdin, never as a command-line argument.
- Include explicit context in the prompt: goal, relevant paths, constraints, acceptance criteria, and whether this is read-only or write-capable.
- Default to read-biased delegation. Use write-capable Claude work only when the current user turn explicitly asks for it.
- Treat Claude's output as input to reconcile. Inspect any factual claims or reported changes before integrating them.
- For write-capable runs, inspect the full workspace diff, including git metadata and unexpected files, before continuing.
- If direct `claude` behaves differently inside Codex than in a normal terminal, switch to the advanced setup diagnostics instead of editing Claude settings.

## Basic Commands

These commands require only the user's Claude Code CLI. They do not require Node or the companion script.

Check auth visibility from the current Codex process:

```sh
claude --setting-sources user,project,local auth status --json
```

Foreground read-biased run, with prompt on stdin:

```sh
printf '%s\n' "$PROMPT" | claude -p --output-format json --setting-sources user,project,local --permission-mode plan --allowedTools Read,Grep,Glob --disable-slash-commands --no-session-persistence
```

Use write-capable direct Claude only after explicit user request and normal Claude permission handling:

```sh
printf '%s\n' "$PROMPT" | claude -p --output-format json --setting-sources user,project,local --permission-mode default --disable-slash-commands --no-session-persistence
```

If `claude` is not on PATH inside Codex, try the common user-local binary directly:

```sh
printf '%s\n' "$PROMPT" | "$HOME/.local/bin/claude" -p --output-format json --setting-sources user,project,local --permission-mode plan --allowedTools Read,Grep,Glob --disable-slash-commands --no-session-persistence
```

## Advanced Commands

Use these only when Node is available and the task benefits from diagnostics, env filtering, or background job management. From this skill folder, the companion is:

```sh
node scripts/claude-companion.mjs setup
```

When invoking from another working directory, use the absolute installed path:

```sh
node "$HOME/.agents/skills/claude-from-codex/scripts/claude-companion.mjs" setup --json
```

Foreground read-biased run through the companion:

```sh
printf '%s\n' "$PROMPT" | node "$HOME/.agents/skills/claude-from-codex/scripts/claude-companion.mjs" run --json
```

Foreground write-capable run, only after explicit user request:

```sh
printf '%s\n' "$PROMPT" | node "$HOME/.agents/skills/claude-from-codex/scripts/claude-companion.mjs" run --write --json
```

Background run:

```sh
printf '%s\n' "$PROMPT" | node "$HOME/.agents/skills/claude-from-codex/scripts/claude-companion.mjs" run --background --json
```

Background management:

```sh
node "$HOME/.agents/skills/claude-from-codex/scripts/claude-companion.mjs" status --json
node "$HOME/.agents/skills/claude-from-codex/scripts/claude-companion.mjs" status <job-id> --json
node "$HOME/.agents/skills/claude-from-codex/scripts/claude-companion.mjs" result <job-id> --json
node "$HOME/.agents/skills/claude-from-codex/scripts/claude-companion.mjs" cancel <job-id> --json
node "$HOME/.agents/skills/claude-from-codex/scripts/claude-companion.mjs" prune --older-than 7d --json
```

## Prompt Shape

When delegating, write a self-contained prompt. Claude does not receive the full Codex transcript automatically.

```text
Goal: ...
Workspace: ...
Relevant files:
- ...
Mode: read-biased investigation | write-capable implementation
Constraints:
- ...
Acceptance criteria:
- ...
Return:
- Findings, decisions, changed files if any, and remaining risks.
```

## Result Handling

For read-biased runs, summarize Claude's findings and verify any factual claims against the workspace when they matter.

For write-capable runs, require the companion result to show mode, exit status, changed files, and the diff-inspection reminder. Then inspect the local diff before continuing.

## Boundaries

This v1 skill is a plain Codex skill folder. It does not require a Codex plugin or marketplace login. Future plugin packaging, richer session sync, Windows background cancellation, and enforced sandboxing are deferred.

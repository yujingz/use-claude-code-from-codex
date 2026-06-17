# Claude from Codex

[![Codex Skill](https://img.shields.io/badge/Codex-Skill-000000)](https://developers.openai.com/codex/skills)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Supported-6B5B95)](https://www.anthropic.com/claude-code)
[![Local First](https://img.shields.io/badge/Local--first-No%20hosted%20service-2563EB)](#troubleshooting)
[![No Plugin Required](https://img.shields.io/badge/No%20Codex%20plugin-required-16A34A)](#install)
[![Node Optional](https://img.shields.io/badge/Node-optional-F59E0B)](docs/companion-cli.md)

Use local Claude Code from Codex for second opinions, code review, and parallel investigation without leaving your Codex session.

Prerequisite: Claude Code should already work on your machine.

Works as a plain skill folder. No Codex plugin login or marketplace packaging is required.

## 30 Second Start

Paste this into Codex UI or Codex CLI:

```text
Install the Codex skill from https://github.com/yujingz/use-claude-code-from-codex.
Prefer the vercel-labs/skills installer if it is available.
Install the skill named claude-from-codex for Codex, then verify that $claude-from-codex is discoverable.
```

Then ask:

```text
Use $claude-from-codex to ask Claude for a read-only review of my current diff.
Focus on bugs, security issues, and missing tests.
```

## Use It For

| Task | Example prompt |
| --- | --- |
| Code review | `Use $claude-from-codex to ask Claude for a read-only review of my current diff.` |
| Plan review | `Use $claude-from-codex to get Claude's second opinion on this implementation plan before we code.` |
| Parallel investigation | `Use $claude-from-codex to have Claude investigate why this test is failing. Do not edit files.` |
| Documentation review | `Use $claude-from-codex to ask Claude whether this README is clear for a first-time user.` |
| Small write-capable pass | `Use $claude-from-codex to let Claude make a small implementation pass, then show me the diff before we continue.` |

More copy-paste prompts are in [docs/examples.md](docs/examples.md).

## Install

### Ask Codex To Install It

If you want a dedicated install prompt, paste this into your current agent:

```text
Install the Codex skill from https://github.com/yujingz/use-claude-code-from-codex.
Prefer the vercel-labs/skills installer if it is available.
Install the skill named claude-from-codex for Codex, then verify that $claude-from-codex is discoverable.
```

### Install From Terminal

If you prefer a terminal command, use [`vercel-labs/skills`](https://github.com/vercel-labs/skills):

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

Restart Codex or start a new Codex session, then check that `$claude-from-codex` appears in the available skills.

If you installed from a terminal, these local checks can help:

```sh
npx skills list -g -a codex
codex debug prompt-input '$claude-from-codex discovery check; do not run commands' | rg 'claude-from-codex'
```

## Basic Usage

After installation, just ask Codex to use the skill. You do not need to run Claude commands yourself.

Treat Claude's answer as one review signal, not ground truth. Keep checking files, tests, and diffs before acting on Claude's advice.

For write-capable work, say that explicitly:

```text
Use $claude-from-codex to let Claude make a small implementation pass on this bug.
Keep the change scoped to the failing test, then show me the diff before we continue.
```

## Troubleshooting

If Claude works in your normal terminal but not inside Codex, ask Codex:

```text
Use $claude-from-codex to check whether Codex can see my local Claude Code CLI.
Report what is missing.
```

Common causes:

- `claude` is not on the PATH visible to Codex.
- Codex was launched from an environment that cannot see the same tools as your terminal.

Advanced diagnostics and background job commands are documented in [docs/companion-cli.md](docs/companion-cli.md).

## Development

Run the test suite with pnpm:

```sh
pnpm test
```

The tests use a fake Claude executable. They do not call the real Claude API.

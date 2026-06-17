# Claude from Codex Examples

Copy one of these prompts into Codex after installing `$claude-from-codex`.

## Install The Skill

```text
Install the Codex skill from https://github.com/yujingz/use-claude-code-from-codex.
Prefer the vercel-labs/skills installer if it is available.
Install the skill named claude-from-codex for Codex, then verify that $claude-from-codex is discoverable.
```

## Review A Diff

```text
Use $claude-from-codex to ask Claude for a read-only review of my current diff.
Focus on bugs, security issues, behavioral regressions, and missing tests.
Summarize Claude's findings, then verify anything important against the actual files before acting.
```

## Get A Second Opinion On A Plan

```text
Use $claude-from-codex to ask Claude for a second opinion on this implementation plan.
Ask it to look for overengineering, unclear requirements, missing tests, and simpler alternatives.
Do not edit files.
```

## Investigate A Failing Test

```text
Use $claude-from-codex to have Claude investigate why this test is failing.
Mode: read-only investigation.
Give it the failing command, the error output, and the likely files to inspect.
Return Claude's hypothesis, evidence, and suggested next step.
```

## Run A Parallel Documentation Review

```text
Use $claude-from-codex to ask Claude whether this README is clear for a first-time user.
Focus on install steps, basic usage, confusing terminology, and anything that sounds like internal implementation notes.
Do not edit files.
```

## Let Claude Make A Small Change

Use this only when you explicitly want Claude to edit files.

```text
Use $claude-from-codex to let Claude make a small implementation pass on this bug.
Keep the change scoped to the failing test.
After Claude finishes, inspect the full diff and show me what changed before continuing.
```

## Diagnose Claude Visibility From Codex

```text
Use $claude-from-codex to check whether Codex can see my local Claude Code CLI.
Report whether Claude is available, whether setup diagnostics pass, and what is missing.
Do not change my system settings.
```

## Run Longer Work In The Background

```text
Use $claude-from-codex to start a background Claude investigation for this flaky test.
Give Claude the failing command, recent logs, and relevant files.
Check the job result later and summarize only verified findings.
```

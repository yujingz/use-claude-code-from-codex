import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseArgs, parseDuration } from "../skills/claude-from-codex/scripts/lib/args.mjs";
import { buildChildEnv } from "../skills/claude-from-codex/scripts/lib/env.mjs";
import { buildClaudeRunArgs, spawnCapture } from "../skills/claude-from-codex/scripts/lib/process.mjs";
import { resolveClaudeBinary } from "../skills/claude-from-codex/scripts/lib/resolver.mjs";
import { createJob, readJob, updateJobGuarded } from "../skills/claude-from-codex/scripts/lib/state.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "skills/claude-from-codex/scripts/claude-companion.mjs");
const skillPath = path.join(repoRoot, "skills/claude-from-codex/SKILL.md");
const openaiYamlPath = path.join(repoRoot, "skills/claude-from-codex/agents/openai.yaml");

test("skill metadata has concrete Claude delegation guidance", async () => {
  const skill = await fsp.readFile(skillPath, "utf8");
  const yaml = await fsp.readFile(openaiYamlPath, "utf8");

  assert.match(skill, /^name: claude-from-codex$/m);
  assert.match(skill, /description: .*Claude Code.*parallel investigation.*review.*implementation slices/i);
  assert.doesNotMatch(skill, /TODO/);
  for (const required of [
    "Basic path, no JavaScript required",
    "claude --setting-sources user,project,local auth status --json",
    "claude -p --output-format json",
    "$HOME/.local/bin/claude",
    "Advanced path, Node required",
    "claude-companion.mjs\" setup",
    "run --json",
    "status <job-id>",
    "result <job-id>",
    "cancel <job-id>",
    "prune --older-than",
    "prompt on stdin",
    "only when the current user turn explicitly asks",
  ]) {
    assert.match(skill, new RegExp(escapeRegExp(required)));
  }

  assert.match(yaml, /display_name: "Claude from Codex"/);
  assert.match(yaml, /allow_implicit_invocation: true/);
});

test("argument parser keeps the stable command surface small", () => {
  assert.equal(parseArgs(["run"]).mode, "readonly");
  assert.deepEqual(parseArgs(["run", "--write", "--json"]).mode, "write");
  assert.equal(parseArgs(["run", "--background"]).background, true);
  assert.equal(parseArgs(["prune", "--older-than", "7d"]).olderThanMs, 7 * 24 * 60 * 60 * 1000);
  assert.equal(parseDuration("5m"), 5 * 60 * 1000);
  assert.throws(() => parseArgs(["run", "--readonly", "--write"]), /either --readonly or --write/);
});

test("child environment strips Codex secrets and constructs a trusted PATH", () => {
  const env = buildChildEnv(
    {
      HOME: os.homedir(),
      USER: "yz",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      CLAUDE_CODE_SIMPLE: "1",
      OPENAI_API_KEY: "sk-test",
      GITHUB_TOKEN: "ghp_test",
      AWS_SECRET_ACCESS_KEY: "aws",
      HTTPS_PROXY: "http://proxy.invalid",
      PATH: `${repoRoot}/node_modules/.bin${path.delimiter}.${path.delimiter}/usr/bin`,
    },
    {
      claudePath: path.join(os.homedir(), ".local/bin/claude"),
      nodePath: process.execPath,
      workspaceRoot: repoRoot,
    },
  );

  assert.equal(env.HOME, os.homedir());
  assert.equal(env.USER, "yz");
  assert.equal(env.CLAUDE_CODE_SIMPLE, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.equal(env.LC_ALL, "en_US.UTF-8");
  const pathParts = env.PATH.split(path.delimiter);
  assert.equal(pathParts.includes("."), false);
  assert.equal(pathParts.some((part) => part.startsWith(repoRoot)), false);
  assert.equal(pathParts.some((part) => part.endsWith(`${path.sep}node_modules${path.sep}.bin`)), false);
});

test("Claude argv is read-biased by default and write-capable only by flag", () => {
  const readonlyArgs = buildClaudeRunArgs({ mode: "readonly", maxBudgetUsd: "0.10" });
  assert.deepEqual(readonlyArgs.slice(0, 5), ["-p", "--output-format", "json", "--setting-sources", "user,project,local"]);
  assert.equal(readonlyArgs.includes("--bare"), false);
  assert.equal(readonlyArgs.includes("my prompt"), false);
  assert.equal(valueAfter(readonlyArgs, "--permission-mode"), "plan");
  assert.equal(valueAfter(readonlyArgs, "--allowedTools"), "Read,Grep,Glob");
  assert.equal(valueAfter(readonlyArgs, "--max-budget-usd"), "0.10");

  const writeArgs = buildClaudeRunArgs({ mode: "write" });
  assert.equal(valueAfter(writeArgs, "--permission-mode"), "default");
  assert.equal(writeArgs.includes("--allowedTools"), false);
  assert.equal(writeArgs.includes("--dangerously-skip-permissions"), false);
});

test("resolver rejects unsafe Claude binary inputs", async () => {
  assert.equal((await resolveClaudeBinary({ env: { CLAUDE_BIN: "./claude" }, workspaceRoot: repoRoot })).ok, false);

  const fixture = await makeFixture();
  const unsafe = path.join(fixture.dir, "unsafe-claude");
  await fsp.writeFile(unsafe, "#!/usr/bin/env node\n");
  await fsp.chmod(unsafe, 0o777);
  const unsafeResult = await resolveClaudeBinary({ env: { CLAUDE_BIN: unsafe }, workspaceRoot: repoRoot });
  assert.equal(unsafeResult.ok, false);
  assert.match(unsafeResult.message, /group- or world-writable/);

  const home = path.join(fixture.dir, "home");
  const target = path.join(fixture.dir, "outside-claude");
  const link = path.join(home, ".local/bin/claude");
  await fsp.mkdir(path.dirname(link), { recursive: true, mode: 0o700 });
  await writeFakeClaude(target);
  await fsp.symlink(target, link);
  const symlinkResult = await resolveClaudeBinary({ env: { HOME: home, PATH: "" }, home, workspaceRoot: repoRoot });
  assert.equal(symlinkResult.ok, false);
  assert.match(symlinkResult.warnings.join("\n"), /outside trusted roots/);
});

test("resolver discovers user-local Claude from env HOME before PATH", async () => {
  const fixture = await makeFixture();
  const home = path.join(fixture.dir, "home");
  const bin = path.join(home, ".local/bin/claude");
  await fsp.mkdir(path.dirname(bin), { recursive: true, mode: 0o700 });
  await writeFakeClaude(bin);

  const result = await resolveClaudeBinary({ env: { HOME: home, PATH: "" }, workspaceRoot: repoRoot });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.source, "user-local");
  assert.equal(result.realPath, await fsp.realpath(bin));
});

test("companion setup reports ready false instead of throwing when Claude is missing", async () => {
  const fixture = await makeFixture();
  const result = await spawnCapture(process.execPath, [scriptPath, "setup", "--json"], {
    cwd: repoRoot,
    env: {
      HOME: path.join(fixture.dir, "home"),
      PATH: "",
    },
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, false);
  assert.equal(payload.claudeBinaryPath, null);
  assert.match(payload.hint, /Claude binary was not found/);
});

test("setup uses auth status without leaking token-shaped fields", async () => {
  const fixture = await makeFixture();
  const fake = await writeFakeClaude(path.join(fixture.dir, "claude"));
  const result = await spawnCapture(process.execPath, [scriptPath, "setup", "--json"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAUDE_BIN: fake.bin,
      CLAUDE_CODE_SIMPLE: "1",
      OPENAI_API_KEY: "sk-test-secret",
      HTTPS_PROXY: "http://proxy.invalid",
    },
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, true);
  assert.equal(payload.auth.loggedIn, true);
  assert.equal(payload.auth.authMethod, "oauth_token");
  assert.equal(payload.auth.apiProvider, "firstParty");
  assert.equal(JSON.stringify(payload).includes("secret-token-value"), false);

  const record = JSON.parse(await fsp.readFile(fake.recordPath, "utf8"));
  assert.deepEqual(record.argv, ["--setting-sources", "user,project,local", "auth", "status", "--json"]);
  assert.equal(record.env.CLAUDE_CODE_SIMPLE, undefined);
  assert.equal(record.env.OPENAI_API_KEY, undefined);
  assert.equal(record.env.HTTPS_PROXY, undefined);
});

test("foreground run sends prompt on stdin with the read-biased Claude contract", async () => {
  const fixture = await makeFixture();
  const fake = await writeFakeClaude(path.join(fixture.dir, "claude"));
  const prompt = "Goal: inspect the repo\nReturn: concise findings\n";
  const result = await spawnCapture(process.execPath, [scriptPath, "run", "--json"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLAUDE_BIN: fake.bin,
      CLAUDE_CODE_SIMPLE: "1",
      OPENAI_API_KEY: "sk-test-secret",
      GITHUB_TOKEN: "ghp_testsecret",
      HTTPS_PROXY: "http://proxy.invalid",
    },
    input: prompt,
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "readonly");
  assert.equal(payload.argv.includes("--bare"), false);
  assert.equal(valueAfter(payload.argv, "--permission-mode"), "plan");
  assert.equal(valueAfter(payload.argv, "--allowedTools"), "Read,Grep,Glob");

  const record = JSON.parse(await fsp.readFile(fake.recordPath, "utf8"));
  assert.equal(record.stdin, prompt);
  assert.equal(record.argv.includes(prompt), false);
  assert.equal(record.env.CLAUDE_CODE_SIMPLE, undefined);
  assert.equal(record.env.OPENAI_API_KEY, undefined);
  assert.equal(record.env.GITHUB_TOKEN, undefined);
  assert.equal(record.env.HTTPS_PROXY, undefined);
});

test("write-capable foreground run reports advisory diff inspection fields", async () => {
  const fixture = await makeFixture();
  const fake = await writeFakeClaude(path.join(fixture.dir, "claude"));
  const result = await spawnCapture(process.execPath, [scriptPath, "run", "--write", "--json"], {
    cwd: repoRoot,
    env: { ...process.env, CLAUDE_BIN: fake.bin },
    input: "Mode: write-capable implementation\n",
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.mode, "write");
  assert.equal(valueAfter(payload.argv, "--permission-mode"), "default");
  assert.match(payload.diffInspectionReminder, /Inspect the full workspace diff/);
  assert.ok(Array.isArray(payload.changedFiles));
});

test("background job completes and result is retrievable", async () => {
  const fixture = await makeFixture();
  const fake = await writeFakeClaude(path.join(fixture.dir, "claude"));
  const stateRoot = path.join(fixture.dir, "state");
  const started = await spawnCapture(process.execPath, [scriptPath, "run", "--background", "--json"], {
    cwd: repoRoot,
    env: { ...process.env, CLAUDE_BIN: fake.bin, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot },
    input: "Background prompt\n",
  });

  assert.equal(started.exitCode, 0, started.stderr);
  const startPayload = JSON.parse(started.stdout);
  assert.equal(startPayload.ok, true);
  assert.equal(startPayload.status, "running");

  const jobStat = await fsp.stat(startPayload.stateFile);
  const jobsDirStat = await fsp.stat(path.dirname(startPayload.stateFile));
  assert.equal(jobStat.mode & 0o777, 0o600);
  assert.equal(jobsDirStat.mode & 0o777, 0o700);

  const resultPayload = await pollResult(startPayload.id, stateRoot);
  assert.equal(resultPayload.ok, true);
  assert.equal(resultPayload.job.status, "completed");
  assert.match(resultPayload.output.stdout, /fake result/);

  const status = await spawnCapture(process.execPath, [scriptPath, "status", "--json"], {
    cwd: repoRoot,
    env: { ...process.env, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot },
  });
  assert.equal(status.exitCode, 0);
  assert.equal(JSON.parse(status.stdout).jobs[0].id, startPayload.id);
});

test("cancel marks a detached long-running job cancelled and result refuses output", async () => {
  const fixture = await makeFixture();
  const fake = await writeFakeClaude(path.join(fixture.dir, "claude"));
  const stateRoot = path.join(fixture.dir, "state");
  const started = await spawnCapture(process.execPath, [scriptPath, "run", "--background", "--json"], {
    cwd: repoRoot,
    env: { ...process.env, CLAUDE_BIN: fake.bin, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot },
    input: "SLEEP_LONG\n",
  });
  const startPayload = JSON.parse(started.stdout);

  const cancelled = await spawnCapture(process.execPath, [scriptPath, "cancel", startPayload.id, "--json"], {
    cwd: repoRoot,
    env: { ...process.env, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot },
  });
  assert.equal(cancelled.exitCode, 0, cancelled.stderr);
  assert.equal(JSON.parse(cancelled.stdout).status, "cancelled");

  const result = await spawnCapture(process.execPath, [scriptPath, "result", startPayload.id, "--json"], {
    cwd: repoRoot,
    env: { ...process.env, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot },
  });
  assert.equal(result.exitCode, 1);
  assert.match(JSON.parse(result.stdout).error, /cancelled/);
});

test("terminal job states are not overwritten and redaction applies to summaries", async () => {
  const fixture = await makeFixture();
  const stateRoot = path.join(fixture.dir, "state");
  const created = await createJob({
    workspaceRoot: repoRoot,
    env: { ...process.env, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot },
    prompt: "token=sk-ant-oat01-secret ghp_secret AKIA1234567890ABCDEF",
    record: {
      id: "terminal-test",
      mode: "readonly",
      status: "cancelled",
      errorSummary: "password=sk-test-secret",
    },
  });

  const after = await updateJobGuarded({
    workspaceRoot: repoRoot,
    env: { ...process.env, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot },
    id: created.id,
    update: () => ({ status: "completed" }),
  });
  assert.equal(after.status, "cancelled");

  const stored = await readJob({ workspaceRoot: repoRoot, env: { ...process.env, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot }, id: created.id });
  assert.doesNotMatch(stored.promptPreview, /sk-ant|ghp_|AKIA/);
  assert.doesNotMatch(stored.errorSummary, /sk-test-secret/);
});

test("prune removes old job state files only from the state root", async () => {
  const fixture = await makeFixture();
  const stateRoot = path.join(fixture.dir, "state");
  const created = await createJob({
    workspaceRoot: repoRoot,
    env: { ...process.env, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot },
    prompt: "old prompt",
    record: {
      id: "old-job",
      mode: "readonly",
      status: "completed",
      updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      finishedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });

  const pruned = await spawnCapture(process.execPath, [scriptPath, "prune", "--older-than", "7d", "--json"], {
    cwd: repoRoot,
    env: { ...process.env, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot },
  });
  assert.equal(pruned.exitCode, 0, pruned.stderr);
  assert.deepEqual(JSON.parse(pruned.stdout).pruned, ["old-job"]);
  await assert.rejects(fsp.stat(created.jobFile), /ENOENT/);
});

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `${flag} missing from ${args.join(" ")}`);
  return args[index + 1];
}

async function makeFixture() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "claude-from-codex-test-"));
  await fsp.chmod(dir, 0o700);
  return { dir };
}

async function writeFakeClaude(bin) {
  const recordPath = `${bin}.record.json`;
  const source = `#!/usr/bin/env node
import fs from "node:fs";
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { stdin += chunk; });
process.stdin.on("end", () => {
  const record = {
    argv: process.argv.slice(2),
    stdin,
    env: {
      CLAUDE_CODE_SIMPLE: process.env.CLAUDE_CODE_SIMPLE,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      HTTPS_PROXY: process.env.HTTPS_PROXY,
      PATH: process.env.PATH,
      HOME: process.env.HOME
    }
  };
  fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify(record, null, 2));
  if (process.argv.includes("auth")) {
    console.log(JSON.stringify({
      loggedIn: true,
      authMethod: "oauth_token",
      apiProvider: "firstParty",
      token: "secret-token-value"
    }));
    return;
  }
  const finish = () => {
    console.log(JSON.stringify({ type: "result", result: "fake result", total_cost_usd: 0 }));
  };
  if (stdin.includes("SLEEP_LONG")) {
    setTimeout(finish, 30000);
  } else {
    setTimeout(finish, 50);
  }
});
`;
  await fsp.writeFile(bin, source, { mode: 0o700 });
  await fsp.chmod(bin, 0o700);
  return { bin, recordPath };
}

async function pollResult(id, stateRoot) {
  const deadline = Date.now() + 5000;
  let last;
  while (Date.now() < deadline) {
    const result = await spawnCapture(process.execPath, [scriptPath, "result", id, "--json"], {
      cwd: repoRoot,
      env: { ...process.env, CLAUDE_FROM_CODEX_STATE_ROOT: stateRoot },
    });
    last = result;
    if (result.exitCode === 0) {
      return JSON.parse(result.stdout);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for result: ${last?.stdout || last?.stderr}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

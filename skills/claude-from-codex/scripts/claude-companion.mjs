#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseArgs, UsageError, usage } from "./lib/args.mjs";
import { buildChildEnv } from "./lib/env.mjs";
import { readStdin } from "./lib/fs.mjs";
import { resolveClaudeBinary, resolveNodeBinary } from "./lib/resolver.mjs";
import { outputResult, runAuthProbe } from "./lib/process.mjs";
import {
  cancelJob,
  pruneOldJobs,
  resultJob,
  runClaudeForeground,
  runWorker,
  startBackgroundJob,
  statusJobs,
} from "./lib/jobs.mjs";

const scriptPath = fileURLToPath(import.meta.url);

async function main(argv) {
  const parsed = parseArgs(argv);
  const workspaceRoot = path.resolve(parsed.workspace || process.cwd());

  if (parsed.command === "help") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  if (parsed.command === "worker") {
    await runWorker({ id: parsed.id, workspaceRoot, env: process.env });
    return 0;
  }

  if (parsed.command === "setup") {
    const payload = await setup({ workspaceRoot, env: process.env });
    process.stdout.write(outputResult(payload, { json: parsed.json, renderHuman: renderSetup }));
    return 0;
  }

  if (parsed.command === "run") {
    const prompt = await readStdin();
    if (parsed.background) {
      const payload = await startBackgroundJob({ prompt, parsed: { ...parsed, workspace: workspaceRoot }, scriptPath, env: process.env });
      process.stdout.write(outputResult(payload, { json: parsed.json, renderHuman: renderBackgroundStart }));
      return payload.ok ? 0 : 1;
    }

    const payload = await runClaudeForeground({
      prompt,
      mode: parsed.mode,
      workspaceRoot,
      env: process.env,
      maxBudgetUsd: parsed.maxBudgetUsd,
    });
    process.stdout.write(outputResult(payload, { json: parsed.json, renderHuman: renderRun }));
    return payload.ok ? 0 : 1;
  }

  if (parsed.command === "status") {
    const payload = await statusJobs({ workspaceRoot, env: process.env, id: parsed.id });
    process.stdout.write(outputResult(payload, { json: parsed.json, renderHuman: renderStatus }));
    return 0;
  }

  if (parsed.command === "result") {
    const payload = await resultJob({ workspaceRoot, env: process.env, id: parsed.id });
    process.stdout.write(outputResult(payload, { json: parsed.json, renderHuman: renderResult }));
    return payload.ok ? 0 : 1;
  }

  if (parsed.command === "cancel") {
    const payload = await cancelJob({ workspaceRoot, env: process.env, id: parsed.id });
    process.stdout.write(outputResult(payload, { json: parsed.json, renderHuman: renderCancel }));
    return payload.ok ? 0 : 1;
  }

  if (parsed.command === "prune") {
    const payload = await pruneOldJobs({ workspaceRoot, env: process.env, olderThanMs: parsed.olderThanMs });
    process.stdout.write(outputResult(payload, { json: parsed.json, renderHuman: renderPrune }));
    return 0;
  }

  throw new UsageError(`Unknown command: ${parsed.command}`);
}

async function setup({ workspaceRoot, env }) {
  const claude = await resolveClaudeBinary({ env, workspaceRoot });
  if (!claude.ok) {
    return {
      ready: false,
      claudeBinaryPath: null,
      auth: {
        loggedIn: false,
      },
      warnings: claude.warnings,
      hint: claude.message,
    };
  }

  const node = await resolveNodeBinary({ workspaceRoot });
  const childEnv = buildChildEnv(env, {
    claudePath: claude.realPath,
    nodePath: node.ok ? node.realPath : process.execPath,
    workspaceRoot,
  });
  const auth = await runAuthProbe({ claudePath: claude.realPath, cwd: workspaceRoot, env: childEnv });

  return {
    ready: auth.ready,
    claudeBinaryPath: claude.realPath,
    binarySource: claude.source,
    auth: auth.auth,
    usedFallbackAuthProbe: auth.usedFallback,
    warnings: [...(claude.warnings || []), ...(node.ok ? [] : [node.message])],
    hint: auth.ready ? undefined : "Claude auth is not visible to this Codex-launched process. Fix Claude/cc-switch setup outside Codex, then rerun setup.",
  };
}

function renderSetup(payload) {
  const lines = [
    `ready: ${payload.ready}`,
    `claude: ${payload.claudeBinaryPath || "not found"}`,
    `auth logged in: ${Boolean(payload.auth?.loggedIn)}`,
  ];
  if (payload.auth?.authMethod) {
    lines.push(`auth method: ${payload.auth.authMethod}`);
  }
  if (payload.auth?.apiProvider) {
    lines.push(`api provider: ${payload.auth.apiProvider}`);
  }
  if (payload.hint) {
    lines.push(`hint: ${payload.hint}`);
  }
  if (payload.warnings?.length) {
    lines.push("warnings:");
    for (const warning of payload.warnings) {
      lines.push(`- ${warning}`);
    }
  }
  return lines.join("\n");
}

function renderRun(payload) {
  const lines = [
    `ok: ${payload.ok}`,
    `mode: ${payload.mode}`,
    `exit: ${payload.exitCode}${payload.signal ? ` signal=${payload.signal}` : ""}`,
  ];
  if (payload.stderr) {
    lines.push(`stderr:\n${payload.stderr.trim()}`);
  }
  if (payload.stdout) {
    lines.push(`stdout:\n${payload.stdout.trim()}`);
  }
  if (payload.changedFiles?.length) {
    lines.push("changed files:");
    for (const file of payload.changedFiles) {
      lines.push(`- ${file}`);
    }
  }
  if (payload.diffInspectionReminder) {
    lines.push(payload.diffInspectionReminder);
  }
  if (payload.error) {
    lines.push(`error: ${payload.error}`);
  }
  return lines.join("\n");
}

function renderBackgroundStart(payload) {
  if (!payload.ok) {
    return `failed to start background Claude job: ${payload.error}`;
  }
  return `started Claude job ${payload.id} (${payload.mode})`;
}

function renderStatus(payload) {
  if (!payload.jobs.length) {
    return "no Claude jobs found";
  }
  return payload.jobs
    .map((job) => `${job.id} ${job.status} ${job.mode}${job.exitCode === undefined ? "" : ` exit=${job.exitCode}`}`)
    .join("\n");
}

function renderResult(payload) {
  if (!payload.ok && payload.error) {
    return payload.error;
  }
  const lines = [`job ${payload.job.id}: ${payload.job.status}`];
  if (payload.output?.stdout) {
    lines.push(payload.output.stdout.trim());
  }
  if (payload.output?.stderr) {
    lines.push(`stderr:\n${payload.output.stderr.trim()}`);
  }
  return lines.join("\n");
}

function renderCancel(payload) {
  if (!payload.ok) {
    return payload.error;
  }
  return `cancelled Claude job ${payload.id}`;
}

function renderPrune(payload) {
  return `pruned ${payload.count} Claude job(s)`;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n${usage()}\n`);
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildChildEnv } from "./env.mjs";
import { resolveClaudeBinary, resolveNodeBinary } from "./resolver.mjs";
import { buildClaudeRunArgs, parseJsonObject, spawnCapture } from "./process.mjs";
import {
  HEARTBEAT_STALE_MS,
  TERMINAL_STATUSES,
  createJob,
  listJobs,
  pruneJobs,
  readJob,
  readJobOutput,
  redactSecrets,
  updateJobGuarded,
  writeJobOutput,
  writeJob,
} from "./state.mjs";

export async function runClaudeForeground({ prompt, mode, workspaceRoot, env = process.env, claudePath, nodePath, maxBudgetUsd }) {
  const resolvedClaude = claudePath
    ? { ok: true, realPath: claudePath, path: claudePath, warnings: [] }
    : await resolveClaudeBinary({ env, workspaceRoot });

  if (!resolvedClaude.ok) {
    return {
      ok: false,
      mode,
      exitCode: null,
      signal: null,
      error: resolvedClaude.message,
      warnings: resolvedClaude.warnings,
      changedFiles: [],
      diffInspectionReminder: writeReminder(mode),
    };
  }

  const resolvedNode = nodePath
    ? { ok: true, realPath: nodePath, path: nodePath, warnings: [] }
    : await resolveNodeBinary({ workspaceRoot });

  const childEnv = buildChildEnv(env, {
    claudePath: resolvedClaude.realPath,
    nodePath: resolvedNode.ok ? resolvedNode.realPath : process.execPath,
    workspaceRoot,
  });

  const beforeChangedFiles = mode === "write" ? await collectChangedFiles(workspaceRoot) : [];
  const args = buildClaudeRunArgs({ mode, maxBudgetUsd });
  const result = await spawnCapture(resolvedClaude.realPath, args, {
    cwd: workspaceRoot,
    env: childEnv,
    input: prompt,
  });
  const changedFiles = mode === "write" ? await collectChangedFiles(workspaceRoot) : [];

  return {
    ok: result.exitCode === 0,
    mode,
    claudeBinaryPath: resolvedClaude.realPath,
    argv: args,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: parseJsonObject(result.stdout),
    changedFiles,
    beforeChangedFiles,
    diffInspectionReminder: writeReminder(mode),
  };
}

export async function startBackgroundJob({ prompt, parsed, scriptPath, env = process.env }) {
  const workspaceRoot = path.resolve(parsed.workspace);
  const resolvedClaude = await resolveClaudeBinary({ env, workspaceRoot });
  if (!resolvedClaude.ok) {
    return {
      ok: false,
      ready: false,
      error: resolvedClaude.message,
      warnings: resolvedClaude.warnings,
    };
  }

  const resolvedNode = await resolveNodeBinary({ workspaceRoot });
  if (!resolvedNode.ok) {
    return {
      ok: false,
      ready: false,
      error: resolvedNode.message,
      warnings: resolvedNode.warnings,
    };
  }

  const created = await createJob({
    workspaceRoot,
    env,
    prompt,
    record: {
      mode: parsed.mode,
      requestedWriteScope: parsed.mode === "write" ? workspaceRoot : undefined,
      claudeBinaryPath: resolvedClaude.realPath,
      nodeBinaryPath: resolvedNode.realPath,
      maxBudgetUsd: parsed.maxBudgetUsd,
    },
  });

  const stdoutFd = fs.openSync(created.record.stdoutPath, "a", 0o600);
  const stderrFd = fs.openSync(created.record.stderrPath, "a", 0o600);
  const workerEnv = buildChildEnv(env, {
    claudePath: resolvedClaude.realPath,
    nodePath: resolvedNode.realPath,
    workspaceRoot,
  });
  if (env.CLAUDE_FROM_CODEX_STATE_ROOT) {
    workerEnv.CLAUDE_FROM_CODEX_STATE_ROOT = env.CLAUDE_FROM_CODEX_STATE_ROOT;
  }

  const child = spawn(resolvedNode.realPath, [scriptPath, "worker", "--job-id", created.id, "--workspace", workspaceRoot], {
    cwd: workspaceRoot,
    env: workerEnv,
    shell: false,
    detached: true,
    stdio: ["ignore", stdoutFd, stderrFd],
  });
  child.unref();

  const processStartTime = await getProcessStartTime(child.pid);
  const running = await updateJobGuarded({
    workspaceRoot,
    env,
    id: created.id,
    update: () => ({
      status: "running",
      startedAt: new Date().toISOString(),
      pid: child.pid,
      pgid: child.pid,
      processStartTime,
      resolvedBinaryPath: resolvedNode.realPath,
    }),
  });

  return {
    ok: true,
    id: created.id,
    status: running.status,
    mode: running.mode,
    workspaceRoot,
    stateFile: created.jobFile,
  };
}

export async function runWorker({ id, workspaceRoot, env = process.env }) {
  const job = await readJob({ workspaceRoot, env, id });
  if (TERMINAL_STATUSES.has(job.status)) {
    return job;
  }

  const processStartTime = await getProcessStartTime(process.pid);
  await updateJobGuarded({
    workspaceRoot,
    env,
    id,
    update: () => ({
      status: "running",
      startedAt: job.startedAt || new Date().toISOString(),
      pid: process.pid,
      pgid: process.pid,
      processStartTime,
      resolvedBinaryPath: process.execPath,
    }),
  });

  const prompt = await fsp.readFile(job.promptPath, "utf8");
  const result = await runClaudeForeground({
    prompt,
    mode: job.mode,
    workspaceRoot,
    env,
    claudePath: job.claudeBinaryPath,
    nodePath: job.nodeBinaryPath || process.execPath,
    maxBudgetUsd: job.maxBudgetUsd,
  });

  const current = await readJob({ workspaceRoot, env, id });
  if (TERMINAL_STATUSES.has(current.status)) {
    return current;
  }

  await writeJobOutput(current, {
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: result.parsed,
  });

  const finished = {
    ...current,
    status: result.ok ? "completed" : "failed",
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    signal: result.signal,
    errorSummary: result.ok ? undefined : redactSecrets(result.stderr || result.error || "Claude run failed"),
    changedFiles: result.changedFiles,
    diffInspectionReminder: result.diffInspectionReminder,
  };
  await writeJob({ workspaceRoot, env, record: finished });
  return finished;
}

export async function statusJobs({ workspaceRoot, env = process.env, id }) {
  if (id) {
    const job = await refreshJobStatus({ workspaceRoot, env, job: await readJob({ workspaceRoot, env, id }) });
    return { ok: true, jobs: [summarizeJob(job)] };
  }

  const jobs = [];
  for (const job of await listJobs({ workspaceRoot, env })) {
    jobs.push(summarizeJob(await refreshJobStatus({ workspaceRoot, env, job })));
  }
  return { ok: true, jobs };
}

export async function resultJob({ workspaceRoot, env = process.env, id }) {
  let job;
  if (id) {
    job = await refreshJobStatus({ workspaceRoot, env, job: await readJob({ workspaceRoot, env, id }) });
  } else {
    const jobs = await listJobs({ workspaceRoot, env });
    job = jobs.find((candidate) => TERMINAL_STATUSES.has(candidate.status));
  }

  if (!job) {
    return { ok: false, error: "No finished Claude jobs found" };
  }

  if (job.status === "cancelled") {
    return { ok: false, id: job.id, status: job.status, error: "job was cancelled; no result" };
  }
  if (job.status === "stale") {
    return { ok: false, id: job.id, status: job.status, error: "job is stale; no trusted result" };
  }

  let output;
  try {
    output = await readJobOutput(job);
  } catch {
    output = undefined;
  }

  return {
    ok: job.status === "completed",
    job: summarizeJob(job),
    output,
  };
}

export async function cancelJob({ workspaceRoot, env = process.env, id }) {
  if (!id) {
    return { ok: false, error: "cancel requires a job id" };
  }

  const job = await readJob({ workspaceRoot, env, id });
  if (TERMINAL_STATUSES.has(job.status)) {
    return { ok: true, id, status: job.status, message: `job already ${job.status}` };
  }

  let signalDelivered = false;
  let fingerprintMatched = false;
  if (job.pid && (await isPidAlive(job.pid))) {
    const currentStartTime = await getProcessStartTime(job.pid);
    fingerprintMatched = !job.processStartTime || currentStartTime === job.processStartTime;
    if (fingerprintMatched) {
      signalDelivered = await terminateProcessTree(job.pid);
    }
  }

  const cancelled = {
    ...job,
    status: "cancelled",
    cancelRequestedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    signalDelivered,
    fingerprintMatched,
    errorSummary: signalDelivered ? "cancelled by request" : "cancelled without signaling; pid was missing or fingerprint mismatched",
  };
  await writeJob({ workspaceRoot, env, record: cancelled });
  return { ok: true, id, status: "cancelled", signalDelivered, fingerprintMatched };
}

export async function pruneOldJobs({ workspaceRoot, env = process.env, olderThanMs }) {
  const pruned = await pruneJobs({ workspaceRoot, env, olderThanMs });
  return { ok: true, pruned, count: pruned.length };
}

export async function refreshJobStatus({ workspaceRoot, env, job }) {
  if (TERMINAL_STATUSES.has(job.status)) {
    return job;
  }

  const updatedAt = Date.parse(job.updatedAt || job.createdAt);
  const staleByAge = Number.isFinite(updatedAt) && Date.now() - updatedAt > HEARTBEAT_STALE_MS;
  const staleByPid = job.pid ? !(await isPidAlive(job.pid)) : false;

  if (staleByAge || staleByPid) {
    const stale = {
      ...job,
      status: "stale",
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      errorSummary: staleByPid ? "worker pid is no longer alive" : "worker heartbeat is stale",
    };
    await writeJob({ workspaceRoot, env, record: stale });
    return stale;
  }

  return job;
}

export function summarizeJob(job) {
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    requestedWriteScope: job.requestedWriteScope,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    pid: job.pid,
    exitCode: job.exitCode,
    signal: job.signal,
    promptPreview: job.promptPreview,
    changedFiles: job.changedFiles || [],
    errorSummary: job.errorSummary,
    diffInspectionReminder: job.diffInspectionReminder,
  };
}

export async function collectChangedFiles(cwd) {
  try {
    const result = await spawnCapture("git", ["status", "--porcelain=v1", "-z"], { cwd, env: process.env });
    if (result.exitCode !== 0 || !result.stdout) {
      return [];
    }
    return result.stdout
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(3))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getProcessStartTime(pid) {
  for (const psPath of ["/bin/ps", "/usr/bin/ps"]) {
    try {
      const result = await spawnCapture(psPath, ["-o", "lstart=", "-p", String(pid)]);
      if (result.exitCode === 0 && result.stdout.trim()) {
        return result.stdout.trim();
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

async function terminateProcessTree(pid) {
  let delivered = false;
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM");
      delivered = true;
    } catch {
      // Best effort: process groups are not available everywhere.
    }
  }

  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (!(await isPidAlive(pid))) {
      return delivered;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGKILL");
      delivered = true;
    } catch {
      // Already gone.
    }
  }
  return delivered;
}

function writeReminder(mode) {
  if (mode !== "write") {
    return undefined;
  }
  return "Inspect the full workspace diff, including .git internals and unexpected files, before treating Claude's work as integrated.";
}

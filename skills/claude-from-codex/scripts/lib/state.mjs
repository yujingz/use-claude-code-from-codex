import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureOwnerOnlyDir, readJsonFile, unlinkIfExists, writeJsonAtomic, writeTextAtomic } from "./fs.mjs";

export const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "stale"]);
export const HEARTBEAT_STALE_MS = 6 * 60 * 60 * 1000;

export async function workspaceKey(workspaceRoot) {
  let realRoot;
  try {
    realRoot = await fsp.realpath(workspaceRoot);
  } catch {
    realRoot = path.resolve(workspaceRoot);
  }
  const hash = crypto.createHash("sha256").update(realRoot).digest("hex").slice(0, 16);
  const slug = path.basename(realRoot).replace(/[^a-zA-Z0-9._-]/g, "-") || "workspace";
  return `${hash}-${slug}`;
}

export async function statePaths({ workspaceRoot, env = process.env } = {}) {
  const rawBaseRoot =
    env.CLAUDE_FROM_CODEX_STATE_ROOT ||
    (env.XDG_STATE_HOME ? path.join(env.XDG_STATE_HOME, "claude-from-codex") : path.join(env.HOME || os.homedir(), ".local/state/claude-from-codex"));
  const baseRoot = await canonicalizePathPrefix(rawBaseRoot);
  const key = await workspaceKey(workspaceRoot || process.cwd());
  const workspaceDir = path.join(baseRoot, key);
  const jobsDir = path.join(workspaceDir, "jobs");
  return { baseRoot, workspaceDir, jobsDir, workspaceKey: key };
}

export function makeJobId(now = new Date()) {
  return `${now.toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${crypto.randomBytes(4).toString("hex")}`;
}

export async function createJob({ workspaceRoot, env, record, prompt }) {
  const paths = await statePaths({ workspaceRoot, env });
  await ensureOwnerOnlyDir(paths.jobsDir);

  const id = record.id || makeJobId();
  const jobFile = path.join(paths.jobsDir, `${id}.json`);
  const promptPath = path.join(paths.jobsDir, `${id}.prompt.txt`);
  const outputPath = path.join(paths.jobsDir, `${id}.output.json`);
  const stdoutPath = path.join(paths.jobsDir, `${id}.worker.stdout.log`);
  const stderrPath = path.join(paths.jobsDir, `${id}.worker.stderr.log`);

  await writeTextAtomic(promptPath, prompt);
  const now = new Date().toISOString();
  const fullRecord = sanitizeJobRecord({
    id,
    workspaceRoot: path.resolve(workspaceRoot),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    promptPreview: redactSecrets(prompt.slice(0, 500)),
    promptPath,
    outputPath,
    stdoutPath,
    stderrPath,
    ...record,
  });

  await writeJsonAtomic(jobFile, fullRecord);
  return { ...paths, id, jobFile, record: fullRecord };
}

export async function readJob({ workspaceRoot, env, id }) {
  const paths = await statePaths({ workspaceRoot, env });
  const jobFile = path.join(paths.jobsDir, `${id}.json`);
  return await readJsonFile(jobFile);
}

export async function writeJob({ workspaceRoot, env, record }) {
  const paths = await statePaths({ workspaceRoot, env });
  await ensureOwnerOnlyDir(paths.jobsDir);
  await writeJsonAtomic(path.join(paths.jobsDir, `${record.id}.json`), sanitizeJobRecord(record));
}

export async function updateJobGuarded({ workspaceRoot, env, id, update }) {
  const current = await readJob({ workspaceRoot, env, id });
  if (TERMINAL_STATUSES.has(current.status)) {
    return current;
  }
  const next = sanitizeJobRecord({
    ...current,
    ...update(current),
    updatedAt: new Date().toISOString(),
  });
  await writeJob({ workspaceRoot, env, record: next });
  return next;
}

export async function listJobs({ workspaceRoot, env }) {
  const paths = await statePaths({ workspaceRoot, env });
  try {
    const names = await fsp.readdir(paths.jobsDir);
    const records = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name.includes(".output.")) {
        continue;
      }
      try {
        records.push(await readJsonFile(path.join(paths.jobsDir, name)));
      } catch {
        continue;
      }
    }
    return records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function writeJobOutput(record, output) {
  await writeJsonAtomic(record.outputPath, output);
}

export async function readJobOutput(record) {
  return await readJsonFile(record.outputPath);
}

export async function pruneJobs({ workspaceRoot, env, olderThanMs }) {
  const jobs = await listJobs({ workspaceRoot, env });
  const cutoff = Date.now() - olderThanMs;
  const pruned = [];

  for (const job of jobs) {
    const finishedOrUpdated = Date.parse(job.finishedAt || job.updatedAt || job.createdAt);
    if (!Number.isFinite(finishedOrUpdated) || finishedOrUpdated > cutoff) {
      continue;
    }
    for (const file of [job.promptPath, job.outputPath, job.stdoutPath, job.stderrPath]) {
      if (file) {
        await unlinkIfExists(file);
      }
    }
    const paths = await statePaths({ workspaceRoot, env });
    await unlinkIfExists(path.join(paths.jobsDir, `${job.id}.json`));
    pruned.push(job.id);
  }

  return pruned;
}

export function sanitizeJobRecord(record) {
  const next = { ...record };
  for (const key of ["promptPreview", "errorSummary"]) {
    if (typeof next[key] === "string") {
      next[key] = redactSecrets(next[key]);
    }
  }
  return next;
}

export function redactSecrets(value) {
  if (value === undefined || value === null) {
    return value;
  }

  return String(value)
    .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_KEY]")
    .replace(/xox[pb]-[A-Za-z0-9-]+/g, "[REDACTED_SLACK_TOKEN]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/sk-ant-oat01-[A-Za-z0-9_-]+/g, "[REDACTED_ANTHROPIC_TOKEN]")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED_ANTHROPIC_TOKEN]")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED_API_KEY]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_GOOGLE_KEY]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/((?:password|secret|token)=)[^\s&]+/gi, "$1[REDACTED]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}

async function canonicalizePathPrefix(target) {
  const absolute = path.resolve(target);
  const missing = [];
  let cursor = absolute;

  while (true) {
    try {
      const real = await fsp.realpath(cursor);
      return path.join(real, ...missing.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        return absolute;
      }
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

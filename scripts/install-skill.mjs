#!/usr/bin/env node
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillSource = path.join(repoRoot, "skills/claude-from-codex");

async function main(argv) {
  const options = parseArgs(argv);
  const target = path.resolve(options.target || path.join(os.homedir(), ".agents/skills/claude-from-codex"));
  const action = await installSkill({ target, force: options.force, dryRun: options.dryRun });
  process.stdout.write(`${action.message}\n`);
}

export async function installSkill({ target, force = false, dryRun = false }) {
  await assertSourceExists();
  const parent = path.dirname(target);
  const existing = await readExisting(target);

  if (existing.exists) {
    if (existing.isSymlink && existing.realPath === skillSource) {
      return { ok: true, changed: false, message: `Skill already linked: ${target} -> ${skillSource}` };
    }
    if (!force) {
      throw new Error(`Refusing to overwrite existing skill at ${target}. Re-run with --force to replace it.`);
    }
  }

  if (dryRun) {
    const verb = existing.exists ? "Would replace" : "Would link";
    return { ok: true, changed: false, message: `${verb}: ${target} -> ${skillSource}` };
  }

  await fsp.mkdir(parent, { recursive: true });
  if (existing.exists) {
    await fsp.rm(target, { recursive: true, force: true });
  }
  await fsp.symlink(skillSource, target, "dir");
  return { ok: true, changed: true, message: `Linked skill: ${target} -> ${skillSource}` };
}

function parseArgs(argv) {
  const options = {
    force: false,
    dryRun: false,
    target: undefined,
  };
  const args = [...argv];
  if (args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(usage());
    process.exit(0);
  }
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "install";

  if (command === "help") {
    process.stdout.write(usage());
    process.exit(0);
  }
  if (command !== "install") {
    throw new Error(`Unknown command: ${command}\n${usage()}`);
  }

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--force") {
      options.force = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--target") {
      options.target = requireValue(arg, args);
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown flag: ${arg}\n${usage()}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage:",
    "  claude-from-codex-skill [install] [--target <path>] [--force] [--dry-run]",
    "",
    "Installs the plain Codex skill by symlinking this package's skills/claude-from-codex folder.",
  ].join("\n");
}

function requireValue(flag, args) {
  const value = args.shift();
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function assertSourceExists() {
  const stat = await fsp.stat(path.join(skillSource, "SKILL.md"));
  if (!stat.isFile()) {
    throw new Error(`Missing skill source: ${skillSource}`);
  }
}

async function readExisting(target) {
  try {
    const stat = await fsp.lstat(target);
    const isSymlink = stat.isSymbolicLink();
    return {
      exists: true,
      isSymlink,
      realPath: isSymlink ? await fsp.realpath(target) : undefined,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { exists: false, isSymlink: false, realPath: undefined };
    }
    throw error;
  }
}

if (await isDirectInvocation()) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

async function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return (await fsp.realpath(process.argv[1])) === fileURLToPath(import.meta.url);
  } catch {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

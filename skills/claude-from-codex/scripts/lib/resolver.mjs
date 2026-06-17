import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isPathInside } from "./env.mjs";

export function defaultTrustedRoots(home = os.homedir()) {
  return [
    "/usr/bin",
    "/bin",
    "/usr/local",
    "/opt/homebrew",
    path.join(home, ".local"),
    path.join(home, ".claude/local"),
  ];
}

export async function resolveClaudeBinary({
  env = process.env,
  workspaceRoot = process.cwd(),
  home,
  trustedRoots,
} = {}) {
  home = home || env.HOME || os.homedir();
  trustedRoots = trustedRoots || defaultTrustedRoots(home);
  const warnings = [];

  if (env.CLAUDE_BIN) {
    if (!path.isAbsolute(env.CLAUDE_BIN)) {
      return notFound("CLAUDE_BIN must be an absolute executable path", warnings);
    }
    return await validateCandidate(env.CLAUDE_BIN, {
      source: "CLAUDE_BIN",
      workspaceRoot,
      trustedRoots,
      fatal: true,
      warnings,
    });
  }

  const userLocal = path.join(home, ".local/bin/claude");
  const userLocalResolved = await validateCandidate(userLocal, {
    source: "user-local",
    workspaceRoot,
    trustedRoots,
    fatal: false,
    warnings,
  });
  if (userLocalResolved.ok) {
    return userLocalResolved;
  }

  for (const candidate of pathCandidates("claude", env.PATH, workspaceRoot)) {
    const resolved = await validateCandidate(candidate, {
      source: "PATH",
      workspaceRoot,
      trustedRoots,
      fatal: false,
      warnings,
    });
    if (resolved.ok) {
      return resolved;
    }
  }

  return notFound("Claude binary was not found. Install Claude Code or set CLAUDE_BIN to an absolute path.", warnings);
}

export async function resolveNodeBinary({
  nodePath = process.execPath,
  workspaceRoot = process.cwd(),
  trustedRoots = defaultTrustedRoots(),
} = {}) {
  if (!path.isAbsolute(nodePath)) {
    return notFound("Node binary path is not absolute", []);
  }
  return await validateCandidate(nodePath, {
    source: "node",
    workspaceRoot,
    trustedRoots,
    fatal: true,
    warnings: [],
    allowWorkspace: false,
  });
}

export async function resolveGitBinary({
  workspaceRoot = process.cwd(),
  trustedRoots = defaultTrustedRoots(),
  candidates = ["/usr/bin/git", "/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"],
} = {}) {
  const warnings = [];
  for (const candidate of candidates) {
    const resolved = await validateCandidate(candidate, {
      source: "git",
      workspaceRoot,
      trustedRoots,
      fatal: false,
      warnings,
    });
    if (resolved.ok) {
      return resolved;
    }
  }
  return notFound("Trusted git binary was not found", warnings);
}

export async function validateCandidate(candidate, options) {
  const warnings = options.warnings ?? [];

  try {
    if (!path.isAbsolute(candidate)) {
      throw new Error("candidate is not absolute");
    }

    const workspaceRoot = path.resolve(options.workspaceRoot);
    const candidatePath = path.resolve(candidate);
    const realPath = await fsp.realpath(candidatePath);

    if (isPathInside(realPath, workspaceRoot)) {
      throw new Error("candidate resolves inside the current workspace");
    }

    const linkStat = await fsp.lstat(candidatePath);
    if (linkStat.isSymbolicLink()) {
      await validateSymlinkTarget(candidatePath, realPath, options.trustedRoots);
    }

    const stat = await fsp.stat(realPath);
    if (!stat.isFile()) {
      throw new Error("candidate is not a file");
    }
    if ((stat.mode & 0o111) === 0) {
      throw new Error("candidate is not executable");
    }
    if (isGroupOrWorldWritable(stat.mode)) {
      throw new Error("candidate is group- or world-writable");
    }

    await validateAncestorDirs(realPath, options.trustedRoots);

    return {
      ok: true,
      source: options.source,
      path: candidatePath,
      realPath,
      warnings,
    };
  } catch (error) {
    const message = `${candidate}: ${error.message}`;
    if (options.fatal) {
      return notFound(message, warnings);
    }
    warnings.push(message);
    return notFound(message, warnings);
  }
}

export function pathCandidates(binaryName, pathValue, workspaceRoot) {
  if (!pathValue) {
    return [];
  }

  const candidates = [];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir || dir === "." || !path.isAbsolute(dir)) {
      continue;
    }
    const resolvedDir = path.resolve(dir);
    if (
      isPathInside(resolvedDir, path.resolve(workspaceRoot)) ||
      resolvedDir.endsWith(`${path.sep}node_modules${path.sep}.bin`)
    ) {
      continue;
    }
    candidates.push(path.join(resolvedDir, binaryName));
  }
  return candidates;
}

function notFound(message, warnings) {
  return {
    ok: false,
    path: undefined,
    realPath: undefined,
    message,
    warnings,
  };
}

async function validateSymlinkTarget(linkPath, realPath, trustedRoots) {
  const trustedRealRoots = [];
  for (const root of trustedRoots) {
    try {
      trustedRealRoots.push(await fsp.realpath(root));
    } catch {
      trustedRealRoots.push(path.resolve(root));
    }
  }

  if (!trustedRealRoots.some((root) => isPathInside(realPath, root))) {
    throw new Error(`symlink target for ${linkPath} resolves outside trusted roots`);
  }
}

async function validateAncestorDirs(filePath, trustedRoots = []) {
  const trustedRealRoots = [];
  for (const root of trustedRoots) {
    try {
      trustedRealRoots.push(await fsp.realpath(root));
    } catch {
      trustedRealRoots.push(path.resolve(root));
    }
  }

  let current = path.dirname(filePath);
  const seen = new Set();

  while (current && !seen.has(current)) {
    seen.add(current);
    const stat = await fsp.lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`ancestor is a symlink: ${current}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`ancestor is not a directory: ${current}`);
    }
    const trustedAncestor = trustedRealRoots.some((root) => isPathInside(current, root));
    if (isWorldWritable(stat.mode) && !hasStickyBit(stat.mode)) {
      throw new Error(`ancestor is world-writable: ${current}`);
    }
    if (isGroupWritable(stat.mode) && !trustedAncestor && !hasStickyBit(stat.mode)) {
      throw new Error(`ancestor is group-writable outside trusted roots: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

function isGroupOrWorldWritable(mode) {
  return (mode & 0o022) !== 0;
}

function isGroupWritable(mode) {
  return (mode & 0o020) !== 0;
}

function isWorldWritable(mode) {
  return (mode & 0o002) !== 0;
}

function hasStickyBit(mode) {
  return (mode & (fs.constants.S_ISVTX ?? 0o1000)) !== 0;
}

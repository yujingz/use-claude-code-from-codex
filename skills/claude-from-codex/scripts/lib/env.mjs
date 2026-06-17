import os from "node:os";
import path from "node:path";

export const SECRET_ENV_NAMES = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_SIMPLE",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AZURE_CLIENT_SECRET",
  "CLOUDFLARE_API_TOKEN",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
]);

export function defaultTrustedPathDirs(home = os.homedir()) {
  return [
    "/usr/bin",
    "/bin",
    "/usr/local/bin",
    "/opt/homebrew/bin",
    path.join(home, ".local/bin"),
  ];
}

export function buildTrustedPath({ claudePath, nodePath, home = os.homedir(), workspaceRoot } = {}) {
  const dirs = [
    ...defaultTrustedPathDirs(home),
    claudePath ? path.dirname(claudePath) : undefined,
    nodePath ? path.dirname(nodePath) : undefined,
  ];

  const seen = new Set();
  const clean = [];

  for (const dir of dirs) {
    if (!dir) {
      continue;
    }

    const normalized = path.resolve(dir);
    if (
      normalized === "." ||
      normalized.endsWith(`${path.sep}node_modules${path.sep}.bin`) ||
      (workspaceRoot && isPathInside(normalized, path.resolve(workspaceRoot)))
    ) {
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      clean.push(normalized);
    }
  }

  return clean.join(path.delimiter);
}

export function buildChildEnv(parentEnv = process.env, options = {}) {
  const home = parentEnv.HOME || os.homedir();
  const childEnv = {};
  const directAllowlist = ["HOME", "USER", "LOGNAME", "SHELL", "TERM", "TMPDIR", "LANG"];

  for (const name of directAllowlist) {
    if (parentEnv[name] && !SECRET_ENV_NAMES.has(name)) {
      childEnv[name] = parentEnv[name];
    }
  }

  for (const [name, value] of Object.entries(parentEnv)) {
    if (name.startsWith("LC_") && value && !SECRET_ENV_NAMES.has(name)) {
      childEnv[name] = value;
    }
  }

  childEnv.HOME = childEnv.HOME || home;
  childEnv.PATH = buildTrustedPath({
    claudePath: options.claudePath,
    nodePath: options.nodePath,
    home,
    workspaceRoot: options.workspaceRoot,
  });

  return childEnv;
}

export function isPathInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

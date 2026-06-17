import { spawn } from "node:child_process";

export function buildClaudeRunArgs({ mode = "readonly", maxBudgetUsd } = {}) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--setting-sources",
    "user,project,local",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];

  if (mode === "write") {
    args.push("--permission-mode", "default");
  } else {
    args.push("--permission-mode", "plan", "--allowedTools", "Read,Grep,Glob");
  }

  if (maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(maxBudgetUsd));
  }

  return args;
}

export function buildClaudeAuthArgs({ fallback = false } = {}) {
  if (fallback) {
    return ["auth", "status", "--json"];
  }
  return ["--setting-sources", "user,project,local", "auth", "status", "--json"];
}

export async function spawnCapture(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

export async function runAuthProbe({ claudePath, cwd, env }) {
  const primary = await spawnCapture(claudePath, buildClaudeAuthArgs(), { cwd, env });
  const primaryParsed = parseJsonObject(primary.stdout);

  if (primaryParsed) {
    return {
      ready: Boolean(primaryParsed.loggedIn),
      usedFallback: false,
      exitCode: primary.exitCode,
      auth: sanitizeAuth(primaryParsed),
      stderr: primary.stderr,
    };
  }

  if (primary.exitCode !== 0) {
    const fallback = await spawnCapture(claudePath, buildClaudeAuthArgs({ fallback: true }), { cwd, env });
    const fallbackParsed = parseJsonObject(fallback.stdout);
    if (fallbackParsed) {
      return {
        ready: Boolean(fallbackParsed.loggedIn),
        usedFallback: true,
        exitCode: fallback.exitCode,
        auth: sanitizeAuth(fallbackParsed),
        stderr: fallback.stderr,
      };
    }
  }

  return {
    ready: false,
    usedFallback: false,
    exitCode: primary.exitCode,
    auth: {
      loggedIn: false,
      authMethod: undefined,
      apiProvider: undefined,
    },
    stderr: primary.stderr,
  };
}

export function parseJsonObject(text) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function sanitizeAuth(auth) {
  return {
    loggedIn: Boolean(auth.loggedIn),
    authMethod: auth.authMethod,
    apiProvider: auth.apiProvider,
  };
}

export function outputResult(payload, { json = false, renderHuman } = {}) {
  if (json) {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  return `${renderHuman ? renderHuman(payload) : defaultHuman(payload)}\n`;
}

function defaultHuman(payload) {
  if (typeof payload === "string") {
    return payload;
  }
  if (payload?.message) {
    return payload.message;
  }
  return JSON.stringify(payload, null, 2);
}

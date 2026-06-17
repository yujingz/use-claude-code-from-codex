export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseDuration(value) {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(String(value ?? ""));
  if (!match) {
    throw new UsageError(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? "ms";
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
}

export function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();

  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { command: "help", json: false };
  }

  const parsed = {
    command,
    json: false,
    mode: "readonly",
    modeFlag: undefined,
    background: false,
    workspace: process.cwd(),
    maxBudgetUsd: undefined,
    olderThanMs: undefined,
    id: undefined,
    internalWorker: false,
  };

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--readonly") {
      if (parsed.modeFlag && parsed.modeFlag !== "readonly") {
        throw new UsageError("Use either --readonly or --write, not both");
      }
      parsed.mode = "readonly";
      parsed.modeFlag = "readonly";
    } else if (arg === "--write") {
      if (parsed.modeFlag && parsed.modeFlag !== "write") {
        throw new UsageError("Use either --readonly or --write, not both");
      }
      parsed.mode = "write";
      parsed.modeFlag = "write";
    } else if (arg === "--background" || arg === "--bg") {
      parsed.background = true;
    } else if (arg === "--workspace") {
      parsed.workspace = requireValue(arg, args);
    } else if (arg === "--max-budget-usd") {
      parsed.maxBudgetUsd = requireValue(arg, args);
      if (!/^\d+(\.\d+)?$/.test(parsed.maxBudgetUsd)) {
        throw new UsageError("--max-budget-usd must be a non-negative number");
      }
    } else if (arg === "--older-than") {
      parsed.olderThanMs = parseDuration(requireValue(arg, args));
    } else if (arg === "--job-id") {
      parsed.id = requireValue(arg, args);
    } else if (arg.startsWith("--")) {
      throw new UsageError(`Unknown flag: ${arg}`);
    } else if (parsed.id === undefined) {
      parsed.id = arg;
    } else {
      throw new UsageError(`Unexpected argument: ${arg}`);
    }
  }

  if (parsed.command === "run") {
    delete parsed.modeFlag;
    return parsed;
  }

  if (parsed.command === "setup") {
    delete parsed.modeFlag;
    return parsed;
  }

  if (parsed.command === "status" || parsed.command === "result" || parsed.command === "cancel") {
    delete parsed.modeFlag;
    return parsed;
  }

  if (parsed.command === "prune") {
    if (parsed.olderThanMs === undefined) {
      throw new UsageError("prune requires --older-than <duration>");
    }
    delete parsed.modeFlag;
    return parsed;
  }

  if (parsed.command === "worker") {
    if (!parsed.id) {
      throw new UsageError("worker requires --job-id <id>");
    }
    parsed.internalWorker = true;
    delete parsed.modeFlag;
    return parsed;
  }

  throw new UsageError(`Unknown command: ${parsed.command}`);
}

export function usage() {
  return [
    "Usage:",
    "  claude-companion.mjs setup [--json]",
    "  claude-companion.mjs run [--readonly|--write] [--background] [--json]",
    "  claude-companion.mjs status [job-id] [--json]",
    "  claude-companion.mjs result [job-id] [--json]",
    "  claude-companion.mjs cancel <job-id> [--json]",
    "  claude-companion.mjs prune --older-than <duration> [--json]",
  ].join("\n");
}

function requireValue(flag, args) {
  const value = args.shift();
  if (!value || value.startsWith("--")) {
    throw new UsageError(`${flag} requires a value`);
  }
  return value;
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export async function readStdin(input = process.stdin) {
  let data = "";
  input.setEncoding("utf8");
  for await (const chunk of input) {
    data += chunk;
  }
  return data;
}

export async function ensureOwnerOnlyDir(dir) {
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  await rejectSymlinkAncestors(dir);
  await fsp.chmod(dir, 0o700);
}

export async function readJsonFile(file) {
  const text = await fsp.readFile(file, "utf8");
  return JSON.parse(text);
}

export async function writeJsonAtomic(file, value) {
  await writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomic(file, value) {
  const dir = path.dirname(file);
  await ensureOwnerOnlyDir(dir);
  await rejectSymlinkAncestors(dir);

  try {
    const existing = await fsp.lstat(file);
    if (existing.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symlink: ${file}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const temp = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const handle = await fsp.open(temp, flags, 0o600);
  try {
    await handle.writeFile(value, "utf8");
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
  await fsp.rename(temp, file);
  await fsp.chmod(file, 0o600);
}

export async function unlinkIfExists(file) {
  try {
    await fsp.unlink(file);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function rejectSymlinkAncestors(target) {
  const resolved = path.resolve(target);
  const parts = resolved.split(path.sep).filter(Boolean);
  let current = path.isAbsolute(resolved) ? path.sep : "";

  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing symlink path component: ${current}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

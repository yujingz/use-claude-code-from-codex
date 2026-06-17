import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { spawnCapture } from "../skills/claude-from-codex/scripts/lib/process.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = path.join(repoRoot, "scripts/install-skill.mjs");
const skillSource = path.join(repoRoot, "skills/claude-from-codex");

test("installer dry-run does not create the target", async () => {
  const fixture = await makeFixture();
  const target = path.join(fixture.dir, "skills/claude-from-codex");
  const result = await spawnCapture(process.execPath, [installerPath, "install", "--target", target, "--dry-run"], {
    cwd: repoRoot,
    env: process.env,
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Would link/);
  await assert.rejects(fsp.lstat(target), /ENOENT/);
});

test("installer creates an idempotent symlink to the local skill", async () => {
  const fixture = await makeFixture();
  const target = path.join(fixture.dir, "skills/claude-from-codex");
  const first = await spawnCapture(process.execPath, [installerPath, "install", "--target", target], {
    cwd: repoRoot,
    env: process.env,
  });

  assert.equal(first.exitCode, 0, first.stderr);
  assert.match(first.stdout, /Linked skill/);
  const stat = await fsp.lstat(target);
  assert.equal(stat.isSymbolicLink(), true);
  assert.equal(await fsp.realpath(target), skillSource);

  const second = await spawnCapture(process.execPath, [installerPath, "install", "--target", target], {
    cwd: repoRoot,
    env: process.env,
  });
  assert.equal(second.exitCode, 0, second.stderr);
  assert.match(second.stdout, /already linked/);
});

test("installer runs when invoked through an npm-style bin symlink", async () => {
  const fixture = await makeFixture();
  const bin = path.join(fixture.dir, "node_modules/.bin/claude-from-codex-skill");
  await fsp.mkdir(path.dirname(bin), { recursive: true });
  await fsp.symlink(installerPath, bin);

  const result = await spawnCapture(bin, ["--help"], {
    cwd: repoRoot,
    env: process.env,
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /claude-from-codex-skill/);
});

test("installer refuses to overwrite a different existing target without force", async () => {
  const fixture = await makeFixture();
  const target = path.join(fixture.dir, "skills/claude-from-codex");
  await fsp.mkdir(target, { recursive: true });

  const result = await spawnCapture(process.execPath, [installerPath, "install", "--target", target], {
    cwd: repoRoot,
    env: process.env,
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Refusing to overwrite existing skill/);
});

async function makeFixture() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "claude-from-codex-installer-"));
  await fsp.chmod(dir, 0o700);
  return { dir };
}

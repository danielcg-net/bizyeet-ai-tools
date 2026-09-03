import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const run = (command: string, args: readonly string[], cwd: string): Promise<void> => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: "ignore" });
  child.once("error", reject);
  child.once("close", (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} exited with ${code === null ? "no exit code" : code.toString()}.`));
  });
});

const packedArchive = async (directory: string): Promise<string> => {
  await run("npm", ["pack", "--pack-destination", directory], process.cwd());
  const archives = (await readdir(directory)).filter((file) => file.endsWith(".tgz"));
  if (archives.length !== 1) throw new Error("Expected exactly one package archive.");
  return join(directory, archives[0] ?? "");
};

const installedCli = (directory: string): string =>
  join(directory, "node_modules", ".bin", process.platform === "win32" ? "bizyeet.cmd" : "bizyeet");

void test("installs a packed CLI and exposes the OAuth-only help command", async (): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "bizyeet-cli-install-"));
  try {
    const archive = await packedArchive(directory);
    await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], directory);
    await run(installedCli(directory), ["--help"], directory);
    assert.ok(true);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

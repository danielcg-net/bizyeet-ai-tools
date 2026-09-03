import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { text } from "node:stream/consumers";
import test from "node:test";

const collect = async (stream: NodeJS.ReadableStream): Promise<string> =>
  text(stream);

const exitCode = (child: ReturnType<typeof spawn>): Promise<number | null> => new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});

const run = async (command: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv = process.env): Promise<string> => {
  const child = spawn(command, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  const [output, errors, code] = await Promise.all([collect(child.stdout), collect(child.stderr), exitCode(child)]);
  if (code !== 0) throw new Error(`${command} exited with ${code === null ? "no exit code" : code.toString()}: ${errors}`);
  return output;
};

const packedArchive = async (directory: string): Promise<string> => {
  await run("npm", ["pack", "--pack-destination", directory], process.cwd());
  const archives = (await readdir(directory)).filter((file) => file.endsWith(".tgz"));
  if (archives.length !== 1) throw new Error("Expected exactly one package archive.");
  return join(directory, archives[0] ?? "");
};

const installedCli = (directory: string): string =>
  join(directory, "node_modules", ".bin", process.platform === "win32" ? "bizyeet.cmd" : "bizyeet");

const commandLookup = (): Readonly<{ args: readonly string[]; command: string }> =>
  process.platform === "win32"
    ? { args: ["bizyeet"], command: "where" }
    : { args: ["-c", "command -v bizyeet"], command: "sh" };

const credentialConfig = async (directory: string): Promise<NodeJS.ProcessEnv> => {
  const configuration = join(directory, "config", "bizyeet");
  await mkdir(configuration, { recursive: true, mode: 0o700 });
  await writeFile(join(configuration, "profiles.json"), `${JSON.stringify({ "package-check": { clientId: "public-client", issuer: "https://example.test" } })}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(join(configuration, "credentials.json"), `${JSON.stringify({ "package-check": { accessToken: "synthetic-access", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "synthetic-refresh", scope: "customers.read" } })}\n`, { encoding: "utf8", mode: 0o600 });
  return { ...process.env, XDG_CONFIG_HOME: join(directory, "config") };
};

void test("installs a packed CLI, exposes it on PATH, and runs auth diagnostics outside its source tree", async (): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "bizyeet-cli-install-"));
  try {
    const archive = await packedArchive(directory);
    await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], directory);
    const environment = await credentialConfig(directory);
    const pathEnvironment = { ...environment, PATH: [join(directory, "node_modules", ".bin"), environment.PATH].filter(Boolean).join(delimiter) };
    const located = await run(commandLookup().command, commandLookup().args, directory, pathEnvironment);
    const help = await run(installedCli(directory), ["--help"], directory, pathEnvironment);
    const status = await run(installedCli(directory), ["auth", "status", "--profile", "package-check"], directory, pathEnvironment);

    assert.match(located, /bizyeet/u);
    assert.match(help, /OAuth/u);
    assert.match(status, /"authenticated":true/u);
    assert.doesNotMatch(status, /synthetic-access|synthetic-refresh/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

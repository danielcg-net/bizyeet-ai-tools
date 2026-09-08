import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { text } from "node:stream/consumers";
import test, { mock } from "node:test";

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

const credentialConfig = async (directory: string, issuer = "https://example.test"): Promise<NodeJS.ProcessEnv> => {
  const configuration = join(directory, "config", "bizyeet");
  await mkdir(configuration, { recursive: true, mode: 0o700 });
  await writeFile(join(configuration, "profiles.json"), `${JSON.stringify({ "package-check": { clientId: "public-client", issuer } })}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(join(configuration, "credentials.json"), `${JSON.stringify({ "package-check": { accessToken: "synthetic-access", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "synthetic-refresh", scope: "customers.read" } })}\n`, { encoding: "utf8", mode: 0o600 });
  return { ...process.env, XDG_CONFIG_HOME: join(directory, "config") };
};

const opaqueId = `crm1.${"a".repeat(64)}.customers.synthetic`;
const serveSyntheticApi = (request: IncomingMessage, response: ServerResponse): void => {
  const origin = `https://${request.headers.host ?? "127.0.0.1"}`;
  const url = new URL(request.url ?? "/", origin);
  const metadata = url.pathname === "/.well-known/oauth-authorization-server";
  const authorized = request.headers.authorization === "Bearer synthetic-access";
  const body = metadata ? { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, code_challenge_methods_supported: ["S256"] }
    : !authorized ? { error: { code: "authorization_required" } }
    : url.pathname === "/api/agent/me" ? { tenant_id: "synthetic-tenant", client_id: "public-client", scope: ["customers.read"] }
    : url.pathname === "/api/agent/customers" ? { data: { items: [{ id: opaqueId }], total: 1 }, meta: { contract_version: "v1", next_cursor: null } }
    : url.pathname === `/api/agent/customers/${opaqueId}` ? { data: { id: opaqueId }, meta: { contract_version: "v1" } }
    : { error: { code: "not_found" } };
  response.writeHead(metadata || authorized ? ("error" in body ? 404 : 200) : 401, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};

void test("installed CLI verifies identity and performs canonical list-to-exact-read over trusted local HTTPS", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bizyeet-cli-https-"));
  const certificate = join(directory, "synthetic-cert.pem");
  const key = join(directory, "synthetic-key.pem");
  try {
    // Ephemeral test-only credentials, never committed or used outside loopback.
    await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", certificate,
      "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], directory);
    const handler = mock.fn(serveSyntheticApi);
    const server = createServer({ key: await readFile(key), cert: await readFile(certificate) }, handler);
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a loopback test port.");
      const archive = await packedArchive(directory);
      await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], directory);
      const environment = { ...await credentialConfig(directory, `https://127.0.0.1:${String(address.port)}`), NODE_EXTRA_CA_CERTS: certificate };
      const check = await run(installedCli(directory), ["auth", "check", "--profile", "package-check"], directory, environment);
      const list = await run(installedCli(directory), ["customers", "list", "--limit", "1", "--fields", "id", "--profile", "package-check"], directory, environment);
      const detail = await run(installedCli(directory), ["customers", "get", opaqueId, "--profile", "package-check"], directory, environment);
      assert.match(check, /"verification":"server"/u);
      assert.match(check, /synthetic-tenant/u);
      assert.deepEqual(JSON.parse(list), { data: { items: [{ id: opaqueId }], total: 1 }, meta: { contract_version: "v1", next_cursor: null } });
      assert.deepEqual(JSON.parse(detail), { data: { id: opaqueId }, meta: { contract_version: "v1" } });
      assert.doesNotMatch(check + list + detail, /synthetic-access|synthetic-refresh/u);
      assert.equal(handler.mock.callCount(), 6);
      const listRequest = handler.mock.calls.map((call) => call.arguments[0].url).find((url) => url?.startsWith("/api/agent/customers?"));
      assert.ok(listRequest);
      assert.equal(new URL(listRequest, "https://localhost").searchParams.get("api_version"), "v1");
    } finally {
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); });
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

void test("installs a packed CLI, exposes it on PATH, and runs auth diagnostics outside its source tree", async (): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "bizyeet-cli-install-"));
  try {
    const archive = await packedArchive(directory);
    await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], directory);
    const environment = await credentialConfig(directory);
    const pathEnvironment = { ...environment, PATH: [join(directory, "node_modules", ".bin"), environment.PATH].filter(Boolean).join(delimiter) };
    const located = await run(commandLookup().command, commandLookup().args, directory, pathEnvironment);
    const help = await run(installedCli(directory), ["--help"], directory, pathEnvironment);
    const version = await run(installedCli(directory), ["--version"], directory, pathEnvironment);
    const diagnostics = await run(installedCli(directory), ["diagnostics", "--json"], directory, pathEnvironment);
    const status = await run(installedCli(directory), ["auth", "status", "--profile", "package-check"], directory, pathEnvironment);

    assert.match(located, /bizyeet/u);
    assert.match(help, /OAuth/u);
    assert.match(version, /"version":"0\.0\.0-development"/u);
    assert.match(diagnostics, /"automatic":false/u);
    assert.match(diagnostics, /"required":">=24"/u);
    assert.doesNotMatch(diagnostics, /synthetic-access|synthetic-refresh/u);
    assert.match(status, /"authenticated":true/u);
    assert.doesNotMatch(status, /synthetic-access|synthetic-refresh/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

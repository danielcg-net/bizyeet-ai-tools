import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { text } from "node:stream/consumers";
import test, { mock } from "node:test";
import { nativeKeychain } from "./keychain.js";

const testProfile = (directory: string): string => basename(directory).toLowerCase();
const cleanup = async (directory: string): Promise<void> => {
  try {
    if (process.platform === "win32" && await nativeKeychain.read(testProfile(directory))) await nativeKeychain.remove(testProfile(directory));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};

const collect = async (stream: NodeJS.ReadableStream): Promise<string> =>
  text(stream);

const exitCode = (child: ReturnType<typeof spawn>): Promise<number | null> => new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});

const run = async (command: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv = process.env, input?: string): Promise<string> => {
  const child = spawn(command, args, { cwd, env: environment, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(input);
  const [output, errors, code] = await Promise.all([collect(child.stdout), collect(child.stderr), exitCode(child)]);
  if (code !== 0) throw new Error(`${command} exited with ${code === null ? "no exit code" : code.toString()}: ${errors}`);
  return output;
};

const packedArchive = async (directory: string): Promise<string> => {
  await runNpm(["pack", "--pack-destination", directory], process.cwd());
  const archives = (await readdir(directory)).filter((file) => file.endsWith(".tgz"));
  if (archives.length !== 1) throw new Error("Expected exactly one package archive.");
  return join(directory, archives[0] ?? "");
};

const runNpm = async (args: readonly string[], directory: string, environment: NodeJS.ProcessEnv = process.env, input?: string): Promise<string> => {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error("Run package tests through npm test.");
  return run(process.execPath, [cli, ...args], directory, environment, input);
};

const runInstalled = (args: readonly string[], directory: string, environment: NodeJS.ProcessEnv, input?: string): Promise<string> =>
  runNpm(["exec", "--offline", "--no", "--", "bizyeet", ...args], directory, environment, input);

const commandLookup = (): Readonly<{ args: readonly string[]; command: string }> =>
  process.platform === "win32"
    ? { args: ["bizyeet"], command: "where.exe" }
    : { args: ["-c", "command -v bizyeet"], command: "sh" };

const credentialConfig = async (directory: string, issuer = "https://example.test"): Promise<NodeJS.ProcessEnv> => {
  const configuration = join(directory, "config", "bizyeet");
  await mkdir(configuration, { recursive: true, mode: 0o700 });
  const profile = testProfile(directory);
  const credentials = { profile: { clientId: "public-client", issuer }, accessToken: "synthetic-access", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "synthetic-refresh", scope: "customers.read" };
  // Poison legacy public metadata: neither native nor fallback credentials may
  // use this issuer/client to route any token-bearing installed command.
  await writeFile(join(configuration, "profiles.json"), `${JSON.stringify({ [profile]: { clientId: "attacker", issuer: "https://attacker.invalid" } })}\n`, { encoding: "utf8", mode: 0o666 });
  if (process.platform === "win32") await nativeKeychain.save(profile, credentials);
  else await writeFile(join(configuration, "credentials.json"), `${JSON.stringify({ [profile]: credentials })}\n`, { encoding: "utf8", mode: 0o600 });
  return { ...process.env, BIZYEET_CREDENTIAL_STORE: process.platform === "win32" ? "auto" : "file", XDG_CONFIG_HOME: join(directory, "config") };
};

const opaqueId = `crm1.${"a".repeat(64)}.customers.synthetic`;
const previewId = "11111111-1111-4111-8111-111111111111";
const executionKey = "22222222-2222-4222-8222-222222222222";
const receipt = "r".repeat(43);
const serveSyntheticWrite = async (request: IncomingMessage, response: ServerResponse, preview: boolean): Promise<void> => {
  assert.equal(request.method, "POST");
  assert.equal(request.headers.authorization, "Bearer synthetic-access");
  const input: unknown = JSON.parse(await text(request));
  assert.deepEqual(input, preview ? { resource_id: opaqueId, changes: { business: "Proposed" } }
    : { preview_id: previewId, idempotency_key: executionKey, approval_receipt: receipt });
  const data = preview ? { preview_id: previewId, request_hash: "b".repeat(43), expires_at: "2099-01-01T00:00:00.000Z", confirmation_class: "reversible_write",
    resource_id: opaqueId, proposed_changes: { business: "Proposed" }, side_effects: ["Update customer"], warnings: [], idempotency_key_format: "uuid", approval_path: `/dashboard/#/agent-approvals/${previewId}` }
    : { resource: { id: opaqueId, business: "Proposed" }, audit_reference: previewId };
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ data, meta: { contract_version: "v1" } }));
};
const serveSyntheticApi = (request: IncomingMessage, response: ServerResponse): void => {
  const origin = `https://${request.headers.host ?? "127.0.0.1"}`;
  const url = new URL(request.url ?? "/", origin);
  if (["/api/agent/customers/update-preview", "/api/agent/customers/update-execute"].includes(url.pathname)) {
    void serveSyntheticWrite(request, response, url.pathname.endsWith("update-preview")).catch(() => {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { code: "synthetic_contract_mismatch" } }));
    });
    return;
  }
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
      await runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], directory);
      const environment = { ...await credentialConfig(directory, `https://127.0.0.1:${String(address.port)}`), NODE_EXTRA_CA_CERTS: certificate };
      const check = await runInstalled(["auth", "check", "--profile", testProfile(directory)], directory, environment);
      const list = await runInstalled(["customers", "list", "--limit", "1", "--fields", "id", "--profile", testProfile(directory)], directory, environment);
      const detail = await runInstalled(["customers", "get", opaqueId, "--profile", testProfile(directory)], directory, environment);
      const preview = await runInstalled(["customers", "update", "preview", opaqueId, "--input-stdin", "--profile", testProfile(directory)], directory, environment, JSON.stringify({ business: "Proposed" }));
      const execution = await runInstalled(["customers", "update", "execute", previewId, "--idempotency-key", executionKey, "--receipt-stdin", "--profile", testProfile(directory)], directory, environment, `${receipt}\n`);
      assert.match(check, /"verification":"server"/u);
      assert.match(check, /synthetic-tenant/u);
      assert.deepEqual(JSON.parse(list), { data: { items: [{ id: opaqueId }], total: 1 }, meta: { contract_version: "v1", next_cursor: null } });
      assert.deepEqual(JSON.parse(detail), { data: { id: opaqueId }, meta: { contract_version: "v1" } });
      assert.match(preview, /"confirmation_class":"reversible_write"/u);
      assert.match(execution, /"business":"Proposed"/u);
      assert.doesNotMatch(check + list + detail + preview + execution, /synthetic-access|synthetic-refresh|rrrrrrrr/u);
      assert.equal(handler.mock.callCount(), 5);
      assert.ok(handler.mock.calls.every((call) => call.arguments[0].url?.startsWith("/api/agent/")));
      const listRequest = handler.mock.calls.map((call) => call.arguments[0].url).find((url) => url?.startsWith("/api/agent/customers?"));
      assert.ok(listRequest);
      assert.equal(new URL(listRequest, "https://localhost").searchParams.get("api_version"), "v1");
    } finally {
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); });
    }
  } finally {
    await cleanup(directory);
  }
});

void test("installs a packed CLI, exposes it on PATH, and runs auth diagnostics outside its source tree", async (): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "bizyeet-cli-install-"));
  try {
    const archive = await packedArchive(directory);
    await runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], directory);
    const environment = await credentialConfig(directory);
    const inheritedPath = Object.entries(environment).find(([key]) => key.toLowerCase() === "path")?.[1];
    const pathEnvironment = { ...Object.fromEntries(Object.entries(environment).filter(([key]) => key.toLowerCase() !== "path")),
      PATH: [join(directory, "node_modules", ".bin"), inheritedPath].filter(Boolean).join(delimiter) };
    const located = await run(commandLookup().command, commandLookup().args, directory, pathEnvironment);
    const help = await runInstalled(["--help"], directory, pathEnvironment);
    const version = await runInstalled(["--version"], directory, pathEnvironment);
    const diagnostics = await runInstalled(["diagnostics", "--json"], directory, pathEnvironment);
    const status = await runInstalled(["auth", "status", "--profile", testProfile(directory)], directory, pathEnvironment);

    assert.match(located, /bizyeet/u);
    assert.match(help, /OAuth/u);
    assert.match(version, /"version":"0\.0\.0-development"/u);
    assert.match(diagnostics, /"automatic":false/u);
    assert.match(diagnostics, /"required":">=24"/u);
    assert.doesNotMatch(diagnostics, /synthetic-access|synthetic-refresh/u);
    assert.match(status, /"authenticated":true/u);
    assert.doesNotMatch(status, /synthetic-access|synthetic-refresh/u);
    await assert.rejects(runInstalled(["unknown-command"], directory, pathEnvironment), /exited with 1/u);
    await assert.rejects(runInstalled(["customers", "list", "--limit", "--fields"], directory, pathEnvironment), /exited with 2/u);
  } finally {
    await cleanup(directory);
  }
});

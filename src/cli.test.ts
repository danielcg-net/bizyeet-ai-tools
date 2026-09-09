import assert from "node:assert/strict";
import test from "node:test";

import { isCliEntrypoint, run } from "./cli.js";
import { agentFailure } from "./agent-error.js";
import { listCustomers } from "./agent-client.js";
import { CRM_SEARCH_LIMIT_MESSAGE } from "./search-contract.js";

void test("oversized Unicode searches return actionable CLI validation errors without network access", async (context): Promise<void> => {
  const forbidden = (): Promise<never> => Promise.reject(new Error("Must not dispatch"));
  const fetcher = context.mock.fn(forbidden);
  await Promise.all(["a".repeat(201), "😀".repeat(201), `${"a".repeat(120)}\uD800`, "\uDC00"].map(async (search): Promise<void> => {
    const outcome = await run(["customers", "list", "--search", search], {
      readCredentials: () => Promise.resolve({ default: { profile: { clientId: "public-client", issuer: "https://example.test" }, accessToken: "secret-access", refreshToken: "secret-refresh", expiresAt: "2099-01-01", scope: "customers.read" } }),
      removeCredentials: forbidden, saveCredentials: forbidden,
    }, {
      loginBrowser: forbidden, loginDevice: forbidden, getCustomer: forbidden, revoke: forbidden,
      listCustomers: (input) => listCustomers({ ...input, fetcher, now: () => 0, metadata: forbidden }),
    });
    assert.equal(outcome.exitCode, 2);
    assert.equal(outcome.stream, "stderr");
    assert.match(outcome.message, /"code":"invalid_request"/u);
    assert.ok(outcome.message.includes(CRM_SEARCH_LIMIT_MESSAGE));
    assert.doesNotMatch(outcome.message, /secret-access|secret-refresh/u);
  }));
  assert.equal(fetcher.mock.callCount(), 0);
});

await Promise.all(["status", "logout"].map((command) => test(`auth ${command} distinguishes configuration from storage failures`, async () => {
  await Promise.all([
    { message: "keychain denied secret-access", exit: 1 },
    { message: "Stored BizYeet credentials are invalid.", exit: 1 },
    { message: "XDG_CONFIG_HOME must be a nonempty absolute directory.", exit: 2 },
    { message: "BIZYEET_CREDENTIAL_STORE must be auto or file.", exit: 2 },
  ].map(async ({ message, exit }) => {
    const result = await run(["auth", command], {
      readCredentials: () => Promise.reject(new Error(message)),
      removeCredentials: () => Promise.resolve(), saveCredentials: () => Promise.resolve(),
    });
    assert.equal(result.exitCode, exit);
    assert.match(result.message, exit === 1 ? /"code":"internal_error"/u : /"code":"invalid_request"/u);
    assert.doesNotMatch(result.message, /secret-access/u);
  }));
  const result = await run(["auth", command, "--profile", "../invalid"]);
  assert.equal(result.exitCode, 2);
})));

void test("logout reports credential deletion failure as internal error without leaking details", async () => {
  const result = await run(["auth", "logout"], {
    readCredentials: () => Promise.resolve({}), removeCredentials: () => Promise.reject(new Error("secret-refresh denied")),
    saveCredentials: () => Promise.resolve(),
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /"code":"internal_error"/u);
  assert.doesNotMatch(result.message, /secret-refresh/u);
});

void test("never reflects credential parser failures in auth or business command output", async () => {
  const storage: Parameters<typeof run>[1] = {
    readCredentials: () => Promise.reject(new SyntaxError('Unexpected token: {"accessToken":"secret-access","refreshToken":"secret-refresh"} is invalid JSON')),
    removeCredentials: () => Promise.resolve(), saveCredentials: () => Promise.resolve(),
  };
  await Promise.all([["auth", "status"], ["auth", "check"], ["auth", "logout"], ["customers", "list"]].map(async (args) => {
    const result = await run(args, storage);
    assert.notEqual(result.exitCode, 0);
    assert.doesNotMatch(result.message, /secret-access|secret-refresh|accessToken|refreshToken/u);
  }));
});

void test("CLI preserves canonical error codes, retryability and correlation without credentials", async () => {
  const requestId = "12345678-1234-1234-1234-123456789abc";
  const failure = agentFailure(400, { error: { code: "invalid_cursor", request_id: requestId, retryable: false,
    message: "access-secret", details: { token: "refresh-secret" } } });
  const result = await run(["customers", "list"], {
    readCredentials: () => Promise.resolve({ default: { profile: { clientId: "public-client", issuer: "https://example.test" }, accessToken: "access-secret", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-secret", scope: "customers.read" } }),
    removeCredentials: () => Promise.resolve(), saveCredentials: () => Promise.resolve(),
  }, {
    getCustomer: () => Promise.reject(new Error("Agent request failed.", { cause: failure })),
    listCustomers: () => Promise.reject(new Error("Agent request failed.", { cause: failure })),
    loginBrowser: () => Promise.reject(new Error("Unexpected login")),
    loginDevice: () => Promise.reject(new Error("Unexpected login")), revoke: () => Promise.resolve(),
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stream, "stderr");
  const body: unknown = JSON.parse(result.message);
  assert.deepEqual(body, { error: { code: "invalid_cursor", request_id: requestId, retryable: false, details: {},
    message: "Start a fresh list request without the expired or incompatible cursor." } });
  assert.doesNotMatch(result.message, /access-secret|refresh-secret/u);
});

void test("help documents the OAuth-only command surface", async (): Promise<void> => {
  const result = await run(["--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stream, "stdout");
  assert.match(result.message, /OAuth/u);
  assert.match(result.message, /customers list/u);
  assert.doesNotMatch(result.message, /access_token|refresh_token/u);
});

void test("reports the packaged version without reading credentials", async (): Promise<void> => {
  const result = await run(["--version"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.message, /"version":"0\.0\.0-development"/u);
});

void test("local diagnostics provide runtime and truthful manual-update guidance without credentials", async () => {
  const forbidden = (): never => { throw new Error("Local diagnostics must not access profiles or credentials"); };
  const storage: Parameters<typeof run>[1] = { readCredentials: forbidden, removeCredentials: forbidden, saveCredentials: forbidden };
  const result = await run(["diagnostics", "--json"], storage);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stream, "stdout");
  const body = JSON.parse(result.message) as Readonly<{ data: Readonly<Record<string, unknown>> }>;
  assert.deepEqual(body.data.runtime, { name: "node", version: process.versions.node, platform: process.platform, architecture: process.arch, required: ">=24", supported: Number(process.versions.node.split(".")[0]) >= 24 });
  assert.deepEqual(body.data.authentication, { checked: false, next_step: "bizyeet auth check" });
  assert.deepEqual(body.data.update, { checked: false, automatic: false, releases_url: "https://github.com/danielcg-net/bizyeet-ai-tools/releases", guidance: "Review the official release notes and installation instructions before updating. This command does not determine the latest release or install anything." });
  assert.equal((await run(["diagnostics", "--profile", "default"], storage)).exitCode, 2);
});

void test("explicit JSON mode works for help and version and rejects duplicate flags", async () => {
  const help = await run(["--help", "--json"]);
  assert.equal(help.exitCode, 0);
  assert.doesNotThrow(() => JSON.parse(help.message));
  assert.match(help.message, /"help":/u);
  const version = await run(["--json", "--version"]);
  assert.equal(version.exitCode, 0);
  assert.doesNotThrow(() => JSON.parse(version.message));
  assert.equal((await run(["--json", "--version", "--json"])).exitCode, 2);
});

void test("auth check uses the selected profile and persists refreshed credentials before reporting server verification", async () => {
  const result = await run(["auth", "check", "--profile", "canary"], {
    readCredentials: () => Promise.resolve({ canary: { profile: { clientId: "client", issuer: "https://example.test" }, accessToken: "access-secret", refreshToken: "refresh-secret", expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.read" } }),
    saveCredentials: (name, credentials) => {
      assert.equal(name, "canary");
      assert.equal(credentials.refreshToken, "rotated-secret");
      return Promise.resolve();
    },
    removeCredentials: () => Promise.resolve(),
  }, {
    checkIdentity: async (input) => {
      assert.equal(input.profile.clientId, "client");
      const credentials = { ...input.credentials, refreshToken: "rotated-secret" };
      await input.persistCredentials(credentials);
      return { credentials, response: { data: { authenticated: true, verification: "server", tenant: "tenant", scope: ["customers.read"] }, meta: { contract_version: "v1" } } };
    },
    getCustomer: () => Promise.reject(new Error("Must not read business data")),
    listCustomers: () => Promise.reject(new Error("Must not read business data")),
    loginBrowser: () => Promise.reject(new Error("Must not login")),
    loginDevice: () => Promise.reject(new Error("Must not login")), revoke: () => Promise.resolve(),
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /"verification":"server"/u);
  assert.doesNotMatch(result.message, /access-secret|refresh-secret|rotated-secret/u);
});

void test("auth status does not reveal token values", async (): Promise<void> => {
  const result = await run(["auth", "status"], {
    readCredentials: () => Promise.resolve({ default: { profile: { clientId: "public-client", issuer: "https://example.test" }, accessToken: "secret-access", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "secret-refresh", scope: "customers.read" } }),
    removeCredentials: () => Promise.resolve(),
    saveCredentials: () => Promise.resolve(),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stream, "stdout");
  assert.match(result.message, /"authenticated":true/u);
  assert.match(result.message, /"verification":"local_only"/u);
  assert.doesNotMatch(result.message, /secret-access|secret-refresh/u);
});

void test("auth logout only clears local credentials for the selected profile", async (): Promise<void> => {
  const result = await run(["auth", "logout", "--profile", "automation"], {
    readCredentials: () => Promise.resolve({}),
    removeCredentials: (profile) => profile === "automation" ? Promise.resolve() : Promise.reject(new Error("Wrong profile.")),
    saveCredentials: () => Promise.resolve(),
  });

  assert.equal(result.exitCode, 0);
});

void test("auth logout attempts refresh-token revocation before clearing the local credential", async (): Promise<void> => {
  const result = await run(["auth", "logout"], {
    readCredentials: () => Promise.resolve({ default: { profile: { clientId: "public-client", issuer: "https://example.test" }, accessToken: "access-secret", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-secret", scope: "customers.read" } }),
    removeCredentials: (profile) => profile === "default" ? Promise.resolve() : Promise.reject(new Error("Wrong profile.")),
    saveCredentials: () => Promise.resolve(),
  }, {
    getCustomer: () => Promise.reject(new Error("Customer command should not run.")),
    listCustomers: () => Promise.reject(new Error("Customer command should not run.")),
    loginBrowser: () => Promise.reject(new Error("Browser login should not run.")),
    loginDevice: () => Promise.reject(new Error("Device login should not run.")),
    revoke: (input) => input.credentials.refreshToken === "refresh-secret" && input.profile.clientId === "public-client"
      ? Promise.resolve()
      : Promise.reject(new Error("Wrong revocation input.")),
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.message, /"revocation":"confirmed"/u);
  assert.doesNotMatch(result.message, /refresh-secret/u);
});

void test("other commands fail closed until explicitly implemented", async (): Promise<void> => {
  const result = await run(["quotes", "list"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /Unsupported command: quotes/u);
});

void test("unknown auth subcommands use the invalid-input exit code", async (): Promise<void> => {
  const result = await run(["auth", "unknown"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.message, /invalid_request/u);
});

void test("rejects option flags used as OAuth option values before starting a login", async (): Promise<void> => {
  const result = await run(["auth", "login", "--issuer", "--device"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /invalid_request/u);
});

void test("malformed login options are invalid input before storage or OAuth", async (context): Promise<void> => {
  const forbidden = context.mock.fn((): Promise<never> => Promise.reject(new Error("No side effects expected")));
  await Promise.all([
    ["--issuer", "not-a-url"],
    ["--issuer", "https://secret@example.test"],
    ["--issuer", "https://example.test/path"],
    ["--issuer", "https://example.test", "--profile", "../secret"],
    ["--issuer", "https://example.test", "--issuer", "https://other.test"],
    ["--issuer", "https://example.test", "--scope", "a", "--scope", "b"],
  ].flatMap((options) => [options, [...options, "--device"]]).map(async (options): Promise<void> => {
    const result = await run(["auth", "login", ...options],
      { readCredentials: forbidden, saveCredentials: forbidden, removeCredentials: forbidden },
      { loginBrowser: forbidden, loginDevice: forbidden, getCustomer: forbidden, listCustomers: forbidden, revoke: forbidden });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stream, "stderr");
    assert.match(result.message, /invalid_request/u);
    assert.doesNotMatch(result.message, /secret/u);
  }));
  assert.equal(forbidden.mock.callCount(), 0);
});

void test("rejects customer-list option flags used as option values before making a request", async (): Promise<void> => {
  const result = await run(["customers", "list", "--limit", "--profile"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /invalid_request/u);
});

void test("device login stores its result without printing any token", async (): Promise<void> => {
  const result = await run(["auth", "login", "--device", "--issuer", "https://example.test"], {
    readCredentials: () => Promise.resolve({}),
    removeCredentials: () => Promise.resolve(),
    saveCredentials: (_profile, credentials) => {
      assert.equal(credentials.accessToken, "access-secret");
      assert.deepEqual(credentials.profile, { clientId: "public-client", issuer: "https://example.test" });
      return Promise.resolve();
    },
  }, {
    getCustomer: () => Promise.reject(new Error("Customer command should not run.")),
    listCustomers: () => Promise.reject(new Error("Customer command should not run.")),
    loginBrowser: () => Promise.reject(new Error("Browser login should not run.")),
    loginDevice: (_input, onVerification) => {
      onVerification({ deviceCode: "device-secret", expiresIn: 900, interval: 5, userCode: "ABCD-EFGH", verificationUri: "https://example.test/verify" });
      return Promise.resolve({
        credentials: { profile: { clientId: "public-client", issuer: "https://example.test" }, accessToken: "access-secret", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-secret", scope: "customers.read" },
        profile: { clientId: "public-client", issuer: "https://example.test" },
      });
    },
    revoke: () => Promise.reject(new Error("Logout should not run.")),
  });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.message, /access-secret|refresh-secret/u);
});

await Promise.all([
  { issuer: "https://example.test" },
  { issuer: "https://example.test", deviceGrantVerified: false },
  { issuer: "https://example.test", deviceGrantVerified: true },
  { issuer: "https://other.test", deviceGrantVerified: true },
].map((previous) => test(`device login reuses only a proven same-issuer client: ${JSON.stringify(previous)}`, async () => {
  const stored = { profile: { clientId: "previous-client", ...previous }, accessToken: "old-access",
    expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "old-refresh", scope: "customers.read" };
  const profile = { clientId: "device-client", issuer: "https://example.test", deviceGrantVerified: true };
  const forbidden = (): Promise<never> => Promise.reject(new Error("Unexpected command"));
  const result = await run(["auth", "login", "--device", "--issuer", "https://example.test"], {
    readCredentials: () => Promise.resolve({ default: stored }), removeCredentials: forbidden,
    saveCredentials: (_name, credentials) => { assert.deepEqual(credentials.profile, profile); return Promise.resolve(); },
  }, { getCustomer: forbidden, listCustomers: forbidden, loginBrowser: forbidden, revoke: forbidden,
    loginDevice: (input) => {
      assert.equal(input.clientId, previous.issuer === profile.issuer && previous.deviceGrantVerified === true ? "previous-client" : undefined);
      return Promise.resolve({ credentials: { ...stored, profile }, profile });
    },
  });
  assert.equal(result.exitCode, 0);
})));

void test("customer list preserves the agent response envelope and stores a rotated credential", async (): Promise<void> => {
  const result = await run(["customers", "list", "--limit", "10"], {
    readCredentials: () => Promise.resolve({ default: { profile: { clientId: "public-client", issuer: "https://example.test" }, accessToken: "old-access", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "old-refresh", scope: "customers.read" } }),
    removeCredentials: () => Promise.resolve(),
    saveCredentials: (_name, credentials) => {
      assert.equal(credentials.refreshToken, "new-refresh");
      return Promise.resolve();
    },
  }, {
    getCustomer: () => Promise.reject(new Error("Customer get should not run.")),
    listCustomers: async (input) => {
      assert.equal(input.options.limit, 10);
      const credentials = { ...input.credentials, accessToken: "new-access", refreshToken: "new-refresh" };
      await input.persistCredentials(credentials);
      return { credentials, response: { data: { items: [] }, meta: { contract_version: "v1", request_id: "req" } } };
    },
    loginBrowser: () => Promise.reject(new Error("Browser login should not run.")),
    loginDevice: () => Promise.reject(new Error("Device login should not run.")),
    revoke: () => Promise.reject(new Error("Logout should not run.")),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.message, JSON.stringify({ data: { items: [] }, meta: { contract_version: "v1", request_id: "req" } }));
});

void test("recognizes an npm bin symlink as the CLI entrypoint", (): void => {
  const resolvePath = (path: string): string => path === "/bin/bizyeet" ? "/pkg/dist/src/cli.js" : path;

  assert.equal(isCliEntrypoint("/bin/bizyeet", resolvePath, "/pkg/dist/src/cli.js"), true);
});

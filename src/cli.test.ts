import assert from "node:assert/strict";
import test from "node:test";

import { isCliEntrypoint, run } from "./cli.js";
import { agentFailure } from "./agent-error.js";
import { listCustomers } from "./agent-client.js";
import { CRM_SEARCH_LIMIT_MESSAGE } from "./search-contract.js";

await Promise.all(["--profile", "--profile=other"].flatMap((id) => ["default", "selected"].map((name) =>
  test(`locks the selected profile for separated opaque ID ${id} with ${name}`, async (context) => {
    const forbidden = (): Promise<never> => Promise.reject(new Error("Unexpected operation"));
    const credentials = { profile: { clientId: "public-client", issuer: "https://example.test" },
      accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "customers.read" };
    const save = context.mock.fn((profile: string): Promise<void> => { assert.equal(profile, name); return Promise.resolve(); });
    const result = await run(["customers", "get", ...(name === "default" ? [] : ["--profile", name]), "--", id], {
      withProfileLock: async (profile, operation) => { assert.equal(profile, name); return { result: await operation(), cleanupFailed: false }; },
      readCredentials: () => Promise.resolve({ [name]: credentials }), saveCredentials: save, removeCredentials: forbidden,
    }, {
      loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, revoke: forbidden,
      getCustomer: async (input) => {
        assert.equal(input.resourceId, id);
        await input.persistCredentials(credentials);
        return { credentials, response: { data: { id }, meta: { contract_version: "v1" } } };
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(save.mock.callCount(), 1);
  }))));

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

await Promise.all([false, true].flatMap((device) => [
  "OAuth registration does not permit secretless login with the selected flow and refresh tokens. Contact your tenant administrator before retrying.",
  "OAuth registration did not assign exactly the requested scopes. Contact your tenant administrator before retrying.",
].map((message) => test(`registration assignment diagnostics survive CLI filtering (device: ${String(device)}): ${message}`, async () => {
  const forbidden = (): never => { throw new Error("Unexpected storage or business operation"); };
  const rejectLogin = (): Promise<never> => Promise.reject(new Error(message));
  const result = await run(["auth", "login", "--issuer", "https://example.test", ...(device ? ["--device"] : [])], {
    readCredentials: () => Promise.resolve({}), removeCredentials: forbidden, saveCredentials: forbidden,
  }, {
    getCustomer: forbidden, listCustomers: forbidden, revoke: forbidden,
    loginBrowser: device ? forbidden : rejectLogin, loginDevice: device ? rejectLogin : forbidden,
  });
  assert.equal(result.exitCode, 3);
  assert.equal(result.stream, "stderr");
  assert.ok(result.message.includes(JSON.stringify(message)));
  assert.match(result.message, /"code":"authentication_required"/u);
}))));

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

void test("failed logout revocation retains the bound credential for a later successful retry", async (context): Promise<void> => {
  const credentials = { profile: { clientId: "public-client", issuer: "https://example.test" }, accessToken: "access-secret", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-secret", scope: "customers.read" };
  const removeCredentials = context.mock.fn(() => Promise.resolve());
  const storage: NonNullable<Parameters<typeof run>[1]> = { readCredentials: () => Promise.resolve({ automation: credentials }), removeCredentials, saveCredentials: () => Promise.resolve() };
  const forbidden = (): Promise<never> => Promise.reject(new Error("Unexpected operation"));
  const revoke = context.mock.fn(() => Promise.reject(new Error("Discovery or revocation failed: refresh-secret")));
  const runtime = { getCustomer: forbidden, listCustomers: forbidden, loginBrowser: forbidden, loginDevice: forbidden, revoke };
  const args = ["auth", "logout", "--profile", "automation"];
  const failed = await run(args, storage, runtime);
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.stream, "stderr");
  assert.match(failed.message, /"code":"request_unavailable"/u);
  assert.match(failed.message, /Credentials were retained/u);
  assert.doesNotMatch(failed.message, /access-secret|refresh-secret|"logged_out":true/u);
  assert.equal(removeCredentials.mock.callCount(), 0);
  assert.equal(revoke.mock.callCount(), 1);
  const retried = await run(args, storage, { ...runtime, revoke: (input) => {
    assert.deepEqual(input.credentials, credentials);
    assert.equal(removeCredentials.mock.callCount(), 0);
    return Promise.resolve();
  } });
  assert.equal(retried.exitCode, 0);
  assert.match(retried.message, /"revocation":"confirmed"/u);
  assert.equal(removeCredentials.mock.callCount(), 1);
  assert.deepEqual(removeCredentials.mock.calls[0]?.arguments, ["automation"]);
});

void test("unbound legacy logout is explicitly local-only without attempting network revocation", async (context): Promise<void> => {
  const forbidden = context.mock.fn((): Promise<never> => Promise.reject(new Error("Cannot revoke an unbound record")));
  const result = await run(["auth", "logout"], {
    readCredentials: () => Promise.resolve({ default: { accessToken: "access-secret", refreshToken: "refresh-secret", expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.read" } }),
    removeCredentials: () => Promise.resolve(), saveCredentials: forbidden,
  }, { getCustomer: forbidden, listCustomers: forbidden, loginBrowser: forbidden, loginDevice: forbidden, revoke: forbidden });
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /"revocation":"local_only"/u);
  assert.equal(forbidden.mock.callCount(), 0);
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
  { issuer: "https://example.test", deviceGrantVerified: true, deviceRegistrationVersion: 1 },
  { issuer: "https://other.test", deviceGrantVerified: true, deviceRegistrationVersion: 1 },
  { issuer: "https://example.test", deviceGrantVerified: false, deviceRegistrationVersion: 1 },
  { issuer: "https://example.test", deviceGrantVerified: true, deviceRegistrationVersion: 2 },
  { issuer: "https://example.test", deviceGrantVerified: true, deviceRegistrationVersion: 2, registeredScope: "customers.read" },
  { issuer: "https://example.test", deviceGrantVerified: true, deviceRegistrationVersion: 2, registeredScope: "customers.read customers.write" },
].map((previous) => test(`device login reuses only a proven same-issuer client: ${JSON.stringify(previous)}`, async () => {
  const stored = { profile: { clientId: "previous-client", ...previous }, accessToken: "old-access",
    expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "old-refresh", scope: "customers.read" };
  const profile = { clientId: "device-client", issuer: "https://example.test", deviceGrantVerified: true };
  const forbidden = (): Promise<never> => Promise.reject(new Error("Unexpected command"));
  const result = await run(["auth", "login", "--device", "--issuer", "https://example.test"], {
    readCredentials: () => Promise.resolve({ default: stored }), removeCredentials: forbidden,
    saveCredentials: (_name, credentials) => { assert.deepEqual(credentials.profile, profile); return Promise.resolve(); },
  }, { getCustomer: forbidden, listCustomers: forbidden, loginBrowser: forbidden,
    revoke: (input) => { assert.deepEqual(input.credentials, stored); assert.deepEqual(input.profile, stored.profile); return Promise.resolve(); },
    loginDevice: (input) => {
      const reusable = previous.issuer === profile.issuer && previous.deviceGrantVerified === true && previous.deviceRegistrationVersion === 2 && previous.registeredScope === "customers.read";
      assert.equal(input.clientId, reusable ? "previous-client" : undefined);
      assert.equal(input.deviceRegistrationVersion, reusable ? 2 : undefined);
      assert.equal(input.registeredScope, reusable ? "customers.read" : undefined);
      return Promise.resolve({ credentials: { ...stored, profile }, profile });
    },
  });
  assert.equal(result.exitCode, 0);
})));

await Promise.all([false, true].map((device) => test(`replacement login retires the old grant first, device=${String(device)}`, async (context): Promise<void> => {
  const profile = { clientId: "old-client", issuer: "https://old.example.test" };
  const stored = { profile, accessToken: "old-access", refreshToken: "old-refresh", scope: "customers.read", expiresAt: "2099-01-01T00:00:00.000Z" };
  const replacementProfile = { clientId: "new-client", issuer: "https://new.example.test" };
  const forbidden = (): Promise<never> => Promise.reject(new Error("Unexpected operation"));
  const save = context.mock.fn(() => Promise.resolve());
  const revoke = context.mock.fn((input: Parameters<NonNullable<Parameters<typeof run>[2]>["revoke"]>[0]) => {
    assert.deepEqual(input, { credentials: stored, profile });
    return Promise.resolve();
  });
  const authorize = context.mock.fn(() => {
    assert.equal(revoke.mock.callCount(), 1);
    return Promise.resolve({ profile: replacementProfile, credentials: { ...stored, profile: replacementProfile, refreshToken: "new-refresh" } });
  });
  const storage: NonNullable<Parameters<typeof run>[1]> = { readCredentials: () => Promise.resolve({ default: stored }), saveCredentials: save, removeCredentials: forbidden };
  const runtime = { revoke, loginBrowser: authorize, loginDevice: authorize, getCustomer: forbidden, listCustomers: forbidden };
  const args = ["auth", "login", "--issuer", replacementProfile.issuer, ...(device ? ["--device"] : [])];
  const failed = await run(args, storage, { ...runtime, revoke: () => Promise.reject(new Error("old-refresh")) });
  assert.equal(failed.exitCode, 1);
  assert.equal(authorize.mock.callCount(), 0);
  assert.equal(save.mock.callCount(), 0);
  assert.doesNotMatch(failed.message, /old-refresh|old-access/u);
  const success = await run(args, storage, runtime);
  assert.equal(success.exitCode, 0);
  assert.equal(authorize.mock.callCount(), 1);
  assert.equal(save.mock.callCount(), 1);
  const cancelled = await run(args, storage, { ...runtime, loginBrowser: forbidden, loginDevice: forbidden });
  assert.equal(cancelled.exitCode, 3);
  assert.equal(revoke.mock.callCount(), 2);
  assert.equal(save.mock.callCount(), 1);
})));

void test("replacement refuses an unbound legacy refresh credential before network or storage writes", async (context): Promise<void> => {
  const forbidden = context.mock.fn((): Promise<never> => Promise.reject(new Error("Unexpected operation")));
  const response = await run(["auth", "login", "--issuer", "https://example.test"], {
    readCredentials: () => Promise.resolve({ default: { accessToken: "old-access", refreshToken: "old-refresh", scope: "customers.read", expiresAt: "2099-01-01T00:00:00.000Z" } }),
    saveCredentials: forbidden, removeCredentials: forbidden,
  }, { revoke: forbidden, loginBrowser: forbidden, loginDevice: forbidden, getCustomer: forbidden, listCustomers: forbidden });
  assert.equal(response.exitCode, 3);
  assert.match(response.message, /dashboard settings/u);
  assert.doesNotMatch(response.message, /old-access|old-refresh/u);
  assert.equal(forbidden.mock.callCount(), 0);
});

await Promise.all(["customers.read ", " customers.read", "customers.read  customers.write", "read\twrite", "read\n", "réad", 'read"write', "read\\write"].map((scope) => test(`invalid scope is rejected before storage, locking or revocation: ${JSON.stringify(scope)}`, async (context): Promise<void> => {
  const forbidden = context.mock.fn((): Promise<never> => Promise.reject(new Error("Unexpected side effect")));
  const response = await run(["auth", "login", "--issuer", "https://example.test", "--scope", scope], {
    withProfileLock: forbidden, readCredentials: forbidden, saveCredentials: forbidden, removeCredentials: forbidden,
  }, { revoke: forbidden, loginBrowser: forbidden, loginDevice: forbidden, getCustomer: forbidden, listCustomers: forbidden });
  assert.equal(response.exitCode, 2);
  assert.equal(forbidden.mock.callCount(), 0);
})));

await Promise.all([false, true].flatMap((device) => [false, true].map((cleanupFails) => test(`failed credential save revokes the completed grant: device=${String(device)}, cleanupFails=${String(cleanupFails)}`, async (context): Promise<void> => {
  const profile = { issuer: "https://example.test", clientId: "new-client" };
  const credentials = { accessToken: "new-access", refreshToken: "new-refresh", scope: "customers.read", expiresAt: "2099-01-01T00:00:00.000Z" };
  const forbidden = (): Promise<never> => Promise.reject(new Error("Unexpected operation"));
  const saved = context.mock.fn(() => Promise.reject(new Error("new-refresh storage failure")));
  const revoke = context.mock.fn((input: Parameters<NonNullable<Parameters<typeof run>[2]>["revoke"]>[0]) => {
    assert.equal(saved.mock.callCount(), 1);
    assert.deepEqual(input, { credentials, profile });
    return cleanupFails ? Promise.reject(new Error("new-refresh cleanup failure")) : Promise.resolve();
  });
  const authorize = (): Promise<Readonly<{ credentials: typeof credentials; profile: typeof profile }>> => Promise.resolve({ credentials, profile });
  const response = await run(["auth", "login", "--issuer", profile.issuer, ...(device ? ["--device"] : [])], {
    readCredentials: () => Promise.resolve({}), saveCredentials: saved, removeCredentials: forbidden,
  }, { revoke, loginBrowser: authorize, loginDevice: authorize, getCustomer: forbidden, listCustomers: forbidden });
  assert.equal(response.exitCode, 3);
  assert.equal(revoke.mock.callCount(), 1);
  assert.match(response.message, cleanupFails ? /dashboard settings/u : /new grant was revoked/u);
  assert.doesNotMatch(response.message, /new-refresh|new-access/u);
}))));

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

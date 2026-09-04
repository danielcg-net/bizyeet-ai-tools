import assert from "node:assert/strict";
import test from "node:test";

import { isCliEntrypoint, run } from "./cli.js";

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

void test("auth status does not reveal token values", async (): Promise<void> => {
  const result = await run(["auth", "status"], {
    readCredentials: () => Promise.resolve({ default: { accessToken: "secret-access", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "secret-refresh", scope: "customers.read" } }),
    readProfiles: () => Promise.resolve({ default: { clientId: "public-client", issuer: "https://example.test" } }),
    removeCredentials: () => Promise.resolve(),
    saveCredentials: () => Promise.resolve(),
    saveProfile: () => Promise.resolve(),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stream, "stdout");
  assert.match(result.message, /"authenticated":true/u);
  assert.doesNotMatch(result.message, /secret-access|secret-refresh/u);
});

void test("auth logout only clears local credentials for the selected profile", async (): Promise<void> => {
  const result = await run(["auth", "logout", "--profile", "automation"], {
    readCredentials: () => Promise.resolve({}),
    readProfiles: () => Promise.resolve({}),
    removeCredentials: (profile) => profile === "automation" ? Promise.resolve() : Promise.reject(new Error("Wrong profile.")),
    saveCredentials: () => Promise.resolve(),
    saveProfile: () => Promise.resolve(),
  });

  assert.equal(result.exitCode, 0);
});

void test("auth logout attempts refresh-token revocation before clearing the local credential", async (): Promise<void> => {
  const result = await run(["auth", "logout"], {
    readCredentials: () => Promise.resolve({ default: { accessToken: "access-secret", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-secret", scope: "customers.read" } }),
    readProfiles: () => Promise.resolve({ default: { clientId: "public-client", issuer: "https://example.test" } }),
    removeCredentials: (profile) => profile === "default" ? Promise.resolve() : Promise.reject(new Error("Wrong profile.")),
    saveCredentials: () => Promise.resolve(),
    saveProfile: () => Promise.resolve(),
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

  assert.equal(result.exitCode, 1);
  assert.match(result.message, /Unsupported command: quotes/u);
});

void test("rejects option flags used as OAuth option values before starting a login", async (): Promise<void> => {
  const result = await run(["auth", "login", "--issuer", "--device"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /invalid_request/u);
});

void test("rejects customer-list option flags used as option values before making a request", async (): Promise<void> => {
  const result = await run(["customers", "list", "--limit", "--profile"]);

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /invalid_request/u);
});

void test("device login stores its result without printing any token", async (): Promise<void> => {
  const result = await run(["auth", "login", "--device", "--issuer", "https://example.test"], {
    readCredentials: () => Promise.resolve({}),
    readProfiles: () => Promise.resolve({}),
    removeCredentials: () => Promise.resolve(),
    saveCredentials: (_profile, credentials) => {
      assert.equal(credentials.accessToken, "access-secret");
      return Promise.resolve();
    },
    saveProfile: (_profile, profile) => {
      assert.equal(profile.clientId, "public-client");
      return Promise.resolve();
    },
  }, {
    getCustomer: () => Promise.reject(new Error("Customer command should not run.")),
    listCustomers: () => Promise.reject(new Error("Customer command should not run.")),
    loginBrowser: () => Promise.reject(new Error("Browser login should not run.")),
    loginDevice: (_input, onVerification) => {
      onVerification({ deviceCode: "device-secret", expiresIn: 900, interval: 5, userCode: "ABCD-EFGH", verificationUri: "https://example.test/verify" });
      return Promise.resolve({
        credentials: { accessToken: "access-secret", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-secret", scope: "customers.read" },
        profile: { clientId: "public-client", issuer: "https://example.test" },
      });
    },
    revoke: () => Promise.reject(new Error("Logout should not run.")),
  });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.message, /access-secret|refresh-secret/u);
});

void test("customer list preserves the agent response envelope and stores a rotated credential", async (): Promise<void> => {
  const result = await run(["customers", "list", "--limit", "10"], {
    readCredentials: () => Promise.resolve({ default: { accessToken: "old-access", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "old-refresh", scope: "customers.read" } }),
    readProfiles: () => Promise.resolve({ default: { clientId: "public-client", issuer: "https://example.test" } }),
    removeCredentials: () => Promise.resolve(),
    saveCredentials: (_name, credentials) => {
      assert.equal(credentials.refreshToken, "new-refresh");
      return Promise.resolve();
    },
    saveProfile: () => Promise.resolve(),
  }, {
    getCustomer: () => Promise.reject(new Error("Customer get should not run.")),
    listCustomers: (input) => {
      assert.equal(input.options.limit, 10);
      return Promise.resolve({ credentials: { ...input.credentials, accessToken: "new-access", refreshToken: "new-refresh" }, response: { data: { items: [] }, meta: { contract_version: "v1", request_id: "req" } } });
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

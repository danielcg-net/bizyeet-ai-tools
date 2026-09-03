import assert from "node:assert/strict";
import test from "node:test";

import { isCliEntrypoint, run } from "./cli.js";

void test("help documents the OAuth-only command surface", async (): Promise<void> => {
  const result = await run(["--help"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stream, "stdout");
  assert.match(result.message, /OAuth/u);
  assert.doesNotMatch(result.message, /access_token|refresh_token/u);
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

void test("other commands fail closed until explicitly implemented", async (): Promise<void> => {
  const result = await run(["customers", "list"]);

  assert.equal(result.exitCode, 1);
  assert.match(result.message, /Unsupported command: customers/u);
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
    loginDevice: (_input, onVerification) => {
      onVerification({ deviceCode: "device-secret", expiresIn: 900, interval: 5, userCode: "ABCD-EFGH", verificationUri: "https://example.test/verify" });
      return Promise.resolve({
        credentials: { accessToken: "access-secret", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-secret", scope: "customers.read" },
        profile: { clientId: "public-client", issuer: "https://example.test" },
      });
    },
  });

  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.message, /access-secret|refresh-secret/u);
});

void test("recognizes an npm bin symlink as the CLI entrypoint", (): void => {
  const resolvePath = (path: string): string => path === "/bin/bizyeet" ? "/pkg/dist/src/cli.js" : path;

  assert.equal(isCliEntrypoint("/bin/bizyeet", resolvePath, "/pkg/dist/src/cli.js"), true);
});

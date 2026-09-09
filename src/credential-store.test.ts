import assert from "node:assert/strict";
import test from "node:test";

import { createCredentialStore } from "./credential-store.js";
import { run } from "./cli.js";
import type { Keychain } from "./keychain.js";
import type { CredentialCollection, StoredCredentials } from "./profile-store.js";

const credentials: StoredCredentials = Object.freeze({
  accessToken: "access-secret",
  expiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "refresh-secret",
  scope: "customers.read",
});

const keychain = (overrides: Partial<Keychain> = {}): Keychain => ({
  read: () => Promise.resolve(undefined),
  remove: () => Promise.resolve(),
  save: () => Promise.resolve(),
  ...overrides,
});

const fallback = (overrides: Partial<Readonly<{
  read: () => Promise<CredentialCollection>;
  remove: (profile: string) => Promise<void>;
  save: (profile: string, value: StoredCredentials) => Promise<void>;
}>> = {}): Readonly<{
  read: () => Promise<CredentialCollection>;
  remove: (profile: string) => Promise<void>;
  save: (profile: string, value: StoredCredentials) => Promise<void>;
}> => ({
  read: () => Promise.resolve({}),
  remove: () => Promise.resolve(),
  save: () => Promise.resolve(),
  ...overrides,
});

void test("Windows unavailable storage rejects before browser or device authorization", async (context): Promise<void> => {
  const fallbackRead = context.mock.fn(() => Promise.resolve({}));
  const authorize = context.mock.fn((): Promise<never> => Promise.reject(new Error("OAuth must not start")));
  const stored = createCredentialStore(keychain({ read: () => Promise.reject(new Error("No keyring backend is available.")) }),
    fallback({ read: fallbackRead }), { platform: "win32" });
  await assert.rejects(stored.read(), /Windows OAuth credentials/u);
  await Promise.all([[], ["--device"]].map(async (flags): Promise<void> => {
    const result = await run(["auth", "login", "--issuer", "https://example.test", ...flags],
      { readCredentials: stored.read, saveCredentials: stored.save, removeCredentials: stored.remove },
      { loginBrowser: authorize, loginDevice: authorize, getCustomer: authorize, listCustomers: authorize, revoke: authorize });
    assert.equal(result.exitCode, 3);
    assert.match(result.message, /Windows OAuth credentials/u);
  }));
  assert.equal(fallbackRead.mock.callCount(), 0);
  assert.equal(authorize.mock.callCount(), 0);
});

void test("an available empty Windows keychain still permits a new profile", async (): Promise<void> => {
  const stored = createCredentialStore(keychain(), fallback(), { platform: "win32" });
  assert.deepEqual(await stored.read(), {});
});

void test("explicit POSIX file mode never queries or copies the native store", async (context): Promise<void> => {
  const forbidden = (): Promise<never> => Promise.reject(new Error("Native store must not run."));
  const read = context.mock.fn(() => Promise.resolve({ automation: credentials }));
  const save = context.mock.fn(() => Promise.resolve());
  const remove = context.mock.fn(() => Promise.resolve());
  const stored = createCredentialStore(keychain({ read: forbidden, save: forbidden, remove: forbidden }),
    { read, save, remove }, { mode: () => "file", platform: "linux" });
  assert.deepEqual(await stored.read("automation"), { automation: credentials });
  await stored.save("automation", credentials);
  await stored.remove("automation");
  assert.equal(read.mock.callCount(), 1);
  assert.deepEqual(save.mock.calls[0]?.arguments, ["automation", credentials]);
  assert.deepEqual(remove.mock.calls[0]?.arguments, ["automation"]);
});

[
  { mode: "file", platform: "win32" as const, message: /Windows OAuth credentials/u },
  { mode: "FILE", platform: "linux" as const, message: /must be auto or file/u },
  { mode: "", platform: "linux" as const, message: /must be auto or file/u },
  { mode: "untrusted-secret-value", platform: "linux" as const, message: /must be auto or file/u },
].forEach(({ mode, platform, message }) => {
  void test(`rejects invalid credential mode ${mode} on ${platform} before store access`, async (): Promise<void> => {
    const forbidden = (): Promise<never> => Promise.reject(new Error("No store may be accessed."));
    const stored = createCredentialStore(keychain({ read: forbidden, save: forbidden, remove: forbidden }),
      fallback({ read: forbidden, save: forbidden, remove: forbidden }), { mode: () => mode, platform });
    await assert.rejects(stored.read(), message);
    await assert.rejects(stored.save("default", credentials), message);
    await assert.rejects(stored.remove("default"), message);
  });
});

void test("prefers an OS credential store and removes an old fallback token after saving", async (): Promise<void> => {
  const removed: string[] = [];
  const stored = createCredentialStore(keychain({
    save: (profile, value) => {
      assert.equal(profile, "default");
      assert.equal(value.refreshToken, "refresh-secret");
      return Promise.resolve();
    },
  }), fallback({ remove: (profile) => {
    removed.push(profile);
    return Promise.resolve();
  } }));

  await stored.save("default", credentials);

  assert.deepEqual(removed, ["default"]);
});

void test("uses the owner-only fallback only when the OS credential service is unavailable", async (): Promise<void> => {
  const written: StoredCredentials[] = [];
  const stored = createCredentialStore(keychain({
    save: () => Promise.reject(new Error("No keyring backend is available.")),
  }), fallback({ save: (_profile, value) => {
    written.push(value);
    return Promise.resolve();
  } }));

  await stored.save("default", credentials);

  assert.deepEqual(written, [credentials]);
});

void test("reads a secure credential without touching an obsolete fallback file", async (): Promise<void> => {
  const stored = createCredentialStore(keychain({ read: () => Promise.resolve(credentials) }), fallback({
    read: () => Promise.reject(new Error("Fallback must not run.")),
  }));

  assert.deepEqual(await stored.read("automation"), { automation: credentials });
});

void test("does not downgrade to a file when an available OS credential store is locked", async (): Promise<void> => {
  const stored = createCredentialStore(keychain({
    save: () => Promise.reject(new Error("The keyring is locked.")),
  }), fallback({
    save: () => Promise.reject(new Error("Fallback must not run.")),
  }));

  await assert.rejects(stored.save("default", credentials), /keyring is locked/u);
});

[
  "The keyring is Locked.",
  "Keyring: Permission Denied",
  "keyring entry is ambiguous",
  "keyring database is corrupt",
  "keyring backend is unavailable: permission denied",
  "Platform secure storage failure: Operation not permitted",
  "unknown keyring failure",
].forEach((message) => {
  void test(`fails closed for credential-store error: ${message}`, async (): Promise<void> => {
    const failure = new Error(message);
    const reject = (): Promise<never> => Promise.reject(failure);
    const forbidden = (): Promise<never> => Promise.reject(new Error("Fallback must not run."));
    const stored = createCredentialStore(keychain({ read: reject, save: reject, remove: reject }),
      fallback({ read: forbidden, save: forbidden, remove: forbidden }));
    await assert.rejects(stored.read("default"), (error: unknown) => error === failure);
    await assert.rejects(stored.save("default", credentials), (error: unknown) => error === failure);
    await assert.rejects(stored.remove("default"), (error: unknown) => error === failure);
  });
});

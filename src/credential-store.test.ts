import assert from "node:assert/strict";
import test from "node:test";

import { createCredentialStore } from "./credential-store.js";
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

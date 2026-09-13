import assert from "node:assert/strict";
import test from "node:test";

import { createKeychain } from "./keychain.js";

const credentials = {
  accessToken: "access-secret",
  expiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "refresh-secret",
  scope: "customers.read",
};

void test("does not load the native entry until an operation and preserves loader errors", async (context): Promise<void> => {
  const failure = new Error("Native binding unavailable");
  const loader = context.mock.fn((): Promise<never> => Promise.reject(failure));
  const keychain = createKeychain(loader);
  assert.equal(loader.mock.callCount(), 0);
  await assert.rejects(keychain.read("default"), (error: unknown) => error === failure);
  await assert.rejects(keychain.save("default", credentials), (error: unknown) => error === failure);
  await assert.rejects(keychain.remove("default"), (error: unknown) => error === failure);
  assert.equal(loader.mock.callCount(), 3);
});

const entry = (password: unknown): Readonly<{
  deleteCredential: () => Promise<unknown>;
  getPassword: () => Promise<unknown>;
  setPassword: (value: string) => Promise<unknown>;
}> => ({
  deleteCredential: (): Promise<unknown> => Promise.resolve(true),
  getPassword: (): Promise<unknown> => Promise.resolve(password),
  setPassword: (): Promise<unknown> => Promise.resolve(),
});

void test("treats null and empty native-keyring reads as an absent credential", async (): Promise<void> => {
  const nullKeychain = createKeychain(() => entry(null));
  const emptyKeychain = createKeychain(() => entry(""));

  assert.equal(await nullKeychain.read("default"), undefined);
  assert.equal(await emptyKeychain.read("default"), undefined);
});

void test("rejects malformed native-keyring values and accepts valid credential JSON", async (): Promise<void> => {
  const malformedKeychain = createKeychain(() => entry("not-json"));
  const validKeychain = createKeychain(() => entry(JSON.stringify(credentials)));

  await assert.rejects(malformedKeychain.read("default"), /credentials are invalid/u);
  assert.deepEqual(await validKeychain.read("default"), credentials);
});

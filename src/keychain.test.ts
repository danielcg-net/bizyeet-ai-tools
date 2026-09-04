import assert from "node:assert/strict";
import test from "node:test";

import { createKeychain } from "./keychain.js";

const credentials = {
  accessToken: "access-secret",
  expiresAt: "2099-01-01T00:00:00.000Z",
  refreshToken: "refresh-secret",
  scope: "customers.read",
};

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

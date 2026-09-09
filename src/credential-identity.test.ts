import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { run } from "./cli.js";
import { checkIdentity, listCustomers } from "./agent-client.js";
import { createKeychain } from "./keychain.js";
import { isCredentials, type StoredCredentials } from "./profile-store.js";

const profile = { issuer: "https://example.test", clientId: "public-client" };
const legacy = { accessToken: "old-access", refreshToken: "old-refresh", expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.read" };
const bound = { ...legacy, profile };
const forbidden = (): never => { throw new Error("Unexpected network or metadata operation"); };
const makeRuntime = (): NonNullable<Parameters<typeof run>[2]> => ({
  checkIdentity: forbidden, getCustomer: forbidden, listCustomers: forbidden,
  previewCustomerUpdate: forbidden, executeCustomerUpdate: forbidden,
  loginBrowser: forbidden, loginDevice: forbidden, revoke: forbidden,
});

await test("legacy credentials require re-login without any network operation, and logout only clears locally", async () => {
  const network = mock.fn(forbidden);
  const removeCredentials = mock.fn(() => Promise.resolve());
  const storage: NonNullable<Parameters<typeof run>[1]> = { readCredentials: () => Promise.resolve({ default: legacy }), removeCredentials, saveCredentials: forbidden };
  const runtime = { ...makeRuntime(), checkIdentity: network, getCustomer: network, listCustomers: network, revoke: network,
    previewCustomerUpdate: network, executeCustomerUpdate: network };
  await Promise.all([
    ["auth", "status"], ["auth", "check"], ["customers", "list"], ["customers", "get", "customer-id"],
    ["customers", "update", "preview", "customer-id", "--input-stdin"],
    ["customers", "update", "execute", "11111111-1111-4111-8111-111111111111", "--idempotency-key", "22222222-2222-4222-8222-222222222222"],
  ].map(async (args) => {
    const result = await run(args, storage, runtime);
    assert.equal(result.exitCode, 3);
    assert.match(result.message, /auth login/u);
    assert.doesNotMatch(result.message, /old-access|old-refresh/u);
  }));
  const logout = await run(["auth", "logout"], storage, runtime);
  assert.equal(logout.exitCode, 0);
  assert.match(logout.message, /"revocation":"local_only"/u);
  assert.equal(removeCredentials.mock.callCount(), 1);
  assert.equal(network.mock.callCount(), 0);
});

await test("login replacement saves one coherent protected record and a failed save cannot redirect old tokens", async () => {
  const replacement = { issuer: "https://different.example", clientId: "new-client" };
  const saveCredentials = mock.fn((_name: string, credentials: StoredCredentials): Promise<void> => {
    assert.deepEqual(credentials.profile, replacement);
    assert.equal(credentials.accessToken, "new-access");
    return Promise.reject(new Error("Native storage denied"));
  });
  const publicMetadata = mock.fn(forbidden);
  // Extra legacy helpers deliberately exist but must never be invoked.
  const storage = { readCredentials: (): Promise<Readonly<Record<string, StoredCredentials>>> => Promise.resolve({ default: bound }), saveCredentials, removeCredentials: forbidden,
    readProfiles: publicMetadata, saveProfile: publicMetadata };
  const runtime: NonNullable<Parameters<typeof run>[2]> = { ...makeRuntime(), loginDevice: (input) => {
    assert.equal(input.clientId, undefined);
    return Promise.resolve({ profile: replacement, credentials: { ...legacy, accessToken: "new-access", refreshToken: "new-refresh" } });
  }, checkIdentity: (input) => {
    assert.deepEqual(input.profile, profile);
    assert.equal(input.credentials.accessToken, "old-access");
    return Promise.resolve({ credentials: bound, response: {} });
  } };
  assert.equal((await run(["auth", "login", "--device", "--issuer", replacement.issuer], storage, runtime)).exitCode, 3);
  assert.equal((await run(["auth", "check"], storage, runtime)).exitCode, 0);
  assert.equal(saveCredentials.mock.callCount(), 1);
  assert.equal(publicMetadata.mock.callCount(), 0);
});

await test("explicit login replaces an unbound legacy record without reusing public client metadata", async () => {
  const saveCredentials = mock.fn(() => Promise.resolve());
  const loginDevice = mock.fn((input: Readonly<{ clientId?: string }>) => {
    assert.equal(input.clientId, undefined);
    return Promise.resolve({ profile, credentials: bound });
  });
  const result = await run(["auth", "login", "--device", "--issuer", profile.issuer], {
    readCredentials: () => Promise.resolve({ default: legacy }), removeCredentials: forbidden, saveCredentials,
  }, { ...makeRuntime(), loginDevice });
  assert.equal(result.exitCode, 0);
  assert.equal(saveCredentials.mock.callCount(), 1);
  assert.deepEqual(saveCredentials.mock.calls[0]?.arguments, ["default", bound]);
});

await test("agent boundary rejects missing or mismatched identity before bearer use or refresh", async () => {
  await Promise.all([legacy, { ...bound, profile: { ...profile, issuer: "https://attacker.invalid" } },
    { ...bound, profile: { ...profile, clientId: "other-client" } }].flatMap((credentials) => [0, Date.parse("2100-01-01")].map(async (now) => {
    const fetcher = mock.fn(forbidden);
    const input = { credentials, profile, fetcher, now: (): number => now, persistCredentials: forbidden,
      metadata: { authorization_endpoint: `${profile.issuer}/authorize`, token_endpoint: `${profile.issuer}/token` } };
    await assert.rejects(checkIdentity(input), /auth login/u);
    await assert.rejects(listCustomers({ ...input, options: {} }), /auth login/u);
    assert.equal(fetcher.mock.callCount(), 0);
  })));
});

await test("native records retain the same identity binding as the shared fallback parser", async () => {
  const setPassword = mock.fn(() => Promise.resolve());
  const keychain = createKeychain(() => ({ getPassword: (): Promise<string> => Promise.resolve(JSON.stringify(bound)), setPassword, deleteCredential: forbidden }));
  await keychain.save("default", bound);
  assert.deepEqual(setPassword.mock.calls[0]?.arguments, [JSON.stringify(bound)]);
  assert.deepEqual(await keychain.read("default"), bound);
  assert.equal(isCredentials(bound), true);
  assert.equal(isCredentials(legacy), true);
  await Promise.all([null, {}, { issuer: profile.issuer }, { clientId: profile.clientId }, "invalid"].map(async (invalid) => {
    const stored = { ...legacy, profile: invalid };
    assert.equal(isCredentials(stored), false);
    const invalidKeychain = createKeychain(() => ({ getPassword: (): Promise<string> => Promise.resolve(JSON.stringify(stored)), setPassword, deleteCredential: forbidden }));
    await assert.rejects(invalidKeychain.read("default"), /credentials are invalid/u);
  }));
});

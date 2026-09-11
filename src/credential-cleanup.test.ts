import assert from "node:assert/strict";
import test, { mock } from "node:test";
import * as files from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { committedCredentialCleanupError, isCommittedCredentialCleanupFailure, withCredentialCleanup } from "./credential-cleanup.js";
import { createCredentialStore } from "./credential-store.js";
import { createCredentialAuthorityStore, profilePaths, readFallbackCredentials, saveFallbackCredentials, removeFallbackCredentials, type StoredCredentials } from "./profile-store.js";
import { getCustomer, refreshPersistenceMessages } from "./agent-client.js";
import { run } from "./cli.js";

void test("cleanup failure preserves completion but never upgrades failed updates", async () => {
  const failedCleanup = (): Promise<never> => Promise.reject(new Error("private cleanup"));
  await assert.rejects(withCredentialCleanup(() => Promise.resolve(1), failedCleanup), isCommittedCredentialCleanupFailure);
  await assert.rejects(withCredentialCleanup(() => Promise.reject(committedCredentialCleanupError()), failedCleanup), isCommittedCredentialCleanupFailure);
  const failure = new Error("precommit");
  await assert.rejects(withCredentialCleanup(() => Promise.reject(failure), failedCleanup), (error: unknown) =>
    error instanceof Error && !isCommittedCredentialCleanupFailure(error) && error.cause === failure);
  await assert.rejects(withCredentialCleanup(() => Promise.reject(failure), () => Promise.resolve()), (error: unknown) => error === failure);
  assert.equal(await withCredentialCleanup(() => Promise.resolve(1), () => Promise.resolve()), 1);
});

void test("synchronously throwing operations still release their storage lock", async () => {
  const failure = new Error("synchronous precommit failure");
  const cleanup = mock.fn(() => Promise.resolve());
  await assert.rejects(withCredentialCleanup(() => { throw failure; }, cleanup), (error: unknown) => error === failure);
  assert.equal(cleanup.mock.callCount(), 1);
});

await Promise.all(["auto", "file"].flatMap((mode) => ["login", "refresh"].map((operation) =>
  test(`${operation} retains ${mode} credentials after real storage-lock cleanup failure`, { skip: process.platform === "win32" }, async () => {
    const root = await files.mkdtemp(join(tmpdir(), "bizyeet-cleanup-"));
    const paths = profilePaths({}, root);
    const profile = { issuer: "https://example.test", clientId: "public-client" };
    const credentials: StoredCredentials = { profile, accessToken: "new-access-secret", refreshToken: "new-refresh-secret", scope: "customers.read", expiresAt: "2099-01-01" };
    const records = new Map<string, StoredCredentials>();
    const native = { read: (name: string): Promise<StoredCredentials | undefined> => Promise.resolve(records.get(name)),
      save: (name: string, value: StoredCredentials): Promise<void> => { records.set(name, value); return Promise.resolve(); },
      remove: (): Promise<void> => Promise.resolve() };
    const lockFailure = { ...files, rmdir: (): Promise<never> => Promise.reject(new Error("private lock cleanup")) };
    const fallback = { read: (): ReturnType<typeof readFallbackCredentials> => readFallbackCredentials(paths),
      save: (name: string, value: StoredCredentials): Promise<void> => saveFallbackCredentials(name, value, paths, lockFailure),
      remove: (name: string): Promise<void> => removeFallbackCredentials(name, paths) };
    const store = createCredentialStore(native, fallback, { mode: () => mode, authority: createCredentialAuthorityStore(paths, lockFailure) });
    const forbidden = (): Promise<never> => Promise.reject(new Error("Unexpected network action"));
    const revoke = mock.fn(forbidden);
    try {
      if (operation === "login") {
        const login = (): Promise<Readonly<{ profile: typeof profile; credentials: StoredCredentials }>> => Promise.resolve({ profile, credentials });
        const result = await run(["auth", "login", "--issuer", profile.issuer], {
          readCredentials: () => Promise.resolve({}), saveCredentials: store.save, removeCredentials: store.remove,
        }, { loginBrowser: login, loginDevice: login, revoke, getCustomer: forbidden, listCustomers: forbidden });
        assert.equal(result.exitCode, 1);
        assert.match(result.message, /saved and access was retained/u);
        assert.doesNotMatch(result.message, /new-access-secret|new-refresh-secret|private lock/u);
        assert.equal(revoke.mock.callCount(), 0);
      } else {
        const fetcher = mock.fn((url: string): Promise<Response> => {
          assert.equal(url, "https://example.test/token");
          return Promise.resolve(Response.json({ access_token: credentials.accessToken, refresh_token: credentials.refreshToken, token_type: "Bearer", expires_in: 300, scope: credentials.scope }));
        });
        await assert.rejects(getCustomer({ credentials: { ...credentials, expiresAt: new Date(0).toISOString() }, profile,
          persistCredentials: (value) => store.save("default", value), fetcher, now: () => 1000, resourceId: "customer-1",
          metadata: { authorization_endpoint: "https://example.test/authorize", token_endpoint: "https://example.test/token", revocation_endpoint: "https://example.test/revoke" },
        }), (error: unknown) => error instanceof Error && error.message === refreshPersistenceMessages.retained);
        assert.equal(fetcher.mock.callCount(), 1);
      }
      // Simulate explicit operator recovery of this test-owned abandoned lock.
      await files.rmdir(join(paths.directory, mode === "auto" ? ".credential-authority.lock" : ".credentials.lock"));
      const recovered = createCredentialStore(native, fallback, { mode: () => mode, authority: createCredentialAuthorityStore(paths) });
      assert.equal((await recovered.read()).default?.refreshToken, credentials.refreshToken);
    } finally { await files.rm(root, { recursive: true, force: true }); }
  }))));

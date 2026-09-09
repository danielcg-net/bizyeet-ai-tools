import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, chmod, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCredentialAuthorityStore, isCredentials, profilePaths, readFallbackCredentials, saveFallbackCredentials, removeFallbackCredentials, type CredentialAuthorityStore } from "./profile-store.js";
import { createCredentialStore } from "./credential-store.js";
import type { Keychain } from "./keychain.js";

const generation = "11111111-1111-4111-8111-111111111111";

[false, true].forEach((interruptCommit): void => {
  void test(`fresh instances recover the persisted fallback generation (interrupted commit: ${String(interruptCommit)})`, { skip: process.platform === "win32" }, async (): Promise<void> => {
    const root = await mkdtemp(join(tmpdir(), "bizyeet-authority-recovery-"));
    const paths = profilePaths({}, root);
    const persisted = createCredentialAuthorityStore(paths);
    const authority: CredentialAuthorityStore = { transaction: (operation) => persisted.transaction((session) => operation({
      read: session.read,
      write: (name, value) => interruptCommit && value.backend === "fallback"
        ? Promise.reject(new Error("Interrupted ownership commit")) : session.write(name, value),
    })) };
    const file: NonNullable<Parameters<typeof createCredentialStore>[1]> = { read: () => readFallbackCredentials(paths), save: (name, value) => saveFallbackCredentials(name, value, paths), remove: (name) => removeFallbackCredentials(name, paths) };
    const native: Keychain = { read: () => Promise.reject(new Error("Stale native record must not be used")), save: () => Promise.reject(new Error("No keyring backend is available.")), remove: () => Promise.resolve() };
    const credentials = { accessToken: "synthetic-new-access", refreshToken: "synthetic-new-refresh", scope: "customers.read", expiresAt: "2099-01-01", profile: { issuer: "https://new.example", clientId: "new-client" } };
    try {
      const save = createCredentialStore(native, file, { authority, platform: "linux" }).save("default", credentials);
      if (interruptCommit) await assert.rejects(save, /Interrupted ownership commit/u);
      else await save;
      const recoveredNative: Keychain = { ...native, read: () => Promise.resolve({ ...credentials, refreshToken: "stale-native-refresh" }) };
      const restored = createCredentialStore(recoveredNative, file, { authority: createCredentialAuthorityStore(paths), platform: "linux" });
      assert.equal((await restored.read()).default?.refreshToken, credentials.refreshToken);
      const source = await readFile(join(paths.directory, "credential-authority.json"), "utf8");
      assert.doesNotMatch(source, /synthetic|new\.example|new-client/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

void test("authority transactions persist token-free ownership and serialize independent profiles", { skip: process.platform === "win32" }, async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-authority-"));
  const paths = profilePaths({}, root);
  const path = join(paths.directory, "credential-authority.json");
  try {
    await Promise.all(["one", "two", "three"].map((name) => createCredentialAuthorityStore(paths).transaction(async (session): Promise<void> => {
      await session.write(name, { generation, backend: "pending" });
      await session.write(name, { generation, backend: "native" });
    })));
    const source = await readFile(path, "utf8");
    assert.deepEqual(JSON.parse(source) as unknown, Object.fromEntries(["one", "two", "three"].map((name) => [name, { generation, backend: "native" }])));
    assert.doesNotMatch(source, /accessToken|refreshToken|issuer|clientId/u);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await createCredentialAuthorityStore(paths).transaction(async (session): Promise<void> => {
      assert.deepEqual(await session.read("two"), { generation, backend: "native" });
    });
    await assert.rejects(stat(join(paths.directory, ".credential-authority.lock")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

void test("authority rejects unsafe or linked metadata before trusting ownership", { skip: process.platform === "win32" }, async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-authority-permissions-"));
  const paths = profilePaths({}, root);
  const path = join(paths.directory, "credential-authority.json");
  const authority = createCredentialAuthorityStore(paths);
  try {
    await authority.transaction((session) => session.write("default", { generation, backend: "fallback" }));
    await chmod(path, 0o644);
    await assert.rejects(authority.transaction((session) => session.read("default")), /permissions are unsafe/u);
    await rm(path);
    await symlink(join(root, "missing-target"), path);
    await assert.rejects(authority.transaction((session) => session.read("default")), /symbolic link/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

void test("interrupted ownership transactions keep their pending marker but release their lock", { skip: process.platform === "win32" }, async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-authority-interrupted-"));
  const paths = profilePaths({}, root);
  const authority = createCredentialAuthorityStore(paths);
  try {
    await assert.rejects(authority.transaction(async (session): Promise<void> => {
      await session.write("default", { generation, backend: "pending" });
      throw new Error("Interrupted");
    }), /Interrupted/u);
    await authority.transaction(async (session): Promise<void> => {
      assert.deepEqual(await session.read("default"), { generation, backend: "pending" });
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

void test("credential generations validate as UUIDv4 and legacy records remain readable", (): void => {
  const credentials = { accessToken: "synthetic", refreshToken: "synthetic", scope: "customers.read", expiresAt: "2099-01-01" };
  assert.equal(isCredentials(credentials), true);
  assert.equal(isCredentials({ ...credentials, storageGeneration: generation }), true);
  ["", "old", [], null, 42].forEach((storageGeneration): void => {
    assert.equal(isCredentials({ ...credentials, storageGeneration }), false);
  });
});

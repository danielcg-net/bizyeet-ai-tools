import assert from "node:assert/strict";
import * as fileSystem from "node:fs/promises";
import { mkdtemp, chmod as changeMode, link, mkdir, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { profileName, profilePaths, readFallbackCredentials, removeFallbackCredentials, requireFileCredentialSupport, saveFallbackCredentials, saveProfile } from "./profile-store.js";

const temporaryPaths = async (): Promise<ReturnType<typeof profilePaths>> =>
  profilePaths({}, await mkdtemp(join(tmpdir(), "bizyeet-cli-")));

void test("keeps profile metadata separate from owner-only fallback credentials", async (): Promise<void> => {
  const paths = await temporaryPaths();
  await saveProfile("default", { clientId: "public-client", issuer: "https://example.test" }, paths);
  const credentials = {
    accessToken: "access-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh-token",
    scope: "customers.read",
  };
  if (process.platform === "win32") {
    await assert.rejects(saveFallbackCredentials("default", credentials, paths), /native credential manager/u);
    await assert.rejects(stat(paths.credentials), { code: "ENOENT" });
    return;
  }
  await saveFallbackCredentials("default", credentials, paths);

  assert.deepEqual(await readFallbackCredentials(paths), {
    default: { accessToken: "access-token", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-token", scope: "customers.read" },
  });
});

void test("rejects an unsafe credential fallback file before reading its token material", async (): Promise<void> => {
  const paths = await temporaryPaths();
  await saveProfile("default", { clientId: "public-client", issuer: "https://example.test" }, paths);
  await writeFile(paths.credentials, "never parse this unsafe credential file", { mode: 0o600 });
  await changeMode(paths.credentials, 0o644);

  await assert.rejects(readFallbackCredentials(paths), /permissions are unsafe|native credential manager/u);
});

void test("fails closed for Windows plaintext fallback regardless of POSIX-looking mode bits", (): void => {
  assert.throws(() => { requireFileCredentialSupport("win32"); }, /native credential manager/u);
  assert.doesNotThrow(() => { requireFileCredentialSupport("linux"); });
  assert.doesNotThrow(() => { requireFileCredentialSupport("darwin"); });
});

void test("does not create a plaintext file while cleaning up an absent fallback profile", async (): Promise<void> => {
  const paths = await temporaryPaths();
  await removeFallbackCredentials("default", paths);
  await assert.rejects(stat(paths.credentials), { code: "ENOENT" });
});

void test("rejects path-like and uppercase profile names", (): void => {
  ["../other", "UPPER", "with space"].forEach((name) => {
    assert.throws(() => profileName(name));
  });
  assert.equal(profileName(undefined), "default");
});

void test("rejects symbolic links and multiply linked credential files", { skip: process.platform === "win32" }, async (): Promise<void> => {
  const paths = await temporaryPaths();
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const target = join(paths.directory, "original.json");
  await writeFile(target, "{}", { mode: 0o600 });
  await symlink(target, paths.credentials);
  await assert.rejects(readFallbackCredentials(paths), /must not be a symbolic link/u);
  await fileSystem.unlink(paths.credentials);
  await link(target, paths.credentials);
  await assert.rejects(readFallbackCredentials(paths), /permissions are unsafe/u);
});

void test("rejects a shared or symlinked fallback directory before reading or saving secrets", { skip: process.platform === "win32" }, async (): Promise<void> => {
  const paths = await temporaryPaths();
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await writeFile(paths.credentials, "{}", { mode: 0o600 });
  await changeMode(paths.directory, 0o755);
  await assert.rejects(readFallbackCredentials(paths), /directory is unsafe/u);
  await assert.rejects(saveFallbackCredentials("default", { accessToken: "synthetic", expiresAt: "2099-01-01", refreshToken: "synthetic", scope: "customers.read" }, paths), /directory is unsafe/u);
  await changeMode(paths.directory, 0o700);
  const moved = `${paths.directory}-original`;
  await rename(paths.directory, moved);
  await symlink(moved, paths.directory);
  await assert.rejects(readFallbackCredentials(paths), /directory is unsafe/u);
});

void test("validates and reads the same open file when its pathname is replaced", { skip: process.platform === "win32" }, async (): Promise<void> => {
  const paths = await temporaryPaths();
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await writeFile(paths.credentials, "{}", { mode: 0o600 });
  const operations = {
    ...fileSystem,
    open: async (...args: Parameters<typeof fileSystem.open>): ReturnType<typeof fileSystem.open> => {
      const handle = await fileSystem.open(...args);
      await rename(paths.credentials, `${paths.credentials}.original`);
      await writeFile(paths.credentials, "untrusted replacement", { mode: 0o644 });
      return handle;
    },
  };
  assert.deepEqual(await readFallbackCredentials(paths, operations), {});
  await assert.rejects(readFallbackCredentials(paths), /permissions are unsafe/u);
});

void test("rejects non-files and hides parser excerpts from malformed credential JSON", { skip: process.platform === "win32" }, async (): Promise<void> => {
  const paths = await temporaryPaths();
  await mkdir(paths.credentials, { recursive: true, mode: 0o700 });
  await assert.rejects(readFallbackCredentials(paths), /permissions are unsafe/u);
  await fileSystem.rmdir(paths.credentials);
  await writeFile(paths.credentials, "synthetic-refresh-token-not-json", { mode: 0o600 });
  await assert.rejects(readFallbackCredentials(paths), (error: unknown): boolean => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Stored BizYeet credentials are invalid.");
    assert.equal(error.cause, undefined);
    return true;
  });
});

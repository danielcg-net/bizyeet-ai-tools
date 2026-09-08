import assert from "node:assert/strict";
import { mkdtemp, chmod as changeMode, stat, writeFile } from "node:fs/promises";
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

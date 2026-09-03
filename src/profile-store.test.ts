import assert from "node:assert/strict";
import { mkdtemp, chmod as changeMode } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { profileName, profilePaths, readFallbackCredentials, saveFallbackCredentials, saveProfile } from "./profile-store.js";

const temporaryPaths = async (): Promise<ReturnType<typeof profilePaths>> =>
  profilePaths({}, await mkdtemp(join(tmpdir(), "bizyeet-cli-")));

void test("keeps profile metadata separate from owner-only fallback credentials", async (): Promise<void> => {
  const paths = await temporaryPaths();
  await saveProfile("default", { clientId: "public-client", issuer: "https://example.test" }, paths);
  await saveFallbackCredentials("default", {
    accessToken: "access-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh-token",
    scope: "customers.read",
  }, paths);

  assert.deepEqual(await readFallbackCredentials(paths), {
    default: { accessToken: "access-token", expiresAt: "2099-01-01T00:00:00.000Z", refreshToken: "refresh-token", scope: "customers.read" },
  });
});

void test("rejects an unsafe credential fallback file before reading its token material", async (): Promise<void> => {
  const paths = await temporaryPaths();
  await saveFallbackCredentials("default", {
    accessToken: "access-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh-token",
    scope: "customers.read",
  }, paths);
  await changeMode(paths.credentials, 0o644);

  await assert.rejects(readFallbackCredentials(paths), /permissions are unsafe/u);
});

void test("rejects path-like and uppercase profile names", (): void => {
  ["../other", "UPPER", "with space"].forEach((name) => {
    assert.throws(() => profileName(name));
  });
  assert.equal(profileName(undefined), "default");
});

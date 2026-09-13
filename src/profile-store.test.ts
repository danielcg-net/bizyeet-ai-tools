import assert from "node:assert/strict";
import * as fileSystem from "node:fs/promises";
import { mkdtemp, chmod as changeMode, link, mkdir, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createCredentialAuthorityStore, profileName, profilePaths, readFallbackCredentials, removeFallbackCredentials, requireFileCredentialSupport, saveFallbackCredentials, saveProfile } from "./profile-store.js";

const temporaryPaths = async (): Promise<ReturnType<typeof profilePaths>> =>
  profilePaths({}, await mkdtemp(join(tmpdir(), "bizyeet-cli-")));

void test("concurrent processes preserve independent credential saves and removals", { skip: process.platform === "win32", timeout: 15000 }, async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-lock-processes-"));
  const paths = profilePaths({}, root);
  const credentials = { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "customers.read" };
  const run = promisify(execFile);
  const moduleUrl = new URL("./profile-store.js", import.meta.url).href;
  const script = `const store = await import(process.argv[1]);
    const paths = store.profilePaths({}, process.argv[2]);
    const credentials = {accessToken:"synthetic-access",refreshToken:"synthetic-refresh",expiresAt:"2099-01-01",scope:"customers.read"};
    await (process.argv[3] === "remove" ? store.removeFallbackCredentials(process.argv[4],paths) : store.saveFallbackCredentials(process.argv[4],credentials,paths));`;
  try {
    await saveFallbackCredentials("remove-me", credentials, paths);
    await Promise.all(["one", "two", "three", "four"].map(async (name): Promise<void> => {
      await run(process.execPath, ["--input-type=module", "-e", script, moduleUrl, root, "save", name], { timeout: 10000 });
    }).concat(run(process.execPath, ["--input-type=module", "-e", script, moduleUrl, root, "remove", "remove-me"], { timeout: 10000 }).then((): void => undefined)));
    assert.deepEqual(Object.keys(await readFallbackCredentials(paths)).sort(), ["four", "one", "three", "two"]);
    assert.deepEqual(await fileSystem.readdir(paths.directory), ["credentials.json"]);
  } finally { await fileSystem.rm(root, { recursive: true, force: true }); }
});

void test("rejects empty and relative XDG roots instead of storing tokens beneath the workspace", (): void => {
  ["", ".", "./config", "relative/config", "../config"].forEach((value): void => {
    assert.throws(() => profilePaths({ XDG_CONFIG_HOME: value }), /nonempty absolute directory/u);
  });
  const absolute = join(tmpdir(), "trusted-config");
  assert.equal(profilePaths({ XDG_CONFIG_HOME: absolute }).directory, join(absolute, "bizyeet"));
  assert.equal(profilePaths({}, absolute).directory, join(absolute, ".config", "bizyeet"));
});

void test("does not remove an existing lock or overwrite credentials after bounded contention", { skip: process.platform === "win32", timeout: 10000 }, async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-existing-lock-"));
  const paths = profilePaths({}, root);
  const credentials = { accessToken: "synthetic-original", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "customers.read" };
  const lock = join(paths.directory, ".credentials.lock");
  try {
    await saveFallbackCredentials("default", credentials, paths);
    await mkdir(lock, { mode: 0o700 });
    await assert.rejects(saveFallbackCredentials("replacement", credentials, paths), /Credential store is busy/u);
    assert.ok((await stat(lock)).isDirectory());
    assert.deepEqual(await readFallbackCredentials(paths), { default: credentials });
  } finally { await fileSystem.rm(root, { recursive: true, force: true }); }
});

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

void test("successful atomic credential and authority writes need no temporary-path cleanup", { skip: process.platform === "win32" }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-renamed-credentials-"));
  const paths = profilePaths({}, root);
  const unlink = context.mock.fn(() => Promise.reject(new Error("Unnecessary post-commit cleanup")));
  const operations = { ...fileSystem, unlink };
  const value = { accessToken: "synthetic-new", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "customers.read" };
  try {
    await saveFallbackCredentials("default", value, paths, operations);
    assert.deepEqual((await readFallbackCredentials(paths)).default, value);
    const authority = createCredentialAuthorityStore(paths, operations);
    await authority.transaction((session) => session.write("default", { generation: "11111111-1111-4111-8111-111111111111", backend: "fallback" }));
    assert.deepEqual(await authority.transaction((session) => session.read("default")), { generation: "11111111-1111-4111-8111-111111111111", backend: "fallback" });
    assert.equal(unlink.mock.callCount(), 0);
    assert.deepEqual((await fileSystem.readdir(paths.directory)).sort(), ["credential-authority.json", "credentials.json"]);
  } finally { await fileSystem.rm(root, { recursive: true, force: true }); }
});

void test("cleans a partially written temporary credential file without replacing saved credentials", { skip: process.platform === "win32" }, async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-partial-credential-"));
  const paths = profilePaths({}, root);
  const original = { profile: { clientId: "original-client", issuer: "https://original.example" }, accessToken: "synthetic-original", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "customers.read" };
  try {
    await saveFallbackCredentials("default", original, paths);
    const operations = {
      ...fileSystem,
      open: async (path: string, flags: string | number, mode?: number): Promise<Pick<fileSystem.FileHandle, "stat" | "readFile" | "writeFile" | "chmod" | "close">> => {
        const handle = await fileSystem.open(path, flags, mode);
        if (flags !== "wx") return handle;
        return {
          stat: handle.stat.bind(handle), readFile: handle.readFile.bind(handle),
          chmod: handle.chmod.bind(handle), close: handle.close.bind(handle),
          writeFile: async (): Promise<void> => {
            await handle.writeFile("synthetic-partial-secret");
            throw new Error("Synthetic partial write failure");
          },
        };
      },
    };
    await assert.rejects(saveFallbackCredentials("default", { ...original, profile: { clientId: "replacement-client", issuer: "https://replacement.example" }, accessToken: "synthetic-new" }, paths, operations), /partial write failure/u);
    assert.deepEqual(await readFallbackCredentials(paths), { default: original });
    assert.deepEqual(await fileSystem.readdir(paths.directory), ["credentials.json"]);
  } finally {
    await fileSystem.rm(root, { recursive: true, force: true });
  }
});

void test("does not unlink a pre-existing temporary file when exclusive creation fails", async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-exclusive-profile-"));
  const paths = profilePaths({}, root);
  try {
    const operations = {
      ...fileSystem,
      open: async (path: string, flags: string | number, mode?: number): Promise<fileSystem.FileHandle> => {
        assert.equal(flags, "wx");
        assert.equal(mode, 0o600);
        await fileSystem.writeFile(path, "pre-existing synthetic file", { flag: "wx", mode: 0o600 });
        return fileSystem.open(path, flags, mode);
      },
    };
    await assert.rejects(saveProfile("default", { clientId: "public", issuer: "https://example.test" }, paths, operations), { code: "EEXIST" });
    const entries = await fileSystem.readdir(paths.directory);
    assert.equal(entries.length, 1);
    const temporaryName = entries[0];
    assert.ok(typeof temporaryName === "string" && temporaryName.endsWith(".tmp"));
    assert.equal(await fileSystem.readFile(join(paths.directory, temporaryName), "utf8"), "pre-existing synthetic file");
    await assert.rejects(stat(paths.profiles), { code: "ENOENT" });
  } finally {
    await fileSystem.rm(root, { recursive: true, force: true });
  }
});

["chmod", "close", "rename"].forEach((failure): void => {
  void test(`cleans owned temporary profiles after ${failure} failure and preserves the old file`, async (): Promise<void> => {
    const root = await mkdtemp(join(tmpdir(), "bizyeet-profile-failure-"));
    const paths = profilePaths({}, root);
    try {
      await saveProfile("default", { clientId: "original", issuer: "https://example.test" }, paths);
      const original = await fileSystem.readFile(paths.profiles, "utf8");
      const operations = {
        ...fileSystem,
        open: async (path: string, flags: string | number, mode?: number): Promise<Pick<fileSystem.FileHandle, "stat" | "readFile" | "writeFile" | "chmod" | "close">> => {
          const handle = await fileSystem.open(path, flags, mode);
          return {
            stat: handle.stat.bind(handle), readFile: handle.readFile.bind(handle), writeFile: handle.writeFile.bind(handle),
            chmod: async (permissions: number): Promise<void> => {
              if (failure === "chmod") throw new Error("Synthetic chmod failure");
              await handle.chmod(permissions);
            },
            close: async (): Promise<void> => {
              await handle.close();
              if (failure === "close") throw new Error("Synthetic close failure");
            },
          };
        },
        rename: async (before: string, after: string): Promise<void> => {
          if (failure === "rename") throw new Error("Synthetic rename failure");
          await rename(before, after);
        },
      };
      await assert.rejects(saveProfile("default", { clientId: "replacement", issuer: "https://example.test" }, paths, operations), { message: `Synthetic ${failure} failure` });
      assert.equal(await fileSystem.readFile(paths.profiles, "utf8"), original);
      assert.deepEqual(await fileSystem.readdir(paths.directory), ["profiles.json"]);
    } finally {
      await fileSystem.rm(root, { recursive: true, force: true });
    }
  });
});

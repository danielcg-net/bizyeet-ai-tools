import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rmdir, unlink, type FileHandle } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { withCredentialCleanup } from "./credential-cleanup.js";

export type StoredCredentials = Readonly<{
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  scope: string;
  /** Missing only for legacy records, which must never authorize network requests. */
  profile?: Profile;
  /** Local store transaction generation; never used as OAuth authority. */
  storageGeneration?: string;
}>;

export type CredentialAuthority = Readonly<{ generation: string; backend: "pending" | "native" | "fallback" | "removed" }>;
export type CredentialAuthoritySession = Readonly<{
  read: (name: string) => Promise<CredentialAuthority | undefined>;
  write: (name: string, authority: CredentialAuthority) => Promise<void>;
}>;
export type CredentialAuthorityStore = Readonly<{
  transaction: <T>(operation: (session: CredentialAuthoritySession) => Promise<T>) => Promise<T>;
}>;

export type Profile = Readonly<{ clientId: string; issuer: string; deviceGrantVerified?: boolean; deviceRegistrationVersion?: number }>;
export type ProfileCollection = Readonly<Record<string, Profile>>;
export type ProfileOperationOutcome<T> = Readonly<{ result: T; cleanupFailed: boolean }>;
export type CredentialCollection = Readonly<Record<string, StoredCredentials>>;

type FileOperations = Readonly<{
  mkdir: (path: string, options: Readonly<{ recursive: boolean; mode: number }>) => Promise<string | undefined>;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  lstat: typeof lstat;
  open: (path: string, flags: string | number, mode?: number) => Promise<Pick<FileHandle, "stat" | "readFile" | "writeFile" | "chmod" | "close">>;
  unlink: typeof unlink;
  rmdir: typeof rmdir;
}>;

const files: FileOperations = { lstat, mkdir, open, readFile, rename, rmdir, unlink };

/** POSIX mode bits cannot establish owner-only access on Windows. */
export const requireFileCredentialSupport = (platform: NodeJS.Platform = process.platform): void => {
  if (platform === "win32") throw new Error("Windows OAuth credentials require the native credential manager; plaintext fallback is unavailable.");
};
const profilePattern = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const emptyProfiles: ProfileCollection = Object.freeze({});
const generationPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const isAuthority = (value: unknown): value is CredentialAuthority => typeof value === "object" && value !== null
  && "generation" in value && typeof value.generation === "string" && generationPattern.test(value.generation)
  && "backend" in value && typeof value.backend === "string" && ["pending", "native", "fallback", "removed"].includes(value.backend);

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const isProfile = (value: unknown): value is Profile =>
  typeof value === "object" && value !== null
  && typeof (value as Record<string, unknown>).clientId === "string"
  && typeof (value as Record<string, unknown>).issuer === "string"
  && (!("deviceGrantVerified" in value) || typeof value.deviceGrantVerified === "boolean")
  && (!("deviceRegistrationVersion" in value) || (typeof value.deviceRegistrationVersion === "number"
    && Number.isSafeInteger(value.deviceRegistrationVersion) && value.deviceRegistrationVersion > 0));

/** Parses protected records, retaining legacy unbound entries only for replacement or local removal. */
export const isCredentials = (value: unknown): value is StoredCredentials =>
  typeof value === "object" && value !== null
  && typeof (value as Record<string, unknown>).accessToken === "string"
  && typeof (value as Record<string, unknown>).expiresAt === "string"
  && typeof (value as Record<string, unknown>).refreshToken === "string"
  && typeof (value as Record<string, unknown>).scope === "string"
  && (!("profile" in value) || isProfile(value.profile))
  && (!("storageGeneration" in value) || (typeof value.storageGeneration === "string" && generationPattern.test(value.storageGeneration)));

const parseStoredJson = (value: string): unknown => {
  try { return JSON.parse(value) as unknown; }
  catch { throw new Error("Stored BizYeet credentials are invalid."); }
};

const parseCollection = <T>(value: string, predicate: (item: unknown) => item is T): Readonly<Record<string, T>> => {
  const parsed = parseStoredJson(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Stored BizYeet credentials are invalid.");
  const entries = Object.entries(parsed);
  if (!entries.every(([name, item]) => profilePattern.test(name) && predicate(item))) throw new Error("Stored BizYeet credentials are invalid.");
  return Object.freeze(Object.fromEntries(entries));
};

const configDirectory = (environment: NodeJS.ProcessEnv, homeDirectory: string): string => {
  const configured = environment.XDG_CONFIG_HOME;
  if (configured !== undefined && (!configured || !isAbsolute(configured))) throw new Error("XDG_CONFIG_HOME must be a nonempty absolute directory.");
  return join(configured ?? join(homeDirectory, ".config"), "bizyeet");
};

export const profilePaths = (environment: NodeJS.ProcessEnv = process.env, homeDirectory: string = homedir()): Readonly<{
  credentials: string;
  directory: string;
  profiles: string;
}> => {
  const directory = configDirectory(environment, homeDirectory);
  return Object.freeze({ credentials: join(directory, "credentials.json"), directory, profiles: join(directory, "profiles.json") });
};

/** Validates a user-visible local profile name before using it as a lookup key. */
export const profileName = (value: string | undefined): string => {
  const normalized = value ?? "default";
  if (!profilePattern.test(normalized)) throw new Error("Profile names use lowercase letters, digits, and hyphens only.");
  return normalized;
};

const readCollection = async <T>(path: string, predicate: (item: unknown) => item is T, empty: Readonly<Record<string, T>>, operations: FileOperations): Promise<Readonly<Record<string, T>>> => {
  try {
    return parseCollection(await operations.readFile(path, "utf8"), predicate);
  } catch (error) {
    if (isMissing(error)) return empty;
    throw error;
  }
};

const assertPrivateDirectory = async (directory: string, operations: FileOperations): Promise<void> => {
  const metadata = await operations.lstat(directory);
  if (!metadata.isDirectory() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Credential fallback directory is unsafe; expected an owner-only directory with mode 0700.");
  }
};

const acquireCredentialLock = async (path: string, operations: FileOperations, remaining = 50): Promise<void> => {
  try { await operations.mkdir(path, { recursive: false, mode: 0o700 }); }
  catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error;
    if (remaining === 0) throw new Error("Credential store is busy; stop concurrent commands and retry. An abandoned .credentials.lock requires operator recovery.", { cause: error });
    await delay(100);
    return acquireCredentialLock(path, operations, remaining - 1);
  }
};

const withCredentialLock = async <T>(paths: ReturnType<typeof profilePaths>, operations: FileOperations, update: () => Promise<T>, lockName = ".credentials.lock"): Promise<T> => {
  await operations.mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await assertPrivateDirectory(paths.directory, operations);
  const lock = join(paths.directory, lockName);
  await acquireCredentialLock(lock, operations);
  return withCredentialCleanup(update, () => operations.rmdir(lock));
};

/** Serializes a complete CLI profile operation without nesting storage locks.
 * The lock contains no credentials; Windows credentials remain native-only.
 */
export const withProfileOperationLock = async <T>(name: string, operation: () => Promise<T>,
  environment: NodeJS.ProcessEnv = process.env, homeDirectory: string = homedir(), operations: FileOperations = files): Promise<ProfileOperationOutcome<T>> => {
  const profile = profileName(name);
  const paths = profilePaths(environment, homeDirectory);
  await operations.mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const directory = await operations.lstat(paths.directory);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Profile operation directory is unsafe.");
  if (process.platform !== "win32") await assertPrivateDirectory(paths.directory, operations);
  const lock = join(paths.directory, `.profile-${profile}.lock`);
  await acquireCredentialLock(lock, operations);
  const outcome = await Promise.resolve().then(operation).then(
    (value) => ({ ok: true, value } as const), (error: unknown) => ({ ok: false, error } as const),
  );
  try { await operations.rmdir(lock); }
  catch {
    if (outcome.ok) return { result: outcome.value, cleanupFailed: true };
    throw new Error("Profile operation and lock cleanup failed.", { cause: outcome.error });
  }
  if (!outcome.ok) throw outcome.error;
  return { result: outcome.value, cleanupFailed: false };
};

const writePrivateJson = async (path: string, value: unknown, operations: FileOperations, secret = false): Promise<void> => {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  await operations.mkdir(directory, { recursive: true, mode: 0o700 });
  if (secret) await assertPrivateDirectory(directory, operations);
  // Cleanup starts only after exclusive creation proves this operation owns the
  // temporary file. A failed open must never unlink a pre-existing path.
  const handle = await operations.open(temporaryPath, "wx", 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
      await handle.chmod(0o600);
    } finally { await handle.close(); }
    await operations.rename(temporaryPath, path);
    // A successful rename consumes the temporary path. Cleanup is only needed
    // before commit; post-commit unlink could misreport a completed save.
  } catch (error) {
    await operations.unlink(temporaryPath).catch((cleanupError: unknown) => { if (!isMissing(cleanupError)) throw cleanupError; });
    throw error;
  }
};

/** Reads legacy non-secret metadata. Never use this file to select OAuth token destinations. */
export const readProfiles = async (paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): Promise<ProfileCollection> =>
  readCollection(paths.profiles, isProfile, emptyProfiles, operations);

/** Legacy metadata helper; authentication exclusively uses the protected credential's profile binding. */
export const saveProfile = async (name: string, profile: Profile, paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): Promise<void> => {
  const profiles = await readProfiles(paths, operations);
  await writePrivateJson(paths.profiles, { ...profiles, [profileName(name)]: profile }, operations);
};

/** Reads protected credential or ownership records through the validated descriptor. */
const readPrivateCollection = async <T>(paths: ReturnType<typeof profilePaths>, predicate: (value: unknown) => value is T, operations: FileOperations): Promise<Readonly<Record<string, T>>> => {
  try {
    // Preserve absent-file cleanup on Windows, where plaintext is never allowed.
    await operations.lstat(paths.credentials);
    requireFileCredentialSupport();
    await assertPrivateDirectory(paths.directory, operations);
    const handle = await operations.open(paths.credentials, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.nlink !== 1 || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0) {
        throw new Error("Credential fallback file permissions are unsafe; expected an owner-only regular file with mode 0600.");
      }
      return parseCollection(await handle.readFile("utf8"), predicate);
    } finally { await handle.close(); }
  } catch (error) {
    if (isMissing(error)) return Object.freeze({});
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ELOOP") {
      throw new Error("Credential fallback file must not be a symbolic link.", { cause: error });
    }
    throw error;
  }
};

/** Reads the permission-checked headless fallback credential file. */
export const readFallbackCredentials = async (paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): Promise<CredentialCollection> =>
  readPrivateCollection(paths, isCredentials, operations);

/** Serializes POSIX store ownership transactions using protected, token-free metadata. */
export const createCredentialAuthorityStore = (paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): CredentialAuthorityStore => {
  const authorityPaths = { ...paths, credentials: join(paths.directory, "credential-authority.json") };
  const read = (): Promise<Readonly<Record<string, CredentialAuthority>>> => readPrivateCollection(authorityPaths, isAuthority, operations);
  return {
    transaction: <T>(operation: (session: CredentialAuthoritySession) => Promise<T>): Promise<T> =>
      withCredentialLock(paths, operations, () => operation({
        read: async (name): Promise<CredentialAuthority | undefined> => (await read())[profileName(name)],
        write: async (name, authority): Promise<void> => {
          const existing = await read();
          await writePrivateJson(authorityPaths.credentials, { ...existing, [profileName(name)]: authority }, operations, true);
        },
      }), ".credential-authority.lock"),
  };
};

/** Writes headless credentials atomically with owner-only permissions. */
export const saveFallbackCredentials = async (name: string, credentials: StoredCredentials, paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): Promise<void> => {
  requireFileCredentialSupport();
  await withCredentialLock(paths, operations, async (): Promise<void> => {
    const existing = await readFallbackCredentials(paths, operations);
    await writePrivateJson(paths.credentials, { ...existing, [profileName(name)]: credentials }, operations, true);
  });
};

/** Removes one profile's fallback credentials without changing any other profile. */
export const removeFallbackCredentials = async (name: string, paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): Promise<void> => {
  const normalized = profileName(name);
  try { await operations.lstat(paths.credentials); }
  catch (error) { if (isMissing(error)) return; throw error; }
  requireFileCredentialSupport();
  await withCredentialLock(paths, operations, async (): Promise<void> => {
    const existing = await readFallbackCredentials(paths, operations);
    if (!Object.hasOwn(existing, normalized)) return;
    const retained = Object.fromEntries(Object.entries(existing).filter(([key]) => key !== normalized));
    await writePrivateJson(paths.credentials, retained, operations, true);
  });
};

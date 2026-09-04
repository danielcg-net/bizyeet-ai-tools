import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type StoredCredentials = Readonly<{
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  scope: string;
}>;

export type Profile = Readonly<{ clientId: string; issuer: string }>;
export type ProfileCollection = Readonly<Record<string, Profile>>;
export type CredentialCollection = Readonly<Record<string, StoredCredentials>>;

type FileOperations = Readonly<{
  chmod: (path: string, mode: number) => Promise<void>;
  mkdir: (path: string, options: Readonly<{ recursive: true; mode: number }>) => Promise<string | undefined>;
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  stat: (path: string) => Promise<Readonly<{ mode: number }>>;
  writeFile: (path: string, data: string, options: Readonly<{ encoding: "utf8"; mode: number }>) => Promise<void>;
}>;

const files: FileOperations = { chmod, mkdir, readFile, rename, stat, writeFile };
const profilePattern = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const emptyProfiles: ProfileCollection = Object.freeze({});
const emptyCredentials: CredentialCollection = Object.freeze({});

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

const isProfile = (value: unknown): value is Profile =>
  typeof value === "object" && value !== null
  && typeof (value as Record<string, unknown>).clientId === "string"
  && typeof (value as Record<string, unknown>).issuer === "string";

const isCredentials = (value: unknown): value is StoredCredentials =>
  typeof value === "object" && value !== null
  && typeof (value as Record<string, unknown>).accessToken === "string"
  && typeof (value as Record<string, unknown>).expiresAt === "string"
  && typeof (value as Record<string, unknown>).refreshToken === "string"
  && typeof (value as Record<string, unknown>).scope === "string";

const parseCollection = <T>(value: string, predicate: (item: unknown) => item is T): Readonly<Record<string, T>> => {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Stored BizYeet credentials are invalid.");
  const entries = Object.entries(parsed);
  if (!entries.every(([name, item]) => profilePattern.test(name) && predicate(item))) throw new Error("Stored BizYeet credentials are invalid.");
  return Object.freeze(Object.fromEntries(entries));
};

const configDirectory = (environment: NodeJS.ProcessEnv, homeDirectory: string): string =>
  join(environment.XDG_CONFIG_HOME ?? join(homeDirectory, ".config"), "bizyeet");

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

const writePrivateJson = async (path: string, value: unknown, operations: FileOperations): Promise<void> => {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  await operations.mkdir(directory, { recursive: true, mode: 0o700 });
  await operations.writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await operations.chmod(temporaryPath, 0o600);
  await operations.rename(temporaryPath, path);
  await operations.chmod(path, 0o600);
};

/** Reads non-secret profile metadata. Profiles deliberately never contain an OAuth token. */
export const readProfiles = async (paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): Promise<ProfileCollection> =>
  readCollection(paths.profiles, isProfile, emptyProfiles, operations);

/** Persists public issuer/client metadata separately from refresh credentials. */
export const saveProfile = async (name: string, profile: Profile, paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): Promise<void> => {
  const profiles = await readProfiles(paths, operations);
  await writePrivateJson(paths.profiles, { ...profiles, [profileName(name)]: profile }, operations);
};

/** Reads the permission-checked headless fallback credential file. */
export const readFallbackCredentials = async (paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): Promise<CredentialCollection> => {
  try {
    const metadata = await operations.stat(paths.credentials);
    if ((metadata.mode & 0o077) !== 0) throw new Error("Credential fallback file permissions are unsafe; expected mode 0600.");
    return parseCollection(await operations.readFile(paths.credentials, "utf8"), isCredentials);
  } catch (error) {
    if (isMissing(error)) return emptyCredentials;
    throw error;
  }
};

/** Writes headless credentials atomically with owner-only permissions. */
export const saveFallbackCredentials = async (name: string, credentials: StoredCredentials, paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): Promise<void> => {
  const existing = await readFallbackCredentials(paths, operations);
  await writePrivateJson(paths.credentials, { ...existing, [profileName(name)]: credentials }, operations);
};

/** Removes one profile's fallback credentials without changing any other profile. */
export const removeFallbackCredentials = async (name: string, paths: ReturnType<typeof profilePaths> = profilePaths(), operations: FileOperations = files): Promise<void> => {
  const normalized = profileName(name);
  const existing = await readFallbackCredentials(paths, operations);
  const retained = Object.fromEntries(Object.entries(existing).filter(([key]) => key !== normalized));
  await writePrivateJson(paths.credentials, retained, operations);
};

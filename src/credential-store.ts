import { nativeKeychain, type Keychain } from "./keychain.js";
import { randomUUID } from "node:crypto";
import { committedCredentialCleanupError, isCommittedCredentialCleanupFailure, uncertainCredentialPersistenceError } from "./credential-cleanup.js";
export { isCommittedCredentialCleanupFailure } from "./credential-cleanup.js";
import { createCredentialAuthorityStore, profileName, readFallbackCredentials, removeFallbackCredentials, requireFileCredentialSupport, saveFallbackCredentials, type CredentialAuthoritySession, type CredentialAuthorityStore, type CredentialCollection, type StoredCredentials } from "./profile-store.js";

export type CredentialStore = Readonly<{
  read: (profile?: string) => Promise<CredentialCollection>;
  remove: (profile: string) => Promise<void>;
  save: (profile: string, credentials: StoredCredentials) => Promise<void>;
}>;

type FallbackStore = Readonly<{
  read: () => Promise<CredentialCollection>;
  remove: (profile: string) => Promise<void>;
  save: (profile: string, credentials: StoredCredentials) => Promise<void>;
}>;

const fallback: FallbackStore = {
  read: readFallbackCredentials,
  remove: removeFallbackCredentials,
  save: saveFallbackCredentials,
};

type StoreOptions = Readonly<{ mode?: () => string | undefined; platform?: NodeJS.Platform; authority?: CredentialAuthorityStore }>;

const explicitlyUsesFile = (options: StoreOptions): boolean => {
  const mode = options.mode?.();
  if (mode === undefined || mode === "auto") return false;
  if (mode !== "file") throw new Error("BIZYEET_CREDENTIAL_STORE must be auto or file.");
  requireFileCredentialSupport(options.platform);
  return true;
};

const unavailableKeychain = (error: unknown): boolean =>
  error instanceof Error
  // Only an explicit unavailable-backend result permits a downgrade. The word
  // "keyring" alone also occurs in denied, ambiguous and corrupt-store errors.
  && /^(?:no (?:keyring|credential) backend is available|(?:keyring|credential) (?:backend|service|store) is (?:unavailable|not supported))\.?$/iu.test(error.message);

const keychainOrFallback = async <T>(keychainOperation: () => Promise<T>, fallbackOperation: () => Promise<T>): Promise<T> => {
  try {
    return await keychainOperation();
  } catch (error) {
    if (unavailableKeychain(error)) return fallbackOperation();
    throw error;
  }
};

const selected = (profile: string, value: StoredCredentials | undefined): CredentialCollection => value ? { [profile]: value } : {};
const sameCredentials = (left: StoredCredentials, right: StoredCredentials): boolean => JSON.stringify(left) === JSON.stringify(right);
const authorityStore = (options: StoreOptions): CredentialAuthorityStore => options.authority ?? createCredentialAuthorityStore();
const cleanObsoleteFallback = async (store: FallbackStore, name: string): Promise<void> => {
  try { await store.remove(name); }
  catch { throw committedCredentialCleanupError(); }
};

const hasRecoverableWrite = async (session: CredentialAuthoritySession, native: Keychain, file: FallbackStore, name: string, expected: StoredCredentials): Promise<boolean> => {
  // Inspect under the existing authority lock, never through a nested public read.
  const [authority, nativeRead, fileRead] = await Promise.allSettled([
    Promise.resolve().then(() => session.read(name)),
    Promise.resolve().then(() => keychainOrFallback(() => native.read(name), () => Promise.resolve(undefined))),
    Promise.resolve().then(() => file.read()),
  ]);
  if (authority.status !== "fulfilled" || authority.value === undefined || authority.value.generation !== expected.storageGeneration || authority.value.backend === "removed") return false;
  const matches = (value: StoredCredentials | undefined): boolean => value !== undefined && value.storageGeneration === expected.storageGeneration && sameCredentials(value, expected);
  if (authority.value.backend === "native") return nativeRead.status === "fulfilled" && matches(nativeRead.value);
  if (authority.value.backend === "fallback") return fileRead.status === "fulfilled" && matches(fileRead.value[name]);
  if (nativeRead.status !== "fulfilled" || fileRead.status !== "fulfilled") return false;
  const candidates = [nativeRead.value, fileRead.value[name]].filter((value) => value?.storageGeneration === expected.storageGeneration);
  return candidates.length > 0 && candidates.every((value) => value !== undefined && sameCredentials(value, expected));
};

/** Persist ownership before writing credentials; recovered stores cannot revive older generations. */
export const createCredentialStore = (keychain: Keychain = nativeKeychain, fallbackStore: FallbackStore = fallback, options: StoreOptions = {}): CredentialStore => ({
  read: async (profile = "default"): Promise<CredentialCollection> => {
    if (explicitlyUsesFile(options)) return fallbackStore.read();
    const name = profileName(profile);
    if ((options.platform ?? process.platform) === "win32") {
      return selected(name, await keychainOrFallback(() => keychain.read(name), () => {
        requireFileCredentialSupport("win32");
        return Promise.resolve(undefined);
      }));
    }
    return authorityStore(options).transaction(async (session): Promise<CredentialCollection> => {
      const authority = await session.read(name);
      if (authority?.backend === "removed") return {};
      if (authority?.backend === "fallback") {
        const stored = (await fallbackStore.read())[name];
        return selected(name, stored?.storageGeneration === authority.generation ? stored : undefined);
      }
      if (authority?.backend === "native") {
        const stored = await keychain.read(name);
        return selected(name, stored?.storageGeneration === authority.generation ? stored : undefined);
      }
      const native = await keychainOrFallback(
        async () => ({ stored: await keychain.read(name), unavailable: false }),
        () => Promise.resolve({ stored: undefined, unavailable: true }),
      );
      const file = (await fallbackStore.read())[name];
      if (authority?.backend === "pending") {
        const nativeMatches = native.stored?.storageGeneration === authority.generation ? native.stored : undefined;
        const fileMatches = file?.storageGeneration === authority.generation ? file : undefined;
        if (nativeMatches && fileMatches && !sameCredentials(nativeMatches, fileMatches)) return {};
        return selected(name, nativeMatches ?? fileMatches);
      }
      // Legacy stores have no ordering proof. Conflicting or inaccessible
      // records require re-login (or the operator's explicit file-mode choice).
      if (native.stored?.storageGeneration || file?.storageGeneration || (native.unavailable && file)) return {};
      if (native.stored && file && !sameCredentials(native.stored, file)) return {};
      return selected(name, native.stored ?? file);
    });
  },
  remove: async (profile): Promise<void> => {
    if (explicitlyUsesFile(options)) return fallbackStore.remove(profile);
    const name = profileName(profile);
    if ((options.platform ?? process.platform) === "win32") {
      await keychain.remove(name);
      return fallbackStore.remove(name);
    }
    await authorityStore(options).transaction(async (session): Promise<void> => {
      // Unavailable native deletion is not proof of absence, even when reads
      // currently select the fallback. Keep the failure visible to logout.
      await keychain.remove(name);
      await fallbackStore.remove(name);
      await session.write(name, { backend: "removed", generation: randomUUID() });
    });
  },
  save: async (profile, credentials): Promise<void> => {
    if (explicitlyUsesFile(options)) return fallbackStore.save(profile, credentials);
    const name = profileName(profile);
    if ((options.platform ?? process.platform) === "win32") {
      await keychain.save(name, credentials);
      return cleanObsoleteFallback(fallbackStore, name);
    }
    await authorityStore(options).transaction(async (session): Promise<void> => {
      const generation = randomUUID();
      const stored = { ...credentials, storageGeneration: generation };
      await session.write(name, { backend: "pending", generation });
      try {
        const storedSecurely = await keychainOrFallback(
          async () => {
            await keychain.save(name, stored);
            return true;
          },
          () => Promise.resolve(false),
        );
        if (!storedSecurely) await fallbackStore.save(name, stored);
        await session.write(name, { backend: storedSecurely ? "native" : "fallback", generation });
        if (storedSecurely) await cleanObsoleteFallback(fallbackStore, name);
      } catch (error) {
        if (isCommittedCredentialCleanupFailure(error)) throw error;
        if (await hasRecoverableWrite(session, keychain, fallbackStore, name, stored)) throw committedCredentialCleanupError();
        // Compensating revocation is safe only after this generation can no
        // longer be selected, including when its verification read was transient.
        try { await session.write(name, { backend: "removed", generation }); }
        catch { throw uncertainCredentialPersistenceError(); }
        throw error;
      }
    });
  },
});

export const credentialStore = createCredentialStore(nativeKeychain, fallback, { mode: () => process.env.BIZYEET_CREDENTIAL_STORE });

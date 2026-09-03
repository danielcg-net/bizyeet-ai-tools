import { nativeKeychain, type Keychain } from "./keychain.js";
import { readFallbackCredentials, removeFallbackCredentials, saveFallbackCredentials, type CredentialCollection, type StoredCredentials } from "./profile-store.js";

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

const unavailableKeychain = (error: unknown): boolean =>
  error instanceof Error && /backend|keyring|not supported|unavailable/u.test(error.message);

const keychainOrFallback = async <T>(keychainOperation: () => Promise<T>, fallbackOperation: () => Promise<T>): Promise<T> => {
  try {
    return await keychainOperation();
  } catch (error) {
    if (unavailableKeychain(error)) return fallbackOperation();
    throw error;
  }
};

/** Prefers the OS credential store, with the owner-only file used only when no secure service is available. */
export const createCredentialStore = (keychain: Keychain = nativeKeychain, fallbackStore: FallbackStore = fallback): CredentialStore => ({
  read: async (profile = "default"): Promise<CredentialCollection> => {
    const stored = await keychainOrFallback(() => keychain.read(profile), () => Promise.resolve(undefined));
    return stored === undefined ? fallbackStore.read() : { [profile]: stored };
  },
  remove: async (profile): Promise<void> => {
    await keychainOrFallback(() => keychain.remove(profile), () => Promise.resolve());
    await fallbackStore.remove(profile);
  },
  save: async (profile, credentials): Promise<void> => {
    const storedSecurely = await keychainOrFallback(
      async () => {
        await keychain.save(profile, credentials);
        return true;
      },
      () => Promise.resolve(false),
    );
    if (storedSecurely) await fallbackStore.remove(profile);
    else await fallbackStore.save(profile, credentials);
  },
});

export const credentialStore = createCredentialStore();

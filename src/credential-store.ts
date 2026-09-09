import { nativeKeychain, type Keychain } from "./keychain.js";
import { readFallbackCredentials, removeFallbackCredentials, requireFileCredentialSupport, saveFallbackCredentials, type CredentialCollection, type StoredCredentials } from "./profile-store.js";

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

type StoreOptions = Readonly<{ mode?: () => string | undefined; platform?: NodeJS.Platform }>;

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

/** Prefer native storage; file mode is an explicit operator choice, never inferred from denied access. */
export const createCredentialStore = (keychain: Keychain = nativeKeychain, fallbackStore: FallbackStore = fallback, options: StoreOptions = {}): CredentialStore => ({
  read: async (profile = "default"): Promise<CredentialCollection> => {
    if (explicitlyUsesFile(options)) return fallbackStore.read();
    const stored = await keychainOrFallback(() => keychain.read(profile), () => {
      requireFileCredentialSupport(options.platform);
      return Promise.resolve(undefined);
    });
    return stored === undefined ? fallbackStore.read() : { [profile]: stored };
  },
  remove: async (profile): Promise<void> => {
    if (explicitlyUsesFile(options)) return fallbackStore.remove(profile);
    await keychainOrFallback(() => keychain.remove(profile), () => Promise.resolve());
    await fallbackStore.remove(profile);
  },
  save: async (profile, credentials): Promise<void> => {
    if (explicitlyUsesFile(options)) return fallbackStore.save(profile, credentials);
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

export const credentialStore = createCredentialStore(nativeKeychain, fallback, { mode: () => process.env.BIZYEET_CREDENTIAL_STORE });

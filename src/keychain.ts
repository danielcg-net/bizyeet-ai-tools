import { AsyncEntry } from "@napi-rs/keyring";

import type { StoredCredentials } from "./profile-store.js";

const service = "net.bizyeet.ai-tools.oauth";

export type Keychain = Readonly<{
  read: (profile: string) => Promise<StoredCredentials | undefined>;
  remove: (profile: string) => Promise<void>;
  save: (profile: string, credentials: StoredCredentials) => Promise<void>;
}>;

type NativeEntry = Readonly<{
  deleteCredential: () => Promise<unknown>;
  getPassword: () => Promise<unknown>;
  setPassword: (password: string) => Promise<unknown>;
}>;

const isCredentials = (value: unknown): value is StoredCredentials =>
  typeof value === "object" && value !== null
  && typeof (value as Record<string, unknown>).accessToken === "string"
  && typeof (value as Record<string, unknown>).expiresAt === "string"
  && typeof (value as Record<string, unknown>).refreshToken === "string"
  && typeof (value as Record<string, unknown>).scope === "string";

const parseCredentials = (value: string): StoredCredentials => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isCredentials(parsed)) throw new Error("Stored BizYeet credentials are invalid.");
    return parsed;
  } catch {
    throw new Error("Stored BizYeet credentials are invalid.");
  }
};

/** Adapts a native credential entry without sending OAuth tokens to a shell or process arguments. */
export const createKeychain = (entryFor: (profile: string) => NativeEntry): Keychain => ({
  read: async (profile): Promise<StoredCredentials | undefined> => {
    const stored = await entryFor(profile).getPassword();
    return typeof stored !== "string" || stored === "" ? undefined : parseCredentials(stored);
  },
  remove: async (profile): Promise<void> => {
    await entryFor(profile).deleteCredential();
  },
  save: async (profile, credentials): Promise<void> => {
    await entryFor(profile).setPassword(JSON.stringify(credentials));
  },
});

/** Uses the native OS credential service without sending OAuth tokens to a shell or process arguments. */
export const nativeKeychain = createKeychain((profile) => new AsyncEntry(service, profile));

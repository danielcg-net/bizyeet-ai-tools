import { AsyncEntry } from "@napi-rs/keyring";

import type { StoredCredentials } from "./profile-store.js";

const service = "net.bizyeet.ai-tools.oauth";

export type Keychain = Readonly<{
  read: (profile: string) => Promise<StoredCredentials | undefined>;
  remove: (profile: string) => Promise<void>;
  save: (profile: string, credentials: StoredCredentials) => Promise<void>;
}>;

const isCredentials = (value: unknown): value is StoredCredentials =>
  typeof value === "object" && value !== null
  && typeof (value as Record<string, unknown>).accessToken === "string"
  && typeof (value as Record<string, unknown>).expiresAt === "string"
  && typeof (value as Record<string, unknown>).refreshToken === "string"
  && typeof (value as Record<string, unknown>).scope === "string";

const parseCredentials = (value: string): StoredCredentials => {
  const parsed: unknown = JSON.parse(value);
  if (!isCredentials(parsed)) throw new Error("Stored BizYeet credentials are invalid.");
  return parsed;
};

/** Uses the native OS credential service without sending OAuth tokens to a shell or process arguments. */
export const nativeKeychain: Keychain = {
  read: async (profile) => {
    const stored = await new AsyncEntry(service, profile).getPassword();
    return typeof stored !== "string" || stored === "" ? undefined : parseCredentials(stored);
  },
  remove: async (profile) => {
    await new AsyncEntry(service, profile).deleteCredential();
  },
  save: async (profile, credentials) => new AsyncEntry(service, profile).setPassword(JSON.stringify(credentials)),
};

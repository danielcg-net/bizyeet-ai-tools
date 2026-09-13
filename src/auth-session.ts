import {
  authorizationUrl,
  createPkce,
  discoverOAuth,
  exchangeAuthorizationCode,
  exchangeDeviceCode,
  issuerOrigin,
  registerPublicClient,
  requestDeviceAuthorization,
  validRefreshToken,
  canonicalRegistrationScope,
  type DeviceAuthorization,
  type FetchLike,
  type OAuthTokenSet,
} from "./oauth.js";
import { openLoopbackCallback, type LoopbackCallback } from "./loopback.js";
import type { Profile, StoredCredentials } from "./profile-store.js";

const deviceRedirectUri = "http://127.0.0.1:49152/callback";

export type DeviceLoginResult = Readonly<{
  credentials: StoredCredentials;
  profile: Profile;
}>;

type DeviceLoginDependencies = Readonly<{
  fetcher: FetchLike;
  now: () => number;
  onVerification: (device: DeviceAuthorization) => void;
}>;

type BrowserLoginDependencies = Readonly<{
  fetcher: FetchLike;
  launchBrowser: (url: string) => Promise<void>;
  now: () => number;
  openCallback: (state: string, issuer: string) => Promise<LoopbackCallback>;
}>;

const credentialsFrom = (tokens: OAuthTokenSet, now: () => number, profile: Profile, requestedScope: string): StoredCredentials => {
  if (!validRefreshToken(tokens.refresh_token)) {
    throw new Error("The authorization server did not issue a usable refresh token. Persistent login was not completed.");
  }
  return {
  profile,
  accessToken: tokens.access_token,
  expiresAt: new Date(now() + tokens.expires_in * 1000).toISOString(),
  refreshToken: tokens.refresh_token,
  scope: tokens.scope ?? requestedScope,
  };
};

/** Completes an OAuth-only device login and returns secret-bearing credentials only to the local storage boundary. */
export const loginWithDevice = async (input: Readonly<{
  clientId?: string;
  deviceRegistrationVersion?: number;
  registeredScope?: string;
  issuer: string;
  scope: string;
}>, dependencies: DeviceLoginDependencies): Promise<DeviceLoginResult> => {
  const issuer = issuerOrigin(input.issuer);
  const metadata = await discoverOAuth(issuer, dependencies.fetcher);
  const requestedScope = canonicalRegistrationScope(input.scope);
  if (requestedScope === null) throw new Error("Invalid OAuth registration scope.");
  const verifiedClientId = input.deviceRegistrationVersion === 2
    && canonicalRegistrationScope(input.registeredScope) === requestedScope ? input.clientId : undefined;
  const clientId = verifiedClientId ?? (await registerPublicClient({ fetcher: dependencies.fetcher, metadata, redirectUri: deviceRedirectUri, deviceGrant: true, scope: input.scope })).clientId;
  const device = await requestDeviceAuthorization({ clientId, fetcher: dependencies.fetcher, metadata, resource: issuer, scope: input.scope });
  dependencies.onVerification(device);
  const tokens = await exchangeDeviceCode({ clientId, device, fetcher: dependencies.fetcher, metadata, resource: issuer });
  const profile: Profile = { clientId, issuer: issuer.origin, deviceGrantVerified: true, deviceRegistrationVersion: 2, registeredScope: requestedScope };
  return {
    credentials: credentialsFrom(tokens, dependencies.now, profile, input.scope),
    profile,
  };
};

/** Completes browser OAuth authorization-code login with a fresh PKCE S256 proof and exact loopback callback. */
export const loginWithBrowser = async (input: Readonly<{
  issuer: string;
  scope: string;
}>, dependencies: BrowserLoginDependencies): Promise<DeviceLoginResult> => {
  const issuer = issuerOrigin(input.issuer);
  const metadata = await discoverOAuth(issuer, dependencies.fetcher);
  const state = crypto.randomUUID();
  const callback = await dependencies.openCallback(state, issuer.origin);
  const prepared = await (async (): Promise<Readonly<{ clientId: string; pkce: ReturnType<typeof createPkce> }>> => {
    try {
      const clientId = (await registerPublicClient({ fetcher: dependencies.fetcher, metadata, redirectUri: callback.redirectUri, scope: input.scope })).clientId;
      const pkce = createPkce();
      await dependencies.launchBrowser(authorizationUrl({ clientId, metadata, pkce, redirectUri: callback.redirectUri, resource: issuer, scope: input.scope, state }));
      return { clientId, pkce };
    } catch (error) {
      await callback.close();
      throw error;
    }
  })();
  const { clientId, pkce } = prepared;
  const code = await callback.awaitCode();
  const tokens = await exchangeAuthorizationCode({ clientId, code, fetcher: dependencies.fetcher, metadata, redirectUri: callback.redirectUri, resource: issuer, verifier: pkce.verifier });
  return {
    credentials: credentialsFrom(tokens, dependencies.now, { clientId, issuer: issuer.origin }, input.scope),
    profile: { clientId, issuer: issuer.origin },
  };
};

export const defaultBrowserDependencies = (): BrowserLoginDependencies => ({
  fetcher: fetch,
  launchBrowser: () => Promise.reject(new Error("No browser launcher is configured.")),
  now: Date.now,
  openCallback: openLoopbackCallback,
});

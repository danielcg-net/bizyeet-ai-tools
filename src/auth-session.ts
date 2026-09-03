import {
  discoverOAuth,
  exchangeDeviceCode,
  issuerOrigin,
  registerPublicClient,
  requestDeviceAuthorization,
  type DeviceAuthorization,
  type FetchLike,
  type OAuthTokenSet,
} from "./oauth.js";
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

const credentialsFrom = (tokens: OAuthTokenSet, now: () => number): StoredCredentials => ({
  accessToken: tokens.access_token,
  expiresAt: new Date(now() + tokens.expires_in * 1000).toISOString(),
  refreshToken: tokens.refresh_token ?? "",
  scope: tokens.scope ?? "",
});

/** Completes an OAuth-only device login and returns secret-bearing credentials only to the local storage boundary. */
export const loginWithDevice = async (input: Readonly<{
  clientId?: string;
  issuer: string;
  scope: string;
}>, dependencies: DeviceLoginDependencies): Promise<DeviceLoginResult> => {
  const issuer = issuerOrigin(input.issuer);
  const metadata = await discoverOAuth(issuer, dependencies.fetcher);
  const clientId = input.clientId ?? (await registerPublicClient({ fetcher: dependencies.fetcher, metadata, redirectUri: deviceRedirectUri })).clientId;
  const device = await requestDeviceAuthorization({ clientId, fetcher: dependencies.fetcher, metadata, resource: issuer, scope: input.scope });
  dependencies.onVerification(device);
  const tokens = await exchangeDeviceCode({ clientId, device, fetcher: dependencies.fetcher, metadata, resource: issuer });
  return {
    credentials: credentialsFrom(tokens, dependencies.now),
    profile: { clientId, issuer: issuer.origin },
  };
};

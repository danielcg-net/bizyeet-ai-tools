import { createHash, randomBytes } from "node:crypto";

export type OAuthMetadata = Readonly<{
  authorization_endpoint: string;
  device_authorization_endpoint?: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  token_endpoint: string;
  code_challenge_methods_supported?: readonly string[];
}>;

export type OAuthTokenSet = Readonly<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: "Bearer";
}>;

export type DeviceAuthorization = Readonly<{
  deviceCode: string;
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
}>;

type DeviceAuthorizationResponse = Readonly<{
  device_code: string;
  expires_in: number;
  interval: number;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
}>;

export type PkcePair = Readonly<{ challenge: string; verifier: string }>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const oauthMetadataPath = "/.well-known/oauth-authorization-server";
const requiredMetadataKeys = ["authorization_endpoint", "token_endpoint"] as const;

const base64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const isAbsoluteHttpsUrl = (value: unknown, issuer: URL): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === issuer.origin;
  } catch {
    return false;
  }
};

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isOAuthMetadata = (value: unknown, issuer: URL): value is OAuthMetadata => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return requiredMetadataKeys.every((key) => isAbsoluteHttpsUrl(candidate[key], issuer))
    && (candidate.device_authorization_endpoint === undefined || isAbsoluteHttpsUrl(candidate.device_authorization_endpoint, issuer))
    && (candidate.registration_endpoint === undefined || isAbsoluteHttpsUrl(candidate.registration_endpoint, issuer))
    && (candidate.revocation_endpoint === undefined || isAbsoluteHttpsUrl(candidate.revocation_endpoint, issuer))
    && (candidate.code_challenge_methods_supported === undefined || isStringArray(candidate.code_challenge_methods_supported));
};

const isTokenSet = (value: unknown): value is OAuthTokenSet => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.access_token === "string"
    && typeof candidate.expires_in === "number"
    && Number.isFinite(candidate.expires_in)
    && candidate.expires_in > 0
    && candidate.token_type === "Bearer"
    && (candidate.refresh_token === undefined || typeof candidate.refresh_token === "string")
    && (candidate.scope === undefined || typeof candidate.scope === "string");
};

const isDeviceAuthorization = (value: unknown): value is DeviceAuthorizationResponse => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.device_code === "string"
    && typeof candidate.user_code === "string"
    && typeof candidate.verification_uri === "string"
    && typeof candidate.expires_in === "number"
    && Number.isFinite(candidate.expires_in)
    && candidate.expires_in > 0
    && typeof candidate.interval === "number"
    && Number.isFinite(candidate.interval)
    && candidate.interval > 0
    && (candidate.verification_uri_complete === undefined || typeof candidate.verification_uri_complete === "string");
};

/** Validates a user-supplied authorization-server origin without retaining path or credentials. */
export const issuerOrigin = (value: string): URL => {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Issuer must be an HTTPS origin without credentials or a path.");
  }
  return parsed;
};

/** Creates an RFC 7636 S256 verifier and challenge for one browser authorization attempt. */
export const createPkce = (): PkcePair => {
  const verifier = base64Url(randomBytes(48));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

/** Retrieves only same-origin OAuth metadata and rejects a server that does not advertise PKCE S256. */
export const discoverOAuth = async (issuer: URL, fetcher: FetchLike): Promise<OAuthMetadata> => {
  const response = await fetcher(new URL(oauthMetadataPath, issuer).toString(), { headers: { Accept: "application/json" } });
  const metadata: unknown = await response.json().catch(() => null);
  if (!response.ok || !isOAuthMetadata(metadata, issuer) || !metadata.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("The authorization server does not provide compatible OAuth PKCE metadata.");
  }
  return metadata;
};

/** Builds a browser authorization URL whose state, resource, and PKCE proof are caller-bound. */
export const authorizationUrl = (input: Readonly<{
  clientId: string;
  metadata: OAuthMetadata;
  pkce: PkcePair;
  redirectUri: string;
  resource: URL;
  scope: string;
  state: string;
}>): string => {
  const parameters = new URLSearchParams({
    client_id: input.clientId,
    code_challenge: input.pkce.challenge,
    code_challenge_method: "S256",
    redirect_uri: input.redirectUri,
    resource: input.resource.origin,
    response_type: "code",
    scope: input.scope,
    state: input.state,
  });
  return new URL(`?${parameters.toString()}`, input.metadata.authorization_endpoint).toString();
};

const formRequest = (parameters: Readonly<Record<string, string>>): RequestInit => ({
  body: new URLSearchParams(parameters),
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  method: "POST",
});

/** Exchanges a one-time authorization code without logging or returning raw token values to command output. */
export const exchangeAuthorizationCode = async (input: Readonly<{
  clientId: string;
  code: string;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  redirectUri: string;
  resource: URL;
  verifier: string;
}>): Promise<OAuthTokenSet> => {
  const response = await input.fetcher(input.metadata.token_endpoint, formRequest({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.verifier,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    resource: input.resource.origin,
  }));
  const tokens: unknown = await response.json().catch(() => null);
  if (!response.ok || !isTokenSet(tokens)) throw new Error("OAuth authorization-code exchange failed.");
  return tokens;
};

/** Rotates an existing refresh token exactly once through the published token endpoint. */
export const refreshAccessToken = async (input: Readonly<{
  clientId: string;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  refreshToken: string;
  resource: URL;
}>): Promise<OAuthTokenSet> => {
  const response = await input.fetcher(input.metadata.token_endpoint, formRequest({
    client_id: input.clientId,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    resource: input.resource.origin,
  }));
  const tokens: unknown = await response.json().catch(() => null);
  if (!response.ok || !isTokenSet(tokens)) throw new Error("OAuth refresh failed; run auth login again.");
  return tokens;
};

/** Starts a device authorization that remains bound to the requested OAuth resource. */
export const requestDeviceAuthorization = async (input: Readonly<{
  clientId: string;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  resource: URL;
  scope: string;
}>): Promise<DeviceAuthorization> => {
  if (!input.metadata.device_authorization_endpoint) throw new Error("The authorization server does not support device authorization.");
  const response = await input.fetcher(input.metadata.device_authorization_endpoint, formRequest({
    client_id: input.clientId,
    resource: input.resource.origin,
    scope: input.scope,
  }));
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !isDeviceAuthorization(body)) throw new Error("OAuth device authorization could not be started.");
  return {
    deviceCode: body.device_code,
    expiresIn: body.expires_in,
    interval: body.interval,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    ...(body.verification_uri_complete ? { verificationUriComplete: body.verification_uri_complete } : {}),
  };
};

type DevicePollingDependencies = Readonly<{ now: () => number; sleep: (milliseconds: number) => Promise<void> }>;
const defaultPollingDependencies: DevicePollingDependencies = { now: Date.now, sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) };

const pollDeviceToken = async (input: Readonly<{
  clientId: string;
  deviceCode: string;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  resource: URL;
  deadline: number;
  intervalMilliseconds: number;
  dependencies: DevicePollingDependencies;
}>): Promise<OAuthTokenSet> => {
  if (input.dependencies.now() >= input.deadline) throw new Error("OAuth device authorization expired; run auth login again.");
  const response = await input.fetcher(input.metadata.token_endpoint, formRequest({
    client_id: input.clientId,
    device_code: input.deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    resource: input.resource.origin,
  }));
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && isTokenSet(body)) return body;
  const error = typeof body === "object" && body !== null ? (body as Record<string, unknown>).error : undefined;
  if (error !== "authorization_pending" && error !== "slow_down") throw new Error("OAuth device authorization was denied or is no longer valid.");
  const nextInterval = error === "slow_down" ? input.intervalMilliseconds + 5000 : input.intervalMilliseconds;
  await input.dependencies.sleep(nextInterval);
  return pollDeviceToken({ ...input, intervalMilliseconds: nextInterval });
};

/** Polls a device authorization no faster than its server-directed interval and never exposes tokens to status output. */
export const exchangeDeviceCode = async (input: Readonly<{
  clientId: string;
  device: DeviceAuthorization;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  resource: URL;
  dependencies?: DevicePollingDependencies;
}>): Promise<OAuthTokenSet> => {
  const dependencies = input.dependencies ?? defaultPollingDependencies;
  return pollDeviceToken({
    clientId: input.clientId,
    deadline: dependencies.now() + input.device.expiresIn * 1000,
    dependencies,
    deviceCode: input.device.deviceCode,
    fetcher: input.fetcher,
    intervalMilliseconds: input.device.interval * 1000,
    metadata: input.metadata,
    resource: input.resource,
  });
};

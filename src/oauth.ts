import { createHash, randomBytes } from "node:crypto";
import { AUTH_RESPONSE_BYTES, readBoundedJson } from "./bounded-json.js";
import { validOAuthScope } from "./oauth-scope.js";

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
  interval?: number;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
}>;

export type PkcePair = Readonly<{ challenge: string; verifier: string }>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type RegisteredPublicClient = Readonly<{ clientId: string }>;

const oauthMetadataPath = "/.well-known/oauth-authorization-server";
const requiredMetadataKeys = ["authorization_endpoint", "token_endpoint"] as const;
const maximumTimerMilliseconds = 2_147_483_647;
const maximumDeviceLifetimeSeconds = 900;
const isDeviceInterval = (value: unknown): value is number => typeof value === "number"
  && Number.isFinite(value) && value >= 1 && Math.ceil(value * 1000) <= maximumTimerMilliseconds;

const base64Url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const isAbsoluteHttpsUrl = (value: unknown, issuer: URL): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === issuer.origin && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
};

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isLoopbackRedirect = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "[::1]")
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
};

const isRegistrationResponse = (value: unknown): value is Readonly<{ client_id: string }> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
  && typeof (value as Record<string, unknown>).client_id === "string";

const permitsRegisteredFlow = (value: unknown, deviceGrant: boolean): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  const grants = candidate.grant_types;
  const responses = candidate.response_types === undefined ? ["code"] : candidate.response_types;
  return candidate.token_endpoint_auth_method === "none"
    && candidate.client_secret === undefined
    && isStringArray(grants)
    && grants.includes("refresh_token")
    && grants.includes(deviceGrant ? "urn:ietf:params:oauth:grant-type:device_code" : "authorization_code")
    && isStringArray(responses)
    && (deviceGrant || responses.includes("code"));
};

const isOAuthMetadata = (value: unknown, issuer: URL): value is OAuthMetadata => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.issuer === issuer.origin
    && requiredMetadataKeys.every((key) => isAbsoluteHttpsUrl(candidate[key], issuer))
    && (candidate.device_authorization_endpoint === undefined || isAbsoluteHttpsUrl(candidate.device_authorization_endpoint, issuer))
    && (candidate.registration_endpoint === undefined || isAbsoluteHttpsUrl(candidate.registration_endpoint, issuer))
    && (candidate.revocation_endpoint === undefined || isAbsoluteHttpsUrl(candidate.revocation_endpoint, issuer))
    && (candidate.code_challenge_methods_supported === undefined || isStringArray(candidate.code_challenge_methods_supported));
};

const isTokenSet = (value: unknown): value is Omit<OAuthTokenSet, "token_type"> & Readonly<{ token_type: string }> => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.access_token === "string"
    // RFC 6750 section 2.1 b64token; the negative lookahead requires the
    // actual end of input (unlike $, which also matches before a final newline).
    && /^[A-Za-z0-9._~+/-]+=*(?![\s\S])/u.test(candidate.access_token)
    && typeof candidate.expires_in === "number"
    && Number.isFinite(candidate.expires_in)
    && candidate.expires_in > 0
    && Number.isFinite(new Date(Date.now() + candidate.expires_in * 1000).getTime())
    && typeof candidate.token_type === "string" && candidate.token_type.toLowerCase() === "bearer"
    && (candidate.refresh_token === undefined || typeof candidate.refresh_token === "string")
    && (candidate.scope === undefined || validOAuthScope(candidate.scope));
};

const isDeviceAuthorization = (value: unknown): value is DeviceAuthorizationResponse => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.device_code === "string"
    && typeof candidate.user_code === "string" && candidate.user_code.trim().length > 0 && candidate.user_code.length <= 128
    && !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(candidate.user_code)
    && typeof candidate.verification_uri === "string"
    && typeof candidate.expires_in === "number"
    && Number.isFinite(candidate.expires_in)
    && candidate.expires_in > 0
    && candidate.expires_in <= maximumDeviceLifetimeSeconds
    && (candidate.interval === undefined || isDeviceInterval(candidate.interval))
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
  const response = await fetcher(new URL(oauthMetadataPath, issuer).toString(), { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15000) });
  const metadata: unknown = await readBoundedJson(response, AUTH_RESPONSE_BYTES).catch(() => null);
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
  const endpoint = new URL(input.metadata.authorization_endpoint);
  const merged = new URLSearchParams([
    ...Array.from(endpoint.searchParams).filter(([name]) => !parameters.has(name)),
    ...Array.from(parameters),
  ]);
  return new URL(`?${merged.toString()}`, endpoint).toString();
};

const formRequest = (parameters: Readonly<Record<string, string>>): RequestInit => ({
  body: new URLSearchParams(parameters),
  headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
  method: "POST",
  redirect: "error",
  signal: AbortSignal.timeout(15000),
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
  const tokens: unknown = await readBoundedJson(response, AUTH_RESPONSE_BYTES).catch(() => null);
  if (!response.ok || !isTokenSet(tokens)) throw new Error("OAuth authorization-code exchange failed.");
  return { ...tokens, token_type: "Bearer" };
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
  const tokens: unknown = await readBoundedJson(response, AUTH_RESPONSE_BYTES).catch(() => null);
  if (!response.ok || !isTokenSet(tokens)) throw new Error("OAuth refresh failed; run auth login again.");
  return { ...tokens, token_type: "Bearer" };
};

/** Requests server-side revocation for a client-owned refresh-token family without exposing its value to output. */
export const revokeRefreshToken = async (input: Readonly<{
  clientId: string;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  refreshToken: string;
}>): Promise<void> => {
  if (!input.metadata.revocation_endpoint) throw new Error("The authorization server does not advertise token revocation.");
  const response = await input.fetcher(input.metadata.revocation_endpoint, formRequest({
    client_id: input.clientId,
    token: input.refreshToken,
    token_type_hint: "refresh_token",
  }));
  if (!response.ok) throw new Error("OAuth token revocation could not be confirmed.");
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
  const body: unknown = await readBoundedJson(response, AUTH_RESPONSE_BYTES).catch(() => null);
  if (!response.ok || !isDeviceAuthorization(body)
    || !isAbsoluteHttpsUrl(body.verification_uri, input.resource)
    || (body.verification_uri_complete !== undefined && !isAbsoluteHttpsUrl(body.verification_uri_complete, input.resource))) {
    throw new Error("OAuth device authorization could not be started.");
  }
  return {
    deviceCode: body.device_code,
    expiresIn: body.expires_in,
    interval: body.interval ?? 5,
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
  const body: unknown = await readBoundedJson(response, AUTH_RESPONSE_BYTES).catch(() => null);
  if (response.ok && isTokenSet(body)) return { ...body, token_type: "Bearer" };
  const error = typeof body === "object" && body !== null ? (body as Record<string, unknown>).error : undefined;
  if (error !== "authorization_pending" && error !== "slow_down") throw new Error("OAuth device authorization was denied or is no longer valid.");
  const nextInterval = error === "slow_down" ? input.intervalMilliseconds + 5000 : input.intervalMilliseconds;
  if (nextInterval > maximumTimerMilliseconds) throw new Error("OAuth device polling interval exceeds supported timer limits; run auth login again.");
  const remaining = input.deadline - input.dependencies.now();
  if (remaining <= 0) throw new Error("OAuth device authorization expired; run auth login again.");
  await input.dependencies.sleep(Math.ceil(Math.min(nextInterval, remaining)));
  if (nextInterval >= remaining) throw new Error("OAuth device authorization expired; run auth login again.");
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
  if (!isDeviceInterval(input.device.interval) || !Number.isFinite(input.device.expiresIn * 1000)
    || input.device.expiresIn <= 0 || input.device.expiresIn > maximumDeviceLifetimeSeconds) {
    throw new Error("OAuth device authorization has unsupported timing; run auth login again.");
  }
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

/** Registers a public native client with no secret and a strictly local callback URI. */
export const registerPublicClient = async (input: Readonly<{
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  redirectUri: string;
  deviceGrant?: boolean;
}>): Promise<RegisteredPublicClient> => {
  if (!input.metadata.registration_endpoint) throw new Error("The authorization server does not support public-client registration.");
  if (!isLoopbackRedirect(input.redirectUri)) throw new Error("Public OAuth clients require an exact loopback redirect URI.");
  const response = await input.fetcher(input.metadata.registration_endpoint, {
    body: JSON.stringify({ redirect_uris: [input.redirectUri], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token", ...(input.deviceGrant ? ["urn:ietf:params:oauth:grant-type:device_code"] : [])],
      response_types: ["code"] }),
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const body: unknown = await readBoundedJson(response, AUTH_RESPONSE_BYTES).catch(() => null);
  if (!response.ok || !isRegistrationResponse(body)) throw new Error("Public OAuth client registration failed.");
  if (!permitsRegisteredFlow(body, input.deviceGrant === true)) {
    throw new Error("OAuth registration does not permit secretless login with the selected flow and refresh tokens. Contact your tenant administrator before retrying.");
  }
  return { clientId: body.client_id };
};

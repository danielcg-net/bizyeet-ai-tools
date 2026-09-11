import { refreshAccessToken, revokeRefreshToken, type FetchLike, type OAuthMetadata } from "./oauth.js";
import { isCommittedCredentialCleanupFailure } from "./credential-store.js";
import { validOAuthScope } from "./oauth-scope.js";
import type { Profile, StoredCredentials } from "./profile-store.js";
import { createCanonicalCrmClient, validResourceId, type CanonicalCrmClient, type ListOptions, type CustomerUpdatePreview, type CustomerUpdateExecution, type CustomerUpdateStatusQuery } from "./canonical-crm-client.js";
import { agentFailure } from "./agent-error.js";
import { AUTH_RESPONSE_BYTES, readBoundedJson } from "./bounded-json.js";
import { CRM_SEARCH_LIMIT_MESSAGE, validCrmSearch } from "./search-contract.js";

export type CustomerListOptions = Readonly<{
  cursor?: string;
  fields?: readonly string[];
  limit?: number;
  search?: string;
}>;

export type AgentResult = Readonly<{ credentials: StoredCredentials; response: unknown }>;
export type PersistCredentials = (credentials: StoredCredentials) => Promise<void>;
type MetadataSource = OAuthMetadata | (() => Promise<OAuthMetadata>);

export const refreshPersistenceMessages = {
  retained: "Rotated credentials were saved and access was retained, but credential storage cleanup failed. Check storage and abandoned locks before retrying.",
  revoked: "Rotated credentials could not be saved; the new grant was revoked. Repair credential storage, then run auth login again.",
  unconfirmed: "Rotated credentials could not be saved and revocation could not be confirmed. Revoke this agent in dashboard settings, repair credential storage, then sign in again.",
} as const;

const fieldPattern = /^[a-z][a-z0-9_]{0,63}$/u;

const boundedOptions = (options: CustomerListOptions): ListOptions => {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be an integer from 1 to 100.");
  if (options.cursor && options.cursor.length > 4096) throw new Error("Cursor is invalid.");
  if (options.search && !validCrmSearch(options.search)) throw new Error(CRM_SEARCH_LIMIT_MESSAGE);
  if (options.fields && (options.fields.length > 20 || !options.fields.every((field) => fieldPattern.test(field)))) throw new Error("Requested fields are invalid.");
  return {
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.fields?.length ? { fields: options.fields } : {}),
    page_size: limit,
    ...(options.search ? { search: options.search } : {}),
  };
};

const currentCredentials = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<StoredCredentials> => {
  if (input.credentials.profile?.issuer !== input.profile.issuer
    || input.credentials.profile.clientId !== input.profile.clientId) {
    throw new Error("OAuth identity binding is missing or mismatched; run auth login again.");
  }
  if (new Date(input.credentials.expiresAt).getTime() > input.now() + 30000) return input.credentials;
  if (!input.credentials.refreshToken) throw new Error("OAuth session expired; run auth login again.");
  const metadata = typeof input.metadata === "function" ? await input.metadata() : input.metadata;
  const tokens = await refreshAccessToken({
    clientId: input.profile.clientId,
    fetcher: input.fetcher,
    metadata,
    refreshToken: input.credentials.refreshToken,
    resource: new URL(input.profile.issuer),
  });
  if (!tokens.refresh_token) throw new Error("OAuth refresh did not rotate a refresh token; run auth login again.");
  const credentials = {
    profile: input.credentials.profile,
    accessToken: tokens.access_token,
    expiresAt: new Date(input.now() + tokens.expires_in * 1000).toISOString(),
    refreshToken: tokens.refresh_token,
    scope: tokens.scope ?? input.credentials.scope,
  };
  // A successful rotation consumes the old refresh token, even if the next
  // resource request fails. Persist before making that request.
  try { await input.persistCredentials(credentials); }
  catch (error) {
    if (isCommittedCredentialCleanupFailure(error)) throw new Error(refreshPersistenceMessages.retained, { cause: error });
    try {
      await revokeRefreshToken({ clientId: input.profile.clientId, fetcher: input.fetcher, metadata, refreshToken: credentials.refreshToken });
    } catch { throw new Error(refreshPersistenceMessages.unconfirmed); }
    throw new Error(refreshPersistenceMessages.revoked, { cause: error });
  }
  return credentials;
};

const invoke = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  operation: (client: CanonicalCrmClient, credentials: StoredCredentials) => ReturnType<CanonicalCrmClient["list"]>;
  retryUnauthorized?: boolean;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<AgentResult> => {
  const initial = await currentCredentials(input);
  const execute = (credentials: StoredCredentials): ReturnType<CanonicalCrmClient["list"]> => input.operation(createCanonicalCrmClient({
    origin: input.profile.issuer,
    getAccessToken: () => Promise.resolve(credentials.accessToken),
    request: input.fetcher,
  }), credentials);
  const first = await execute(initial);
  const refreshed = input.retryUnauthorized !== false && first.status === 401 && initial === input.credentials
    ? await currentCredentials({ ...input, credentials: { ...input.credentials, expiresAt: new Date(0).toISOString() } })
    : initial;
  const response = first.status === 401 && refreshed !== initial ? await execute(refreshed) : first;
  if (response.status < 200 || response.status >= 300) throw new Error("Agent request failed.", { cause: agentFailure(response.status, response.body) });
  return { credentials: refreshed, response: response.body };
};

/** Checks current server authorization through the canonical identity endpoint, without reading business records. */
export const checkIdentity = (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<AgentResult> => invoke({ ...input, operation: async (_client, credentials) => {
  const response = await input.fetcher(new URL("/api/agent/me", input.profile.issuer).toString(), {
    method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${credentials.accessToken}` },
    redirect: "error", signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response) return { status: 503, body: { error: { code: "request_unavailable" } } };
  const body: unknown = await readBoundedJson(response, AUTH_RESPONSE_BYTES).catch(() => null);
  if (!response.ok) return { status: response.status, body };
  if (typeof body !== "object" || body === null || !("tenant_id" in body) || typeof body.tenant_id !== "string"
      || !("client_id" in body) || body.client_id !== input.profile.clientId
      || !("scope" in body) || !Array.isArray(body.scope) || !body.scope.every((scope: unknown) => validOAuthScope(scope) && !scope.includes(" "))) {
    return { status: 502, body: { error: { code: "invalid_response" } } };
  }
  return { status: response.status, body: { data: {
    authenticated: true, verification: "server", tenant: body.tenant_id, scope: body.scope,
  }, meta: { contract_version: "v1", request_id: crypto.randomUUID() } } };
} });

/** Lists at most 100 contract-defined customer records without accepting arbitrary paths or query keys. */
export const listCustomers = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  options: CustomerListOptions;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<AgentResult> => {
  const options = boundedOptions(input.options);
  return invoke({ ...input, operation: (client) => client.list("customers", options) });
};

/** Reads one opaque customer identifier without allowing route fragments, URLs, or tenant identifiers. */
export const getCustomer = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
  resourceId: string;
}>): Promise<AgentResult> => {
  if (!validResourceId(input.resourceId)) throw new Error("Customer ID is invalid.");
  return invoke({ ...input, operation: (client) => client.get("customers", input.resourceId) });
};

type WriteSession = Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: MetadataSource;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>;

/** Refresh before preview; canonical server owns validation, routing and approval policy. */
export const previewCustomerUpdate = (input: WriteSession & Readonly<{ proposal: CustomerUpdatePreview }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.previewCustomerUpdate(input.proposal) });

/** Preserve caller-owned idempotency identity and never automatically replay a mutation POST. */
export const executeCustomerUpdate = (input: WriteSession & Readonly<{ approval: CustomerUpdateExecution }>): Promise<AgentResult> =>
  invoke({ ...input, retryUnauthorized: false, operation: (client) => client.executeCustomerUpdate(input.approval) });

/** Read the original execution outcome; no receipt, mutation or claim recovery is performed. */
export const customerUpdateStatus = (input: WriteSession & Readonly<{ query: CustomerUpdateStatusQuery }>): Promise<AgentResult> =>
  invoke({ ...input, operation: (client) => client.customerUpdateStatus(input.query) });

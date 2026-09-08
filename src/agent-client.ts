import { refreshAccessToken, type FetchLike, type OAuthMetadata } from "./oauth.js";
import type { Profile, StoredCredentials } from "./profile-store.js";
import { createCanonicalCrmClient, type CanonicalCrmClient, type ListOptions } from "./canonical-crm-client.js";
import { agentFailure } from "./agent-error.js";

export type CustomerListOptions = Readonly<{
  cursor?: string;
  fields?: readonly string[];
  limit?: number;
  search?: string;
}>;

export type AgentResult = Readonly<{ credentials: StoredCredentials; response: unknown }>;
export type PersistCredentials = (credentials: StoredCredentials) => Promise<void>;

const customerIdPattern = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,512}$/u;
const cursorPattern = /^[A-Za-z0-9_-]{32,128}$/u;
const fieldPattern = /^[a-z][a-z0-9_]{0,63}$/u;

const boundedOptions = (options: CustomerListOptions): ListOptions => {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be an integer from 1 to 100.");
  if (options.cursor && !cursorPattern.test(options.cursor)) throw new Error("Cursor is invalid.");
  if (options.search && options.search.length > 120) throw new Error("Search is limited to 120 characters.");
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
  metadata: OAuthMetadata;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<StoredCredentials> => {
  if (new Date(input.credentials.expiresAt).getTime() > input.now() + 30000) return input.credentials;
  if (!input.credentials.refreshToken) throw new Error("OAuth session expired; run auth login again.");
  const tokens = await refreshAccessToken({
    clientId: input.profile.clientId,
    fetcher: input.fetcher,
    metadata: input.metadata,
    refreshToken: input.credentials.refreshToken,
    resource: new URL(input.profile.issuer),
  });
  if (!tokens.refresh_token) throw new Error("OAuth refresh did not rotate a refresh token; run auth login again.");
  const credentials = {
    accessToken: tokens.access_token,
    expiresAt: new Date(input.now() + tokens.expires_in * 1000).toISOString(),
    refreshToken: tokens.refresh_token,
    scope: tokens.scope ?? input.credentials.scope,
  };
  // A successful rotation consumes the old refresh token, even if the next
  // resource request fails. Persist before making that request.
  await input.persistCredentials(credentials);
  return credentials;
};

const invoke = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  now: () => number;
  operation: (client: CanonicalCrmClient, credentials: StoredCredentials) => ReturnType<CanonicalCrmClient["list"]>;
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
  const refreshed = first.status === 401 && initial === input.credentials
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
  metadata: OAuthMetadata;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
}>): Promise<AgentResult> => invoke({ ...input, operation: async (_client, credentials) => {
  const response = await input.fetcher(new URL("/api/agent/me", input.profile.issuer).toString(), {
    method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${credentials.accessToken}` },
    redirect: "error", signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!response) return { status: 503, body: { error: { code: "request_unavailable" } } };
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return { status: response.status, body };
  if (typeof body !== "object" || body === null || !("tenant_id" in body) || typeof body.tenant_id !== "string"
      || !("client_id" in body) || body.client_id !== input.profile.clientId
      || !("scope" in body) || !Array.isArray(body.scope) || !body.scope.every((scope: unknown) => typeof scope === "string")) {
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
  metadata: OAuthMetadata;
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
  metadata: OAuthMetadata;
  now: () => number;
  persistCredentials: PersistCredentials;
  profile: Profile;
  resourceId: string;
}>): Promise<AgentResult> => {
  if (!customerIdPattern.test(input.resourceId)) throw new Error("Customer ID is invalid.");
  return invoke({ ...input, operation: (client) => client.get("customers", input.resourceId) });
};

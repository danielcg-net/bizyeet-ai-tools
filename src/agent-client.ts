import { refreshAccessToken, type FetchLike, type OAuthMetadata } from "./oauth.js";
import type { Profile, StoredCredentials } from "./profile-store.js";

export type CustomerListOptions = Readonly<{
  cursor?: string;
  fields?: readonly string[];
  limit?: number;
  search?: string;
}>;

export type AgentResult = Readonly<{ credentials: StoredCredentials; response: unknown }>;

const customerIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;
const cursorPattern = /^[A-Za-z0-9_-]{32,128}$/u;
const fieldPattern = /^[a-z][a-z0-9_]{0,63}$/u;

const parseErrorCode = (value: unknown): string =>
  typeof value === "object" && value !== null && "error" in value
  && typeof value.error === "object" && value.error !== null && "code" in value.error && typeof value.error.code === "string"
    ? value.error.code
    : "internal_error";

const boundedOptions = (options: CustomerListOptions): URLSearchParams => {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be an integer from 1 to 100.");
  if (options.cursor && !cursorPattern.test(options.cursor)) throw new Error("Cursor is invalid.");
  if (options.search && options.search.length > 120) throw new Error("Search is limited to 120 characters.");
  if (options.fields && (options.fields.length > 20 || !options.fields.every((field) => fieldPattern.test(field)))) throw new Error("Requested fields are invalid.");
  return new URLSearchParams({
    api_version: "v1",
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.fields?.length ? { fields: options.fields.join(",") } : {}),
    limit: String(limit),
    ...(options.search ? { search: options.search } : {}),
  });
};

const requestUrl = (issuer: string, path: string, query?: URLSearchParams): string => {
  const target = new URL(path, issuer);
  return new URL(query ? `?${query.toString()}` : "", target).toString();
};

const currentCredentials = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  now: () => number;
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
  return {
    accessToken: tokens.access_token,
    expiresAt: new Date(input.now() + tokens.expires_in * 1000).toISOString(),
    refreshToken: tokens.refresh_token,
    scope: tokens.scope ?? input.credentials.scope,
  };
};

const invoke = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  now: () => number;
  path: string;
  profile: Profile;
  query?: URLSearchParams;
}>): Promise<AgentResult> => {
  const initial = await currentCredentials(input);
  const execute = async (credentials: StoredCredentials): Promise<Response> => input.fetcher(requestUrl(input.profile.issuer, input.path, input.query), {
    headers: { Accept: "application/json", Authorization: `Bearer ${credentials.accessToken}` },
    method: "GET",
    signal: AbortSignal.timeout(10000),
  });
  const first = await execute(initial);
  const refreshed = first.status === 401 && initial === input.credentials
    ? await currentCredentials({ ...input, credentials: { ...input.credentials, expiresAt: new Date(0).toISOString() } })
    : initial;
  const response = first.status === 401 && refreshed !== initial ? await execute(refreshed) : first;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Agent request failed: ${parseErrorCode(body)}.`);
  return { credentials: refreshed, response: body };
};

/** Lists at most 100 contract-defined customer records without accepting arbitrary paths or query keys. */
export const listCustomers = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  now: () => number;
  options: CustomerListOptions;
  profile: Profile;
}>): Promise<AgentResult> => invoke({ ...input, path: "/api/agent/customers", query: boundedOptions(input.options) });

/** Reads one opaque customer identifier without allowing route fragments, URLs, or tenant identifiers. */
export const getCustomer = async (input: Readonly<{
  credentials: StoredCredentials;
  fetcher: FetchLike;
  metadata: OAuthMetadata;
  now: () => number;
  profile: Profile;
  resourceId: string;
}>): Promise<AgentResult> => {
  if (!customerIdPattern.test(input.resourceId)) throw new Error("Customer ID is invalid.");
  return invoke({ ...input, path: `/api/agent/customers/${encodeURIComponent(input.resourceId)}` });
};

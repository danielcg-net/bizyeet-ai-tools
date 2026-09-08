export type CrmResource = "customers" | "leads";
export type ReadOptions = Readonly<{ fields?: readonly string[] }>;
export type ListOptions = ReadOptions & Readonly<{
  page_size?: number;
  cursor?: string;
  search?: string;
  sort?: string;
  dir?: "asc" | "desc";
}>;
export type CanonicalResult = Readonly<{ status: number; body: unknown }>;
export type ClientDependencies = Readonly<{
  origin: string;
  /** Obtain an OAuth access token bound to this resource origin; never an API key. */
  getAccessToken: (resourceOrigin: string) => Promise<string>;
  request?: (url: string, init: RequestInit) => Promise<Response>;
  wait?: (milliseconds: number) => Promise<void>;
}>;
export type CanonicalCrmClient = Readonly<{
  list: (resource: CrmResource, options?: ListOptions) => Promise<CanonicalResult>;
  get: (resource: CrmResource, id: string, options?: ReadOptions) => Promise<CanonicalResult>;
}>;

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const validResource = (value: unknown): value is CrmResource => value === "customers" || value === "leads";
const validResourceId = (value: unknown): value is string => typeof value === "string" && /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,512}$/u.test(value);
const failure = (status: number, code: string): CanonicalResult => ({ status, body: { error: { code } } });
const resourceOrigin = (input: string): string => {
  const url = new URL(input);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Use an HTTPS OAuth resource origin, or HTTP loopback for local development.");
  }
  return url.origin;
};
const query = (options: ListOptions): string => new URLSearchParams([
  ["api_version", "v1"],
  ...(options.page_size === undefined ? [] : [["limit", String(options.page_size)]]),
  ...(options.cursor === undefined ? [] : [["cursor", options.cursor]]),
  ...(options.search === undefined ? [] : [["search", options.search]]),
  ...(options.sort === undefined ? [] : [["sort", options.sort]]),
  ...(options.dir === undefined ? [] : [["dir", options.dir]]),
  ...(options.fields === undefined ? [] : [["fields", options.fields.join(",")]]),
]).toString();
const validEnvelope = (body: unknown, list: boolean): boolean => {
  if (!record(body) || !record(body.meta) || body.meta.contract_version !== "v1" || !record(body.data)) return false;
  if (!list) return typeof body.data.id === "string";
  return Array.isArray(body.data.items) && body.data.items.every((item: unknown) => record(item) && typeof item.id === "string") &&
    Number.isSafeInteger(body.data.total) && typeof body.data.total === "number" && body.data.total >= 0 &&
    (body.meta.next_cursor === null || typeof body.meta.next_cursor === "string");
};

/** Provider-neutral read transport shared by CLI/MCP consumers after OAuth login. */
export const createCanonicalCrmClient = (dependencies: ClientDependencies): CanonicalCrmClient => {
  const origin = resourceOrigin(dependencies.origin);
  const request = dependencies.request ?? fetch;
  const wait = dependencies.wait ?? ((milliseconds: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, milliseconds); }));
  const requestRead = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await request(url, init);
    } catch (error) {
      // Only transport failures on this GET-only boundary may retry, once.
      // Keep the original deadline; never replay an HTTP denial or token exchange.
      if (init.signal?.aborted) throw error;
      await wait(250);
      if (init.signal?.aborted) throw error;
      return request(url, init);
    }
  };
  const read = async (resource: CrmResource, id: string | null, options: ListOptions): Promise<CanonicalResult> => {
    if (!validResource(resource)) return failure(400, "invalid_request");
    if (id !== null && !validResourceId(id)) return failure(400, "invalid_request");
    try {
      const token = await dependencies.getAccessToken(origin);
      if (!token || /\s/.test(token)) return failure(401, "authorization_required");
      const path = `/api/agent/${resource}${id === null ? "" : `/${encodeURIComponent(id)}`}`;
      const response = await requestRead(`${origin}${path}?${query(options)}`, {
        method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      const body: unknown = await response.json();
      if (!response.ok) return record(body) && record(body.error) && typeof body.error.code === "string"
        ? { status: response.status, body } : failure(502, "invalid_response");
      return validEnvelope(body, id === null) ? { status: response.status, body } : failure(502, "invalid_response");
    } catch {
      return failure(503, "request_unavailable");
    }
  };
  return Object.freeze({
    list: (resource: CrmResource, options: ListOptions = {}): Promise<CanonicalResult> => read(resource, null, options),
    get: (resource: CrmResource, id: string, options: ReadOptions = {}): Promise<CanonicalResult> => read(resource, id, options),
  });
};

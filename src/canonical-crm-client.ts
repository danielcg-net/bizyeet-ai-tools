import { Buffer } from "node:buffer";

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
export type CustomerUpdatePreview = Readonly<{ resource_id: string; changes: Readonly<Record<string, string>> }>;
export type CustomerUpdateExecution = Readonly<{ preview_id: string; approval_receipt: string; idempotency_key: string }>;
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
  previewCustomerUpdate: (input: CustomerUpdatePreview) => Promise<CanonicalResult>;
  executeCustomerUpdate: (input: CustomerUpdateExecution) => Promise<CanonicalResult>;
}>;

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const validResource = (value: unknown): value is CrmResource => value === "customers" || value === "leads";
const validResourceId = (value: unknown): value is string => typeof value === "string" && /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,512}$/u.test(value);
const failure = (status: number, code: string): CanonicalResult => ({ status, body: { error: { code } } });
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
const validWrite = (body: unknown, preview: boolean): boolean => {
  if (!record(body) || !record(body.meta) || body.meta.contract_version !== "v1" || !record(body.data)) return false;
  const data = body.data;
  if (!preview) return uuid(data.audit_reference) && record(data.resource) && validResourceId(data.resource.id)
    && Object.keys(data.resource).every((key) => ["id", "business", "company", "contact_name", "updated_at"].includes(key))
    && Object.values(data.resource).every((value) => value === null || typeof value === "string");
  return uuid(data.preview_id) && validResourceId(data.resource_id) && data.confirmation_class === "reversible_write"
    && typeof data.request_hash === "string" && /^[a-f0-9]{64}$/u.test(data.request_hash)
    && typeof data.expires_at === "string" && Number.isFinite(Date.parse(data.expires_at))
    && data.approval_path === `/dashboard/#/agent-approvals/${data.preview_id}`
    && record(data.proposed_changes) && Object.values(data.proposed_changes).every((value) => typeof value === "string")
    && Array.isArray(data.side_effects) && data.side_effects.every((value: unknown) => typeof value === "string")
    && Array.isArray(data.warnings) && data.warnings.every((value: unknown) => typeof value === "string")
    && data.idempotency_key_format === "uuid";
};
const boundedWriteResponse = async (response: Response): Promise<unknown> => {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response");
  const collect = async (chunks: readonly Uint8Array[], size: number): Promise<unknown> => {
    const next = await reader.read();
    if (next.done) return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
    if (size + next.value.byteLength > 32_768) {
      await reader.cancel();
      throw new Error("Oversized response");
    }
    return collect([...chunks, next.value], size + next.value.byteLength);
  };
  try { return await collect([], 0); } finally { reader.releaseLock(); }
};
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

/** Provider-neutral transport with a closed capability set; mutations are never automatically retried. */
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
  const write = async (input: CustomerUpdatePreview | CustomerUpdateExecution, preview: boolean): Promise<CanonicalResult> => {
    if (!record(input)) return failure(400, "invalid_request");
    const keys = preview ? ["resource_id", "changes"] : ["preview_id", "approval_receipt", "idempotency_key"];
    if (Object.keys(input).length !== keys.length || !keys.every((key) => Object.hasOwn(input, key))) return failure(400, "invalid_request");
    const valid = preview
      ? "resource_id" in input && validResourceId(input.resource_id) && record(input.changes)
        && Object.values(input.changes).every((value) => typeof value === "string")
      : "preview_id" in input && uuid(input.preview_id) && uuid(input.idempotency_key)
        && /^[A-Za-z0-9_-]{43}$/u.test(input.approval_receipt);
    if (!valid) return failure(400, "invalid_request");
    const serialized = JSON.stringify(input);
    if (new TextEncoder().encode(serialized).byteLength > 16_384) return failure(400, "invalid_request");
    try {
      const token = await dependencies.getAccessToken(origin);
      if (!token || /\s/.test(token)) return failure(401, "authorization_required");
      const response = await request(`${origin}/api/agent/customers/${preview ? "update-preview" : "update-execute"}`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: serialized, redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      const body = await boundedWriteResponse(response);
      if (!response.ok) return !preview && response.status >= 500 ? failure(response.status, "execution_ambiguous") : { status: response.status, body };
      if (!validWrite(body, preview) || !record(body) || !record(body.data)) return failure(502, preview ? "invalid_response" : "execution_ambiguous");
      // Only documented fields cross the agent boundary. Never reflect a receipt,
      // extra private record fields or server diagnostics from a success response.
      const fields = preview ? ["preview_id", "request_hash", "expires_at", "confirmation_class", "resource_id", "proposed_changes", "side_effects", "warnings", "idempotency_key_format", "approval_path"] : ["resource", "audit_reference"];
      const data = body.data;
      const metadata = record(body.meta) ? body.meta : {};
      return { status: response.status, body: { data: Object.fromEntries(fields.map((key) => [key, data[key]])),
        meta: { contract_version: "v1", request_id: uuid(metadata.request_id) ? metadata.request_id : crypto.randomUUID() } } };
    } catch {
      return failure(503, preview ? "request_unavailable" : "execution_ambiguous");
    }
  };
  return Object.freeze({
    list: (resource: CrmResource, options: ListOptions = {}): Promise<CanonicalResult> => read(resource, null, options),
    get: (resource: CrmResource, id: string, options: ReadOptions = {}): Promise<CanonicalResult> => read(resource, id, options),
    previewCustomerUpdate: (input: CustomerUpdatePreview): Promise<CanonicalResult> => write(input, true),
    executeCustomerUpdate: (input: CustomerUpdateExecution): Promise<CanonicalResult> => write(input, false),
  });
};

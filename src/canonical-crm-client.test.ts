import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

await Promise.all(["list", "get"].flatMap((method) => ["safe-reference", "bad\u009breference", "bad\u202ereference", "x".repeat(129), null].map((reference, index) =>
  test(`${method} bounds successful read correlation reference ${String(index)}`, async () => {
    const body = { data: method === "get" ? { id: "customer" } : { items: [{ id: "customer" }], total: 1 },
      meta: { contract_version: "v1", next_cursor: null, request_id: reference } };
    const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic-token"),
      request: () => Promise.resolve(Response.json(body)) });
    const result = method === "get" ? await client.get("customers", "customer") : await client.list("customers");
    assert.equal(result.status, 200);
    const projected = JSON.parse(JSON.stringify(result.body)) as { readonly meta: { readonly request_id: string } };
    if (reference === "safe-reference") assert.equal(projected.meta.request_id, reference);
    else assert.match(projected.meta.request_id, /^[a-f0-9-]{36}$/u);
    assert.deepEqual(result.body, { ...body, meta: { ...body.meta, request_id: projected.meta.request_id } });
  }))));

const emptyPage = { data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null } };
const token = (): Promise<string> => Promise.resolve("oauth-access");

await Promise.all(["bad\uD800id", "bad\uDC00id", "\uD800\uD800", "\uDC00\uD800", "paired😀id"].map((id, index) => test(`opaque ID scalar validation case ${String(index)}`, async () => {
  const request = mock.fn((url: string) => Promise.resolve(Response.json(url.includes("/customers?")
    ? { ...emptyPage, data: { items: [{ id }], total: 1 } }
    : { data: { id }, meta: { contract_version: "v1" } })));
  const getAccessToken = mock.fn(token);
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken, request });
  assert.equal((await client.list("customers")).status, index === 4 ? 200 : 502);
  assert.equal((await client.get("customers", id)).status, index === 4 ? 200 : 400);
  assert.equal(request.mock.callCount(), index === 4 ? 2 : 1);
  assert.equal(getAccessToken.mock.callCount(), index === 4 ? 2 : 1);
})));

await Promise.all(["customers", "leads"].map((resource) => test(`${resource} rejects a total smaller than the returned page`, async () => {
  await Promise.all([0, 1, 2, 3].map(async (total) => {
    const page = { ...emptyPage, data: { items: [{ id: "first" }, { id: "second" }], total } };
    const request = mock.fn(() => Promise.resolve(Response.json(page)));
    const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
    const result = await client.list(resource === "customers" ? "customers" : "leads");
    assert.deepEqual(result, total < 2 ? { status: 502, body: { error: { code: "invalid_response" } } } : { status: 200, body: page });
    assert.equal(request.mock.callCount(), 1);
  }));
})));

await Promise.all([undefined, 1, 25, 100].flatMap((pageSize) => [0, 1].map((extra) => test(`bounds returned records for page ${String(pageSize)} plus ${String(extra)}`, async () => {
  const count = (pageSize ?? 25) + extra;
  const page = { ...emptyPage, data: { items: Array.from({ length: count }, (_, index) => ({ id: `customer-${String(index)}` })), total: count } };
  const request = mock.fn(() => Promise.resolve(Response.json(page)));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  const result = await client.list("customers", pageSize === undefined ? {} : { page_size: pageSize });
  assert.deepEqual(result, extra === 0 ? { status: 200, body: page } : { status: 502, body: { error: { code: "invalid_response" } } });
  assert.equal(request.mock.callCount(), 1);
}))));

await Promise.all([0, -1, 1.5, 101, Infinity, NaN].map((pageSize) => test(`rejects invalid page size ${String(pageSize)} before credentials`, async () => {
  const getAccessToken = mock.fn(token);
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken });
  assert.equal((await client.list("leads", { page_size: pageSize })).status, 400);
  assert.equal(getAccessToken.mock.callCount(), 0);
})));

await Promise.all([300, 512, 513].map((length) => test(`opaque IDs count Unicode code points at ${String(length)}`, async () => {
  const id = "😀".repeat(length);
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token,
    request: (url): Promise<Response> => Promise.resolve(Response.json(url.includes("/customers?")
      ? { ...emptyPage, data: { items: [{ id }], total: 1 } }
      : { data: { id }, meta: { contract_version: "v1" } })) });
  assert.equal((await client.list("customers")).status, length <= 512 ? 200 : 502);
  assert.equal((await client.get("customers", id)).status, length <= 512 ? 200 : 400);
})));

await test("rejects a structurally valid exact read for a different record", async () => {
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token,
    request: () => Promise.resolve(Response.json({ data: { id: "other-customer" }, meta: { contract_version: "v1" } })) });
  assert.deepEqual(await client.get("customers", "requested-customer"), { status: 502, body: { error: { code: "invalid_response" } } });
});

await Promise.all(["", "a/b", "a\\b", "a".repeat(513), "a".repeat(512), "--opaque-id"].map((id, index) =>
  test(`validates list record ID round-trip case ${String(index)}`, async () => {
    const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token,
      request: () => Promise.resolve(Response.json({ ...emptyPage, data: { items: [{ id }], total: 1 } })) });
    assert.equal((await client.list("customers")).status, index >= 4 ? 200 : 502);
  })));

await Promise.all([0, 4096, 4097].map((length) => test(`validates returned cursor input compatibility at length ${String(length)}`, async () => {
  const cursor = "x".repeat(length);
  const page = { ...emptyPage, meta: { ...emptyPage.meta, next_cursor: cursor } };
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token,
    request: () => Promise.resolve(Response.json(page)) });
  const result = await client.list("customers");
  assert.equal(result.status, length === 4096 ? 200 : 502);
  if (length === 4096) assert.deepEqual(result.body, page);
})));

await test("caps actual streamed list, detail and error response bytes before parsing", async () => {
  await Promise.all(["list", "detail", "error"].map(async (kind) => {
    const cancel = mock.fn(() => undefined);
    const stream = new ReadableStream<Uint8Array>({ start(controller): void {
      controller.enqueue(new TextEncoder().encode("é".repeat(524_289)));
    }, cancel });
    const request = mock.fn((): Promise<Response> => Promise.resolve(new Response(stream, { status: kind === "error" ? 400 : 200,
      headers: { "Content-Type": "application/json", "Content-Length": "1" } })));
    const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
    const result = kind === "detail" ? await client.get("customers", "customer") : await client.list("customers");
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: { code: "request_unavailable" } });
    assert.equal(cancel.mock.callCount(), 1);
    assert.equal(request.mock.callCount(), 1);
    assert.equal(stream.locked, false);
  }));
});

await test("accepts a complete read response exactly at the byte limit", async () => {
  const serialized = JSON.stringify(emptyPage);
  const body = serialized + " ".repeat(1_048_576 - new TextEncoder().encode(serialized).byteLength);
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token,
    request: (): Promise<Response> => Promise.resolve(new Response(body)) });
  assert.deepEqual(await client.list("customers"), { status: 200, body: emptyPage });
});

await test("uses canonical OAuth endpoints and preserves empty results and totals", async () => {
  const request = mock.fn((url: string, init: RequestInit): Promise<Response> => {
    assert.ok(url.startsWith("https://tenant.example/api/agent/"));
    assert.equal(init.method, "GET");
    return Promise.resolve(Response.json(emptyPage));
  });
  const getAccessToken = mock.fn(token);
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken, request });
  const result = await client.list("customers", { page_size: 5, cursor: "opaque", search: "Acme & Co", fields: ["business"], dir: "asc" });
  assert.deepEqual(result, { status: 200, body: emptyPage });
  assert.equal(request.mock.callCount(), 1);
  assert.equal(request.mock.calls[0]?.arguments[0], "https://tenant.example/api/agent/customers?api_version=v1&limit=5&cursor=opaque&search=Acme+%26+Co&dir=asc&fields=business");
  assert.deepEqual(request.mock.calls[0].arguments[1].headers, { Authorization: "Bearer oauth-access", Accept: "application/json" });
  assert.equal(request.mock.calls[0].arguments[1].redirect, "error");
  assert.deepEqual(getAccessToken.mock.calls[0]?.arguments, ["https://tenant.example"]);
});

await test("passes opaque customer and lead IDs without choosing a provider", async () => {
  const id = `crm1.${"a".repeat(64)}.leads.123`;
  const body = { data: { id, business: "Permitted record" }, meta: { contract_version: "v1" } };
  const request = mock.fn((url: string, init: RequestInit): Promise<Response> => {
    assert.ok(url.startsWith("https://tenant.example/api/agent/"));
    assert.equal(init.method, "GET");
    return Promise.resolve(Response.json(body));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  assert.deepEqual(await client.get("leads", id, { fields: ["business"] }), { status: 200, body });
  assert.equal(request.mock.calls[0]?.arguments[0], `https://tenant.example/api/agent/leads/${id}?api_version=v1&fields=business`);
});

await Promise.all(["", ".", "..", ".%2E", "%2e", "id\n", "id\u007f", "../me", "customer/other", "customer\\other", "%2e%2e", "https://tenant.example", "customer?tenant_id=other", "customer#fragment", "a".repeat(513)].map((id) =>
  test(`rejects route-like or oversized resource ID ${id.slice(0, 40)} before reading credentials`, async () => {
    const request = mock.fn((): Promise<Response> => Promise.resolve(Response.json(emptyPage)));
    const getAccessToken = mock.fn(token);
    const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken, request });
    assert.deepEqual(await client.get("customers", id), { status: 400, body: { error: { code: "invalid_request" } } });
    assert.equal(getAccessToken.mock.callCount(), 0);
    assert.equal(request.mock.callCount(), 0);
  })));

await test("accepts the maximum opaque ID length unchanged", async () => {
  const id = "a".repeat(512);
  const body = { data: { id }, meta: { contract_version: "v1" } };
  const request = mock.fn((url: string): Promise<Response> => {
    assert.equal(new URL(url).pathname, `/api/agent/customers/${id}`);
    return Promise.resolve(Response.json(body));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  assert.deepEqual(await client.get("customers", id), { status: 200, body });
});

await Promise.all([401, 403, 404, 409, 422, 503].map((status) => test(`preserves canonical HTTP ${String(status)} errors with no fallback`, async () => {
  const body = { error: { code: "canonical_error", request_id: "request-id", retryable: false } };
  const request = mock.fn((): Promise<Response> => Promise.resolve(Response.json(body, { status })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request });
  assert.deepEqual(await client.list("customers"), { status, body });
  assert.equal(request.mock.callCount(), 1);
})));

await Promise.all([
  { data: { items: [] }, meta: { contract_version: "v1", next_cursor: null } },
  { data: { items: [], total: -1 }, meta: { contract_version: "v1", next_cursor: null } },
  { data: { items: [], total: 0 }, meta: { contract_version: "old", next_cursor: null } },
  { data: { items: [{ business: "Missing ID" }], total: 1 }, meta: { contract_version: "v1", next_cursor: null } },
].map((body, index) => test(`rejects malformed successful response ${String(index)}`, async () => {
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token,
    request: (): Promise<Response> => Promise.resolve(Response.json(body)),
  });
  assert.equal((await client.list("customers")).status, 502);
})));

await test("network failure is explicit and never an empty success", async () => {
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token,
    request: (): Promise<Response> => Promise.reject(new Error("private detail")),
  });
  assert.deepEqual(await client.list("leads"), { status: 503, body: { error: { code: "request_unavailable" } } });
});

await test("retries a transport failure once with the same deadline and OAuth binding", async () => {
  const request = mock.fn<(url: string, init: RequestInit) => Promise<Response>>();
  request.mock.mockImplementationOnce(() => Promise.reject(new Error("temporary socket failure")));
  request.mock.mockImplementationOnce(() => Promise.resolve(Response.json(emptyPage)), 1);
  const wait = mock.fn((milliseconds: number): Promise<void> => { assert.equal(milliseconds, 250); return Promise.resolve(); });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request, wait });
  assert.deepEqual(await client.list("customers"), { status: 200, body: emptyPage });
  assert.equal(request.mock.callCount(), 2);
  assert.equal(wait.mock.callCount(), 1);
  const first = request.mock.calls[0];
  const second = request.mock.calls[1];
  assert.ok(first && second);
  assert.equal(first.arguments[1].signal, second.arguments[1].signal);
  assert.deepEqual(first.arguments, second.arguments);
});

await test("transport recovery has a hard two-attempt limit", async () => {
  const request = mock.fn((): Promise<Response> => Promise.reject(new Error("offline")));
  const wait = mock.fn((): Promise<void> => Promise.resolve());
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: token, request, wait });
  assert.equal((await client.get("customers", "opaque")).status, 503);
  assert.equal(request.mock.callCount(), 2);
  assert.equal(wait.mock.callCount(), 1);
});

await test("missing OAuth credentials make no request", async () => {
  const request = mock.fn((): Promise<Response> => Promise.resolve(Response.json(emptyPage)));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: (): Promise<string> => Promise.resolve(""), request });
  assert.equal((await client.list("customers")).status, 401);
  assert.equal(request.mock.callCount(), 0);
});

await Promise.all(["http://tenant.example", "https://user:password@tenant.example", "https://tenant.example/other", "https://tenant.example?token=secret", "https://tenant.example#fragment"].map((origin) =>
  test(`rejects non-resource origin ${origin}`, () => {
    assert.throws(() => createCanonicalCrmClient({ origin, getAccessToken: token }));
  })));

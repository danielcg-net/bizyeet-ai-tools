import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import { communicationResponse, validCommunicationOptions, type CommunicationResource } from "./communication-contract.js";
import { readCommunications } from "./agent-client.js";
import { run } from "./cli.js";

const resources: readonly CommunicationResource[] = ["customers", "leads", "quotes", "services", "payments"];
const item = Object.freeze({ id: "delivery-1", kind: "email", status: "sent", source_type: "quote", sent_at: null });
const envelope = (items: readonly unknown[] = [item]): Readonly<Record<string, unknown>> => ({ data: { items, total: 1 }, meta: { contract_version: "v1", request_id: "synthetic", page: 1, page_size: 10, total_pages: 1 } });
const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = Object.freeze({ profile: { issuer: "https://example.test", clientId: "client" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "customers.read payments.read" });
const storage = { readCredentials: (): Promise<Readonly<Record<string, typeof credentials>>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };

await Promise.all(resources.map((resource) => test(`${resource} history uses one canonical GET and opaque identity`, async () => {
  const request = mock.fn((url: string, init?: RequestInit) => {
    assert.ok(init);
    assert.equal(url, `https://example.test/api/agent/${resource}/opaque%3Arecord/communications?api_version=v1&page=1&page_size=10`);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic-access");
    return Promise.resolve(Response.json(envelope()));
  });
  const result = await readCommunications({ credentials, profile: credentials.profile, resource, resourceId: "opaque:record", options: { page: 1, page_size: 10 },
    fetcher: request, metadata: forbidden, now: () => 0, persistCredentials: forbidden });
  assert.deepEqual(result.response, envelope());
  assert.equal(request.mock.callCount(), 1);
})));

await test("history accepts only bounded page options", () => {
  [{}, { page: 10000, page_size: 50 }, { page: 1, page_size: 20 }].forEach((input) => { assert.equal(validCommunicationOptions(input), true); });
  [null, [], { page: 0 }, { page: 10001 }, { page: 1.5 }, { page: "1" }, { page_size: 25 }, { page_size: 51 }, { fields: ["body_html"] }, { tenant_id: "other" }]
    .forEach((input) => { assert.equal(validCommunicationOptions(input), false); });
});

await Promise.all(["body_text", "body_html", "recipient", "sender", "subject", "tenant_id", "resend_email_id", "provider_error", "source_id"].map((field) => test(`history rejects private ${field} response widening`, async () => {
  const request = mock.fn(() => Promise.resolve(Response.json(envelope([{ ...item, [field]: "PRIVATE" }]))));
  const client = createCanonicalCrmClient({ origin: "https://example.test", getAccessToken: () => Promise.resolve("synthetic-access"), request });
  assert.deepEqual(await client.communications("customers", "opaque"), { status: 502, body: { error: { code: "invalid_response" } } });
  assert.equal(request.mock.callCount(), 1);
})));

await test("history rejects inconsistent pagination and invalid metadata values", () => {
  assert.equal(communicationResponse(envelope([{ ...item, status: { nested: "private" } }]), {}), undefined);
  assert.equal(communicationResponse(envelope([{ kind: "email", status: "sent" }]), {}), undefined);
  assert.equal(communicationResponse(envelope(Array.from({ length: 11 }, () => item)), {}), undefined);
  assert.equal(communicationResponse(envelope(), { page_size: 20 }), undefined);
  assert.equal(communicationResponse({ data: { items: [item], total: 11 }, meta: { contract_version: "v1", page: 1, page_size: 10, total_pages: 1 } }, {}), undefined);
  assert.deepEqual(communicationResponse(envelope(), { page: 99 }), envelope());
  assert.deepEqual(communicationResponse({ data: { items: [], total: 0, secret: "private" }, meta: { contract_version: "v1", request_id: "synthetic", page: 1, page_size: 10, total_pages: 1, secret: "private" } }, {}),
    { data: { items: [], total: 0 }, meta: { contract_version: "v1", request_id: "synthetic", page: 1, page_size: 10, total_pages: 1 } });
});

await test("history rejects truncated pages and accepts an exact final partial page", () => {
  const response = (items: readonly unknown[], page: number): Readonly<Record<string, unknown>> => ({data:{items,total:11},meta:{contract_version:"v1",request_id:"synthetic",page,page_size:10,total_pages:2}});
  assert.equal(communicationResponse(response([],1),{}),undefined);
  assert.equal(communicationResponse(response(Array.from({length:9},() => item),1),{}),undefined);
  assert.equal(communicationResponse(response([],2),{page:2}),undefined);
  assert.deepEqual(communicationResponse(response([item],2),{page:2}),response([item],2));
});

await Promise.all(resources.map((resource) => test(`${resource} CLI forwards its page without interpreting its ID`, async () => {
  const read = mock.fn((input: Omit<Parameters<typeof readCommunications>[0], "fetcher" | "metadata" | "now">) => {
    assert.equal(input.resource, resource);
    assert.equal(input.resourceId, "--opaque-id");
    assert.deepEqual(input.options, { page: 2, page_size: 20 });
    return Promise.resolve({ credentials, response: envelope() });
  });
  const result = await run([resource, "communications", "--page", "2", "--limit", "20", "--", "--opaque-id"], storage, { ...runtime, readCommunications: read });
  assert.equal(result.exitCode, 0);
  assert.equal(read.mock.callCount(), 1);
  assert.doesNotMatch(result.message, /synthetic-access|synthetic-refresh/u);
})));

await test("invalid history flags fail before credential access", async () => {
  const readCredentials = mock.fn(forbidden);
  await Promise.all([["--page", "0"], ["--limit", "25"], ["--page", "1", "--page", "2"], ["--page", ""], ["--limit", "01"], ["--tenant", "other"], ["--fields", "body_text"], ["--export", "--export"]].map(async (args) => {
    assert.equal((await run(["customers", "communications", "opaque", ...args], { ...storage, readCredentials }, runtime)).exitCode, 2);
  }));
  assert.equal(readCredentials.mock.callCount(), 0);
});

await test("history exports only when explicitly requested through protected read output", async () => {
  const exported = mock.fn((serialized: string) => {
    assert.deepEqual(JSON.parse(serialized), envelope());
    return Promise.resolve({ path: "/synthetic/private-export.json", bytes: serialized.length });
  });
  const result = await run(["customers", "communications", "opaque", "--export"], storage, { ...runtime,
    readCommunications: () => Promise.resolve({ credentials, response: envelope() }), exportReadResponse: exported });
  assert.equal(result.exitCode, 0);
  assert.equal(exported.mock.callCount(), 1);
  assert.doesNotMatch(result.message, /delivery-1/u);
});

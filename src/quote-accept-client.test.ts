import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";

const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const quoteId = "sales1.fingerprint.quotes.quote";
const serviceId = "sales1.fingerprint.services.service";
const meta = { contract_version: "v1", request_id: "synthetic-request", private: "hidden" };
const preview = { data: { preview_id: previewId, request_hash: "h".repeat(43), expires_at: "2030-01-01T00:00:00.000Z",
  confirmation_class: "lifecycle_transition", operation: "quote_accept", resource_id: quoteId, resource_label: "Transfer",
  proposed_changes: { quoteTitle: "Transfer", lifecycleAction: "Accept quote and create its canonical service",
    notification: "The tenant's automatic service-status email may be sent." },
  side_effects: ["Accept one quote", "A lead recipient may be promoted", "An automatic email may be sent"],
  warnings: ["This lifecycle action cannot be undone by the agent."], idempotency_key_format: "uuid",
  approval_path: `/dashboard/#/agent-approvals/${previewId}`, private: "hidden" }, meta };
const completed = { data: { quote: { id: quoteId, title: "Transfer", status: "accepted", private: "hidden" },
  service: { id: serviceId, name: "Transfer", status: "scheduled", private: "hidden" },
  already_accepted: false, notification: { attempted: true, sent: true, reconciliation_required: false, private: "hidden" },
  audit_reference: previewId, private: "hidden" }, meta };

void test("quote acceptance uses only canonical preview and approved execution routes with redacted output", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.match(url, /^https:\/\/tenant\.example\/api\/agent\/quotes\/accept-(?:preview|execute)\?api_version=v1$/u);
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer oauth-token");
    assert.equal(init.redirect, "error");
    assert.equal(typeof init.body, "string");
    if (typeof init.body !== "string") throw new Error("Expected JSON body");
    assert.deepEqual(JSON.parse(init.body) as unknown, url.includes("preview")
      ? { resource_id: quoteId }
      : { preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
    return Promise.resolve(Response.json(url.includes("preview") ? preview : completed));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const prepared = await client.previewQuoteAccept({ resource_id: quoteId });
  const accepted = await client.executeQuoteAccept({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
  assert.equal(prepared.status, 200);
  assert.equal(accepted.status, 200);
  assert.deepEqual((accepted.body as { data: { service: unknown } }).data.service,
    { id: serviceId, name: "Transfer", status: "scheduled" });
  assert.doesNotMatch(JSON.stringify([prepared, accepted]), /hidden|oauth-token|rrrrrrrr/u);
  assert.equal(request.mock.callCount(), 2);
});

void test("quote acceptance rejects a mismatched preview and never retries uncertain execution", async () => {
  const request = mock.fn((url: string) => Promise.resolve(Response.json(url.includes("preview")
    ? { ...preview, data: { ...preview.data, resource_id: "other-quote" } }
    : { error: { code: "internal_error" } }, { status: url.includes("preview") ? 200 : 503 })));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  assert.equal((await client.previewQuoteAccept({ resource_id: quoteId })).status, 502);
  const executed = await client.executeQuoteAccept({ preview_id: previewId, approval_receipt: "r".repeat(43), idempotency_key: key });
  assert.deepEqual(executed.body, { error: { code: "execution_ambiguous" } });
  assert.equal(request.mock.callCount(), 2);
  const invalid = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => { throw new Error("unexpected authentication"); } });
  assert.equal((await invalid.previewQuoteAccept({ resource_id: "/bad" })).status, 400);
});

void test("quote acceptance status reconciles one outcome through a read-only request", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.equal(new URL(url).pathname, "/api/agent/quotes/accept-status");
    assert.equal(new URL(url).searchParams.get("preview_id"), previewId);
    assert.equal(new URL(url).searchParams.get("idempotency_key"), key);
    assert.equal(init.method, "GET");
    return Promise.resolve(Response.json({ data: { preview_id: previewId, state: "succeeded", retry_mutation: false,
      reconciliation_required: false, outcome: { status: 200, data: completed.data } }, meta }));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("oauth-token"), request });
  const result = await client.quoteAcceptStatus({ preview_id: previewId, idempotency_key: key });
  assert.equal(result.status, 200);
  assert.doesNotMatch(JSON.stringify(result), /hidden/u);
  assert.equal(request.mock.callCount(), 1);
});

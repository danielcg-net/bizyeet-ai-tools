import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import type { ServicePaymentOptions } from "./service-payment-contract.js";

const service = `sales1.${"a".repeat(64)}.services.service-1`;
const payment = `pay1.${"b".repeat(64)}.payment-1`;
const page = { data: { items: [{ id: payment, amount: "12.50", status: "sent", private_memo: "secret" }], total: 1 },
  meta: { contract_version: "v1", next_cursor: null } };

void test("service-linked payment transport uses only the canonical OAuth route", async () => {
  const request = mock.fn((address: string, init: RequestInit) => {
    const url = new URL(address);
    assert.equal(url.origin, "https://tenant.example");
    assert.equal(url.pathname, `/api/agent/services/${service}/payments`);
    assert.deepEqual(Object.fromEntries(url.searchParams), { api_version: "v1", limit: "5", fields: "amount,status", status: "sent", sort: "amount" });
    assert.equal(init.method, "GET");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer synthetic-token");
    return Promise.resolve(Response.json(page));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic-token"), request });
  const result = await client.servicePayments(service, { limit: 5, fields: ["amount", "status"], status: "sent", sort: "amount" });
  assert.equal(result.status, 200);
  assert.deepEqual((result.body as { readonly data: unknown }).data, { items: [{ id: payment, amount: "12.50", status: "sent" }], total: 1 });
  assert.equal(JSON.stringify(result.body).includes("private_memo"), false);
  assert.equal(request.mock.callCount(), 1);
});

void test("service-linked payment transport rejects private fields before credentials", async () => {
  const getAccessToken = mock.fn(() => Promise.resolve("synthetic-token"));
  const request = mock.fn(() => Promise.resolve(Response.json(page)));
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken, request });
  assert.equal((await client.servicePayments(service, { fields: ["service"] })).status, 400);
  assert.equal(getAccessToken.mock.callCount(), 0);
  assert.equal(request.mock.callCount(), 0);
});

void test("service-linked payment transport omits explicitly undefined optional filters", async () => {
  const request = mock.fn((address: string) => {
    assert.equal(new URL(address).searchParams.has("status"), false);
    return Promise.resolve(Response.json(page));
  });
  const client = createCanonicalCrmClient({ origin: "https://tenant.example", getAccessToken: () => Promise.resolve("synthetic-token"), request });
  assert.equal((await client.servicePayments(service, { limit: 1, status: undefined } as unknown as ServicePaymentOptions)).status, 200);
  assert.equal(request.mock.callCount(), 1);
});

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { catalogResponse } from "./catalog-response.js";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import { run } from "./cli.js";
import type { listCatalog, getCatalogItem } from "./agent-client.js";

const item = Object.freeze({ id: "opaque-catalog", name: "Transfer", active: 1, unit_price: "25.00", unit_cost: "hidden", provider_item_id: "hidden", tenant_id: "hidden" });
const detail = Object.freeze({ data: item, meta: { contract_version: "v1" } });
const page = Object.freeze({ data: { items: [item], total: 14 }, meta: { contract_version: "v1", next_cursor: "opaque-cursor" } });
const forbidden = (): never => { throw new Error("Unexpected operation"); };

void test("catalog projection strips source/cost facts and permits source-optional fields", () => {
  assert.deepEqual(catalogResponse(detail, { fields: ["name", "active", "sku"] }, item.id)?.data, { id: item.id, name: item.name, active: 1 });
  assert.equal(JSON.stringify(catalogResponse(detail, {}, item.id)).includes("hidden"), false);
  assert.equal(catalogResponse(detail, { fields: ["unit_cost"] }, item.id), undefined);
  assert.equal(catalogResponse(detail, {}, "other"), undefined);
  [null, true, 2, "1", {}].forEach((active) => {
    assert.equal(catalogResponse({ ...detail, data: { ...item, active } }, {}, item.id), undefined);
  });
  assert.equal(catalogResponse({ ...detail, data: { ...item, name: { secret: "hidden" } } }, {}, item.id), undefined);
});

void test("catalog page validates limits, cursors, totals and contract version", () => {
  assert.deepEqual(catalogResponse(page, { fields: ["name"] }, null)?.data, { items: [{ id: item.id, name: item.name }], total: 14 });
  [0, 101, 1.5].forEach((page_size) => { assert.equal(catalogResponse(page, { page_size }, null), undefined); });
  assert.equal(catalogResponse({ ...page, data: { ...page.data, total: 0 } }, {}, null), undefined);
  assert.equal(catalogResponse({ ...page, meta: { ...page.meta, next_cursor: "bad\0cursor" } }, {}, null), undefined);
  assert.equal(catalogResponse({ ...page, meta: { ...page.meta, contract_version: "v2" } }, {}, null), undefined);
});

void test("catalog transport uses only canonical bearer endpoints and rejects unsupported queries before auth", async () => {
  const request = mock.fn((url: string, init: RequestInit) => {
    assert.equal(new URL(url).pathname, "/api/agent/catalog");
    assert.equal(new URL(url).searchParams.get("limit"), "1");
    assert.equal(new URL(url).searchParams.get("cursor"), "opaque-cursor");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer synthetic-oauth");
    return Promise.resolve(Response.json(page));
  });
  const client = createCanonicalCrmClient({ origin: "https://example.test", getAccessToken: () => Promise.resolve("synthetic-oauth"), request });
  assert.equal((await client.list("catalog", { page_size: 1, cursor: "opaque-cursor", fields: ["name"] })).status, 200);
  const denied = createCanonicalCrmClient({ origin: "https://example.test", getAccessToken: forbidden });
  assert.equal((await denied.list("catalog", { sort: "name" })).status, 400);
  assert.equal((await denied.list("catalog", { search: "x".repeat(121) })).status, 400);
  assert.equal((await denied.get("catalog", item.id, { fields: ["unit_cost"] })).status, 400);
});

const credentials = Object.freeze({ profile: { issuer: "https://example.test", clientId: "client" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "customers.read" });
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };

void test("catalog CLI forwards bounded list and opaque detail reads", async () => {
  const list = mock.fn((input: Omit<Parameters<typeof listCatalog>[0], "fetcher" | "metadata" | "now">) => {
    assert.deepEqual(input.options, { limit: 5, fields: ["name"] });
    return Promise.resolve({ credentials, response: page });
  });
  const get = mock.fn((input: Omit<Parameters<typeof getCatalogItem>[0], "fetcher" | "metadata" | "now">) => {
    assert.equal(input.resourceId, item.id);
    return Promise.resolve({ credentials, response: detail });
  });
  assert.equal((await run(["catalog", "list", "--limit", "5", "--fields", "name"], storage, { ...runtime, listCatalog: list })).exitCode, 0);
  assert.equal((await run(["catalog", "get", item.id], storage, { ...runtime, getCatalogItem: get })).exitCode, 0);
  assert.equal(list.mock.callCount(), 1);
  assert.equal(get.mock.callCount(), 1);
});

void test("catalog CLI rejects unsupported projections and bounds before credentials", async () => {
  const readCredentials = mock.fn(forbidden);
  await Promise.all([["list", "--limit", "101"], ["list", "--search", "x".repeat(121)],
    ["get", item.id, "--fields", "unit_cost"], ["list", "--provider", "zoho"]].map(async (args) => {
    assert.equal((await run(["catalog", ...args], { ...storage, readCredentials }, runtime)).exitCode, 2);
  }));
  assert.equal(readCredentials.mock.callCount(), 0);
});

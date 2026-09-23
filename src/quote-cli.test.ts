import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import type { getQuote, listQuotes } from "./agent-client.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = Object.freeze({ profile: { issuer: "https://example.test", clientId: "client" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "customers.read" });
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };
type ListInput = Omit<Parameters<typeof listQuotes>[0], "fetcher" | "metadata" | "now">;
type GetInput = Omit<Parameters<typeof getQuote>[0], "fetcher" | "metadata" | "now">;

void test("quote CLI forwards bounded list and revision detail through the profile session", async () => {
  const list = mock.fn((input: ListInput) => {
    assert.deepEqual(input.options, { limit: 5, fields: ["id", "pricing_revision"] });
    return Promise.resolve({ credentials, response: { data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null } } });
  });
  const get = mock.fn((input: GetInput) => {
    assert.equal(input.resourceId, "opaque-quote");
    assert.deepEqual(input.options, { fields: ["items", "pricing_revision"] });
    return Promise.resolve({ credentials, response: { data: { id: "opaque-quote", items: [], pricing_revision: 1 }, meta: { contract_version: "v1" } } });
  });
  assert.equal((await run(["quotes", "list", "--limit", "5", "--fields", "id,pricing_revision"], storage, { ...runtime, listQuotes: list })).exitCode, 0);
  assert.equal((await run(["quotes", "get", "opaque-quote", "--fields", "items,pricing_revision"], storage, { ...runtime, getQuote: get })).exitCode, 0);
  assert.equal(list.mock.callCount(), 1);
  assert.equal(get.mock.callCount(), 1);
});

void test("quote CLI rejects private projections and unbounded limits before credentials", async () => {
  const readCredentials = mock.fn(forbidden);
  await Promise.all([
    ["list", "--limit", "101"], ["list", "--limit", "1.5"],
    ["get", "opaque-quote", "--fields", "cost_notes"],
  ].map(async (args) => { assert.equal((await run(["quotes", ...args], { ...storage, readCredentials }, runtime)).exitCode, 2); }));
  assert.equal(readCredentials.mock.callCount(), 0);
});


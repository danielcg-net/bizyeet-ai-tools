import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import type { readTaxReport } from "./agent-client.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = Object.freeze({ profile: { issuer: "https://example.test", clientId: "client" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "reports.read" });
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };
type TaxInput = Omit<Parameters<typeof readTaxReport>[0], "fetcher" | "metadata" | "now">;

void test("tax command forwards typed filters and retains canonical output", async () => {
  const response = { data: { totals: [{ currency: "CAD", collected_tax_minor: 100 }, { currency: "USD", collected_tax_minor: 200 }] }, meta: { contract_version: "v1" } };
  const read = mock.fn((input: TaxInput) => {
    assert.deepEqual(input.options, { range: "custom", start_date: "2026-01-01", end_date: "2026-01-31", page: 2, page_size: 10, fields: ["amount_minor", "currency"] });
    return Promise.resolve({ credentials, response });
  });
  const result = await run(["reports", "taxes", "--range=custom", "--start-date", "2026-01-01", "--end-date=2026-01-31", "--page=2", "--limit", "10", "--fields=amount_minor,currency"], storage, { ...runtime, readTaxReport: read });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.message), response);
  assert.doesNotMatch(result.message, /synthetic-access|synthetic-refresh/u);
});

await Promise.all([
  ["--range", "custom"], ["--tenant", "default"], ["--provider", "d1"], ["--time-zone", "UTC"], ["--limit", "1e2"], ["--limit=101"],
  ["--page", "0"], ["--fields="], ["--fields", "customer_name"], ["--range=today", "--range", "month"], ["--export", "--export"],
  ["--currency", "cad"], ["--entry-type", "unknown"], ["--page"], ["--start-date", "2026-01-01"],
].map((args) => test(`invalid tax options avoid credential access: ${args.join(" ")}`, async () => {
  const readCredentials = mock.fn(forbidden);
  assert.equal((await run(["reports", "taxes", ...args], { ...storage, readCredentials }, runtime)).exitCode, 2);
  assert.equal(readCredentials.mock.callCount(), 0);
})));

void test("tax command reuses the profile lock and private export boundary", async () => {
  const response = { data: { items: [], totals: [], total: 0 }, meta: { contract_version: "v1" } };
  const withProfileLock = mock.fn(async <T>(profile: string, operation: () => Promise<T>) => {
    assert.equal(profile, "default");
    return { result: await operation(), cleanupFailed: false };
  });
  const exportReadResponse = mock.fn((serialized: string) => {
    assert.equal(serialized, JSON.stringify(response));
    return Promise.resolve({ path: "/synthetic/private/tax.json", bytes: 42 });
  });
  const result = await run(["reports", "taxes", "--export"], { ...storage, withProfileLock }, {
    ...runtime, exportReadResponse, readTaxReport: () => Promise.resolve({ credentials, response }),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(withProfileLock.mock.callCount(), 1);
  assert.equal(exportReadResponse.mock.callCount(), 1);
});

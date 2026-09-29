import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import type { readMarginReport } from "./agent-client.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = Object.freeze({ profile: { issuer: "https://example.test", clientId: "client" }, accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "reports.read" });
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }),
  saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };
type MarginInput = Omit<Parameters<typeof readMarginReport>[0], "fetcher" | "metadata" | "now">;

void test("margin command forwards only typed canonical filters and preserves currency groups", async () => {
  const response = { data: { kind: "sent_quotes", items: [], totals: [{ currency: "CAD", count: 1 }, { currency: "USD", count: 1 }], total: 2 },
    meta: { contract_version: "v1" } };
  const read = mock.fn((input: MarginInput) => {
    assert.deepEqual(input.options, { kind: "sent_quotes", range: "custom", start_date: "2026-01-01", end_date: "2026-01-31",
      page: 2, page_size: 10, fields: ["revenue", "currency"] });
    return Promise.resolve({ credentials, response });
  });
  const result = await run(["reports", "margin", "--kind=sent_quotes", "--range=custom", "--start-date", "2026-01-01",
    "--end-date=2026-01-31", "--page=2", "--limit", "10", "--fields=revenue,currency"], storage, { ...runtime, readMarginReport: read });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.message), response);
  assert.equal(read.mock.callCount(), 1);
  assert.doesNotMatch(result.message, /synthetic-access|synthetic-refresh/u);
});

await Promise.all([
  ["--kind", "unknown"], ["--tenant", "default"], ["--provider", "d1"], ["--time-zone", "UTC"],
  ["--limit", "51"], ["--page=0"], ["--fields="], ["--fields", "customer_name"],
  ["--range=today", "--range=month"], ["--range=custom", "--start-date=2026-02-30", "--end-date=2026-03-01"],
  ["--start-date=2026-01-01"], ["--export", "--export"],
].map((args, index) => test(`invalid margin CLI options ${String(index)} avoid credential access`, async () => {
  const readCredentials = mock.fn(forbidden);
  assert.equal((await run(["reports", "margin", ...args], { ...storage, readCredentials }, runtime)).exitCode, 2);
  assert.equal(readCredentials.mock.callCount(), 0);
})));

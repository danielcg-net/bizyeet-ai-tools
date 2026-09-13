import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import type { receivedPaymentSummary } from "./agent-client.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = Object.freeze({ profile: { issuer: "https://example.test", clientId: "client" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "payments.read" });
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };
type SummaryInput = Omit<Parameters<typeof receivedPaymentSummary>[0], "fetcher" | "metadata" | "now">;

await test("summary command forwards dates and preserves the server's currency groups", async () => {
  const response = { data: { currencies: [{ currency: "CAD", amount: 2 }, { currency: "USD", amount: 3 }] }, meta: { contract_version: "v1" } };
  const summary = mock.fn((input: SummaryInput) => {
    assert.deepEqual(input.options, { range: "custom", start_date: "2026-03-08", end_date: "2026-03-08" });
    return Promise.resolve({ credentials, response });
  });
  const result = await run(["payments", "received-summary", "--range", "custom", "--start-date", "2026-03-08", "--end-date", "2026-03-08"], storage, { ...runtime, receivedPaymentSummary: summary });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.message), response);
  assert.equal(summary.mock.callCount(), 1);
  assert.doesNotMatch(result.message, /synthetic-access|synthetic-refresh/u);
});

await Promise.all([
  ["--range", "week"], ["--range", "custom"], ["--currency", "CAD"], ["--time-zone", "UTC"],
  ["--start-date", "2026-03-08"], ["--export", "--export"],
  ["--range", "today", "--range", "month"], ["--start-date", "x", "--start-date", "y"], ["--end-date", "x", "--end-date", "y"],
].map((args) => test(`invalid summary arguments never read credentials: ${args.join(" ")}`, async () => {
  const readCredentials = mock.fn(forbidden);
  const result = await run(["payments", "received-summary", ...args], { ...storage, readCredentials }, runtime);
  assert.equal(result.exitCode, 2);
  assert.equal(readCredentials.mock.callCount(), 0);
})));

await test("summary uses the profile lock and existing private export path", async () => {
  const response = { data: { currencies: [] }, meta: { contract_version: "v1" } };
  const withProfileLock = mock.fn(async <T>(profile: string, operation: () => Promise<T>) => {
    assert.equal(profile, "default");
    return { result: await operation(), cleanupFailed: false };
  });
  const readCredentials = mock.fn(() => {
    return storage.readCredentials();
  });
  const exportReadResponse = mock.fn((serialized: string) => {
    assert.equal(serialized, JSON.stringify(response));
    return Promise.resolve({ path: "/synthetic/private/summary.json", bytes: 42 });
  });
  const result = await run(["payments", "received-summary", "--export"], { ...storage, withProfileLock, readCredentials }, {
    ...runtime, exportReadResponse, receivedPaymentSummary: () => Promise.resolve({ credentials, response }),
  });
  assert.equal(result.exitCode, 0);
  const exported: unknown = JSON.parse(result.message);
  assert.ok(typeof exported === "object" && exported !== null && "data" in exported);
  assert.deepEqual(exported.data, { exported: true, path: "/synthetic/private/summary.json", bytes: 42 });
  assert.equal(withProfileLock.mock.callCount(), 1);
  assert.equal(exportReadResponse.mock.callCount(), 1);
});

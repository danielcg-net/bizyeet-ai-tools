import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";
import type { upcomingBookings } from "./agent-client.js";

const forbidden = (): never => { throw new Error("Unexpected operation"); };
const credentials = Object.freeze({ profile: { issuer: "https://example.test", clientId: "client" }, accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresAt: "2099-01-01", scope: "bookings.read" });
const storage = { readCredentials: (): Promise<Readonly<{ default: typeof credentials }>> => Promise.resolve({ default: credentials }), saveCredentials: forbidden, removeCredentials: forbidden };
const runtime = { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden };
type BookingInput = Omit<Parameters<typeof upcomingBookings>[0], "fetcher" | "metadata" | "now">;

void test("booking command forwards its bounded window through the profile session", async () => {
  const read = mock.fn((input: BookingInput) => {
    assert.deepEqual(input.options, { hours: 24 });
    return Promise.resolve({ credentials, response: { data: { available: false }, meta: { contract_version: "v1" } } });
  });
  const result = await run(["bookings", "upcoming", "--hours", "24"], storage, { ...runtime, upcomingBookings: read });
  assert.equal(result.exitCode, 0);
  assert.equal(read.mock.callCount(), 1);
});

void test("invalid booking arguments avoid credential access", async () => {
  const readCredentials = mock.fn(forbidden);
  await Promise.all([["--hours", "0"], ["--hours", "721"], ["--provider", "zoho"], ["--hours", "24", "--hours", "25"]].map(async (args) => {
    assert.equal((await run(["bookings", "upcoming", ...args], { ...storage, readCredentials }, runtime)).exitCode, 2);
  }));
  assert.equal(readCredentials.mock.callCount(), 0);
});

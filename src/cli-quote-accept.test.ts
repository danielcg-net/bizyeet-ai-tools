import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";

const quoteId = "sales1.fingerprint.quotes.quote";
const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const credentials = { profile: { clientId: "client", issuer: "https://tenant.example" }, accessToken: "access-secret",
  refreshToken: "refresh-secret", expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.write mail.send" };
const storage: NonNullable<Parameters<typeof run>[1]> = { readCredentials: () => Promise.resolve({ default: credentials }),
  removeCredentials: () => Promise.resolve(), saveCredentials: () => Promise.resolve() };
const unexpected = (): never => { throw new Error("Unexpected operation"); };
const runtime: NonNullable<Parameters<typeof run>[2]> = {
  getCustomer: unexpected, listCustomers: unexpected, loginBrowser: unexpected, loginDevice: unexpected, revoke: unexpected,
};

void test("quote acceptance preview requires only one opaque quote ID and no proposal body", async () => {
  const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewQuoteAccept>>[0]) => {
    assert.deepEqual(input.proposal, { resource_id: quoteId });
    return Promise.resolve({ credentials, response: { data: { preview_id: previewId }, meta: { contract_version: "v1" } } });
  });
  const outcome = await run(["quotes", "accept", "preview", quoteId], storage, { ...runtime, previewQuoteAccept: preview });
  assert.equal(outcome.exitCode, 0);
  assert.equal(preview.mock.callCount(), 1);
  assert.doesNotMatch(outcome.message, /access-secret|refresh-secret/u);
});

void test("quote acceptance execute preserves exact human receipt; status never repeats the action", async () => {
  const execute = mock.fn((input: Parameters<NonNullable<typeof runtime.executeQuoteAccept>>[0]) => {
    assert.deepEqual(input.approval, { preview_id: previewId, idempotency_key: key, approval_receipt: "r".repeat(43) });
    return Promise.resolve({ credentials, response: { data: { audit_reference: previewId }, meta: { contract_version: "v1" } } });
  });
  const status = mock.fn((input: Parameters<NonNullable<typeof runtime.quoteAcceptStatus>>[0]) => {
    assert.deepEqual(input.query, { preview_id: previewId, idempotency_key: key });
    return Promise.resolve({ credentials, response: { data: { state: "unknown", retry_mutation: false }, meta: { contract_version: "v1" } } });
  });
  const execution = { ...runtime, executeQuoteAccept: execute, quoteAcceptStatus: status,
    readApprovalReceipt: (piped: boolean): Promise<string> => { assert.equal(piped, true); return Promise.resolve("r".repeat(43)); } };
  const accepted = await run(["quotes", "accept", "execute", previewId, "--idempotency-key", key, "--receipt-stdin"], storage, execution);
  const observed = await run(["quotes", "accept", "status", previewId, "--idempotency-key", key], storage, execution);
  assert.equal(accepted.exitCode, 0);
  assert.equal(observed.exitCode, 0);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(status.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify([accepted, observed]), /rrrrrrrr|access-secret|refresh-secret/u);
});

await Promise.all([
  ["preview", quoteId, "--input-stdin"], ["preview", "/bad"], ["preview", quoteId, "--profile", "a", "--profile", "b"],
  ["execute", previewId, "--idempotency-key", "invalid"],
  ["status", previewId, "--idempotency-key", key, "--receipt-stdin"],
].map((args, index) => test(`quote acceptance rejects unsafe arguments before credentials ${String(index)}`, async () => {
  const outcome = await run(["quotes", "accept", ...args], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(outcome.exitCode, 2);
})));

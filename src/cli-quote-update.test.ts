import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { run } from "./cli.js";

const quoteId = "sales1.fingerprint.quotes.quote";
const lineId = `${quoteId}.items.line`;
const previewId = "11111111-1111-4111-8111-111111111111";
const key = "22222222-2222-4222-8222-222222222222";
const credentials = { profile: { clientId: "client", issuer: "https://tenant.example" }, accessToken: "access-secret",
  refreshToken: "refresh-secret", expiresAt: "2099-01-01T00:00:00.000Z", scope: "customers.write" };
const storage: NonNullable<Parameters<typeof run>[1]> = { readCredentials: () => Promise.resolve({ default: credentials }),
  removeCredentials: () => Promise.resolve(), saveCredentials: () => Promise.resolve() };
const unexpected = (): never => { throw new Error("Unexpected operation"); };
const runtime: NonNullable<Parameters<typeof run>[2]> = {
  getCustomer: unexpected, listCustomers: unexpected, loginBrowser: unexpected, loginDevice: unexpected, revoke: unexpected,
};

void test("quote update preview sends one canonical quote ID and bound line handle", async () => {
  const quote = { title: "Revised", expectedPricingRevision: 2,
    items: [{ id: lineId, description: "Transfer", quantity: "2", unitPrice: "25.00" }] };
  const preview = mock.fn((input: Parameters<NonNullable<typeof runtime.previewQuoteUpdate>>[0]) => {
    assert.deepEqual(input.proposal, { resource_id: quoteId, quote });
    return Promise.resolve({ credentials, response: { data: { preview_id: previewId }, meta: { contract_version: "v1" } } });
  });
  const result = await run(["quotes", "update", "preview", quoteId, "--input-stdin"], storage,
    { ...runtime, previewQuoteUpdate: preview, readQuoteProposal: () => Promise.resolve(quote) });
  assert.equal(result.exitCode, 0);
  assert.equal(preview.mock.callCount(), 1);
  assert.doesNotMatch(result.message, /access-secret|refresh-secret/u);
});

void test("quote update execute preserves the receipt and idempotency key; status is read-only", async () => {
  const execute = mock.fn((input: Parameters<NonNullable<typeof runtime.executeQuoteUpdate>>[0]) => {
    assert.deepEqual(input.approval, { preview_id: previewId, idempotency_key: key, approval_receipt: "r".repeat(43) });
    return Promise.resolve({ credentials, response: { data: { audit_reference: previewId }, meta: { contract_version: "v1" } } });
  });
  const status = mock.fn((input: Parameters<NonNullable<typeof runtime.quoteUpdateStatus>>[0]) => {
    assert.deepEqual(input.query, { preview_id: previewId, idempotency_key: key });
    return Promise.resolve({ credentials, response: { data: { state: "unknown", retry_mutation: false }, meta: { contract_version: "v1" } } });
  });
  const execution = { ...runtime, executeQuoteUpdate: execute, quoteUpdateStatus: status,
    readApprovalReceipt: (piped: boolean): Promise<string> => { assert.equal(piped, true); return Promise.resolve("r".repeat(43)); } };
  const revised = await run(["quotes", "update", "execute", previewId, "--idempotency-key", key, "--receipt-stdin"], storage, execution);
  const observed = await run(["quotes", "update", "status", previewId, "--idempotency-key", key], storage, execution);
  assert.equal(revised.exitCode, 0);
  assert.equal(observed.exitCode, 0);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(status.mock.callCount(), 1);
  assert.doesNotMatch(JSON.stringify([revised, observed]), /rrrrrrrr|access-secret|refresh-secret/u);
});

await Promise.all([
  ["preview", quoteId], ["preview", quoteId, "--input-stdin", "--input-stdin"], ["preview", "/bad", "--input-stdin"],
  ["execute", previewId, "--idempotency-key", "invalid"],
  ["status", previewId, "--idempotency-key", key, "--receipt-stdin"],
].map((args, index) => test(`quote update rejects unsafe arguments before credentials ${String(index)}`, async () => {
  const result = await run(["quotes", "update", ...args], { ...storage, readCredentials: unexpected }, runtime);
  assert.equal(result.exitCode, 2);
})));

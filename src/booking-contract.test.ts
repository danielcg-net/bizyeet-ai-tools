import assert from "node:assert/strict";
import test from "node:test";
import { validBookingSummaryOptions } from "./booking-contract.js";
import { bookingSummaryResponse } from "./booking-response.js";

void test("booking summaries accept only a bounded future-hour window", () => {
  assert.equal(validBookingSummaryOptions({}), true);
  assert.equal(validBookingSummaryOptions({ hours: 720 }), true);
  [{ hours: 0 }, { hours: 721 }, { hours: 24.5 }, { provider: "zoho" }, { hours: "24" }].forEach((value) => {
    assert.equal(validBookingSummaryOptions(value), false);
  });
});

void test("booking response removes undocumented provider data", () => {
  const result = bookingSummaryResponse({ data: { hours: 24, booking_provider: "setmore", ok: false, available: false, error: "Unsupported", code: "PROVIDER_NOT_SUPPORTED", provider_token: "private" }, meta: { contract_version: "v1", request_id: "private" } }, { hours: 24 });
  assert.deepEqual(result, { data: { hours: 24, booking_provider: "setmore", ok: false, available: false, error: "Unsupported", code: "PROVIDER_NOT_SUPPORTED" }, meta: { contract_version: "v1" } });
});

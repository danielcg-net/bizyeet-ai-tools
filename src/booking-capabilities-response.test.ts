import assert from "node:assert/strict";
import test from "node:test";
import { bookingCapabilitiesResponse } from "./booking-capabilities-response.js";

const response = (overrides: Readonly<Record<string, unknown>> = {}): Readonly<{
  data: Readonly<Record<string, unknown>>; meta: Readonly<{ contract_version: string; request_id: string }>; tenant_id: string;
}> => ({
  data: { booking_provider: "zoho", upcoming_summary: "supported", availability_slots: "unsupported",
    booking_detail: "unsupported", create: "external_link_only", reschedule: "unsupported", cancel: "unsupported",
    booking_links: { in_person: "configured", online: "unavailable" }, ...overrides },
  meta: { contract_version: "v1", request_id: "private-correlation" },
  tenant_id: "private-tenant",
});

void test("booking capability projection preserves supported/link-only truth without leaking URLs", () => {
  assert.deepEqual(bookingCapabilitiesResponse(response({ booking_url: "https://private.example.test", secret: "private" })), {
    data: { booking_provider: "zoho", upcoming_summary: "supported", availability_slots: "unsupported",
      booking_detail: "unsupported", create: "external_link_only", reschedule: "unsupported", cancel: "unsupported",
      booking_links: { in_person: "configured", online: "unavailable" } }, meta: { contract_version: "v1" },
  });
});

void test("booking capabilities reject malformed provider and impossible booking claims", () => {
  [
    { booking_provider: "other-tenant-private-provider" }, { availability_slots: "supported" },
    { create: "supported" }, { booking_links: { in_person: "unavailable", online: "unavailable" } },
    { booking_links: { in_person: "configured", online: "javascript:alert(1)" } },
  ].forEach((data) => { assert.equal(bookingCapabilitiesResponse(response(data)), undefined); });
  assert.equal(bookingCapabilitiesResponse({ ...response(), meta: { contract_version: "v2" } }), undefined);
});

void test("booking capabilities allow a disabled provider without advertising executable actions", () => {
  assert.deepEqual(bookingCapabilitiesResponse(response({ booking_provider: "none", upcoming_summary: "unavailable",
    availability_slots: "unavailable", booking_detail: "unavailable", create: "unavailable",
    reschedule: "unavailable", cancel: "unavailable", booking_links: { in_person: "unavailable", online: "unavailable" } }))?.data,
  { booking_provider: "none", upcoming_summary: "unavailable", availability_slots: "unavailable", booking_detail: "unavailable",
    create: "unavailable", reschedule: "unavailable", cancel: "unavailable",
    booking_links: { in_person: "unavailable", online: "unavailable" } });
});

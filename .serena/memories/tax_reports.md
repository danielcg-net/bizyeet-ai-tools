# Canonical tax-report client

- BIZYEET-646: public tax filters are transport syntax only. Tenant timezone, payment-provider selection, admin checks and accounting totals stay server-owned.
- `month` means month-to-date; `30d` and `7d` are explicit rolling tenant-calendar windows. Custom start/end labels are inclusive; returned UTC instants use inclusive-start/exclusive-end semantics.
- Default fields exclude private reason/registration and customer/payment relationships. Never derive provider-native IDs or recompute totals across currencies.
- Initial contract foundation only: response validation, OAuth client/CLI wiring, MCP descriptor parity and installed integration tests remain required. No publication or production availability is implied.

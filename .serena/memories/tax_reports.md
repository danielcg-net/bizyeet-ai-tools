# Canonical tax-report client

- BIZYEET-646: public tax filters are transport syntax only. Tenant timezone, payment-provider selection, admin checks and accounting totals stay server-owned.
- `month` means month-to-date; `30d` and `7d` are explicit rolling tenant-calendar windows. Custom start/end labels are inclusive; returned UTC instants use inclusive-start/exclusive-end semantics.
- Default fields exclude private reason/registration and customer/payment relationships. Never derive provider-native IDs or recompute totals across currencies.
- `taxReportResponse` validates and allowlists the canonical envelope, requested custom dates, page size, D1 immutable-ledger source, safe integer monetary fields and separated unique currency groups. It strips unrequested reason/registration and all unknown fields without recomputing financial totals.
- Canonical client `taxReport` uses the shared bounded report HTTP transport; `readTaxReport` uses the existing OAuth refresh/persist invocation. Invalid input fails before obtaining credentials, redirects are rejected, and malformed output fails closed.
- `reports taxes` uses the shared client, profile lock, error handling and private export. Supports explicit range/date/authority/province/currency/entry-type/page/limit/fields filters and equals syntax. Duplicate/malformed/tenant-provider override arguments fail before credential reads.
- `taxReportMcpTool` is registered with reports.read and read-only annotations. Local installed-package tests verify live descriptor equality, empty/populated CAD ledger data and period parity, private field selection, export and revocation over TLS/OAuth. Broader currency/role scenarios and required delivery checks remain; no package publication or production availability is implied.

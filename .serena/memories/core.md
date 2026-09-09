# Core

- Public repository for the OAuth-only BizYeet CLI and MCP integration.
- No tenant records, credentials, operational URLs, private implementation, or customer context may enter Git history.
- The public CLI is fail-closed until an explicitly scoped operation is implemented.
- All remote JSON uses the shared iterative byte-bounded reader: CRM reads 1 MiB, writes 32 KiB, OAuth and identity 64 KiB. Do not restore recursive chunk arrays or unbounded response.json calls. Preserve stream cancellation, lock release and opaque errors.
- Device authorization follows RFC 8628 section 3.2: an omitted interval defaults to five seconds; explicit intervals must remain finite positive numbers. Null is not omission.
- Device polling also rejects intervals beyond Node's signed 32-bit millisecond timer bound, including slow_down overflow. Round fractional milliseconds up and stop at expiry instead of polling early or sleeping beyond authorization lifetime.
- The approved V1 CLI/MCP safety contract belongs in `docs/plans/`; keep public identifiers and schemas there while canonical service implementations stay private.
- Read `mem:tech_stack` for toolchain, `mem:conventions` for code and security invariants, and `mem:task_completion` before delivery.

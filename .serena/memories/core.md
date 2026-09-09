# Core

- Public repository for the OAuth-only BizYeet CLI and MCP integration.
- No tenant records, credentials, operational URLs, private implementation, or customer context may enter Git history.
- The public CLI is fail-closed until an explicitly scoped operation is implemented.
- Value options accept --option=value for literal option-shaped values (especially --cursor=--next-page). Preserve everything after the first equals, reject mixed-form duplicates/empty values, and never interpret embedded help/JSON flags.
- Customer get/update share target parsing and opaque-ID validation. Options precede `--`; exactly one literal ID follows. Global help/JSON and profile selection must never consume IDs after the separator. Execute still requires preview and idempotency UUIDs.
- Validate login options before credential access or OAuth; malformed options use invalid_request/exit2, while actual login/storage failures use authentication_required/exit3. An unavailable Windows keychain fails before authorization; an available empty keychain still permits first login.
- Opaque resource IDs use the shared canonical transport validator: bounded1–512, no route separators/query/fragment/control characters or dot segments, but no base64url-like token grammar. Always encode the single URL segment once.
- Pagination cursors are opaque server values: pass them unchanged through URLSearchParams with a 4096-character client size bound, never a local token-format grammar. The server validates their meaning and authorization.
- All remote JSON uses the shared iterative byte-bounded reader: CRM reads 1 MiB, writes 32 KiB, OAuth and identity 64 KiB. Do not restore recursive chunk arrays or unbounded response.json calls. Preserve stream cancellation, lock release and opaque errors.
- Device authorization follows RFC 8628 section 3.2: an omitted interval defaults to five seconds; explicit intervals must remain finite positive numbers. Null is not omission.
- Device polling also rejects intervals beyond Node's signed 32-bit millisecond timer bound, including slow_down overflow. Round fractional milliseconds up and stop at expiry instead of polling early or sleeping beyond authorization lifetime.
- The approved V1 CLI/MCP safety contract belongs in `docs/plans/`; keep public identifiers and schemas there while canonical service implementations stay private.
- Read `mem:tech_stack` for toolchain, `mem:conventions` for code and security invariants, and `mem:task_completion` before delivery.

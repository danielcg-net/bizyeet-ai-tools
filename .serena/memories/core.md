# Core

- Keep the fixed credential-free registration-assignment diagnostic in the CLI safe-message allowlist. Cover both browser/device command paths so administrator guidance is not replaced by a generic login failure; arbitrary remote error text must remain filtered.
- Opaque ID bounds count Unicode code points (512), not UTF-16 units; the preliminary1024-unit cap only bounds allocation. Auth status/logout distinguish profile/configuration input errors (exit2) from credential runtime/corruption failures (internal_error/exit1), retaining fixed safe diagnostics and redaction.

- Exact reads must echo the requested opaque ID, and every returned list/detail ID must satisfy the same input validator. Reject malformed success rather than returning a different/unreadable record.
- Token responses require nonempty whitespace-free access tokens. Device lifetimes are capped at900 seconds at issuance parsing and direct polling entry. Unsupported commands use invalid_request with exit2, not internal-failure exit1.

- Reuse a saved client for device login only after a successful device exchange has set deviceGrantVerified=true in its protected same-issuer profile. Browser/legacy profiles need a new device-capable registration; this is evidence of a completed flow, not a substitute for server authorization.
- Attach a rejection observer to the callback promise immediately when opening the listener, before registration/browser launch. Preserve the original rejected promise for awaitCode to report; do not turn denial into success. Catch malformed HTTP URL targets inside the callback handler so they produce a controlled 400/rejection rather than an uncaught process exception.
- Recorded failed outcomes use only server outcome codes, never local request_unavailable/invalid_response or pending/ambiguous codes. Preserve the separate ambiguous status contract and shared legacy-code normalization.

- DCR sends explicit grant_types and response_types; device login includes the device-code grant. Validate the returned selected-flow plus refresh grant and explicit secretless auth assignment before login. Browser requires code response (omission defaults to code); do not accept null metadata or returned client secrets. Deploy compatible BIZYEET-848 server metadata before releasing this strict check. Validate both device verification URLs against the selected HTTPS issuer before displaying either.
- Write previews must echo the requested resource ID. Status audit references are independently validated opaque UUIDs, not assumed equal to the preview ID. Share the safe error-code projection with direct requests, including the legacy unsupported-operation alias.

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

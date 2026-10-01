# Codex MCP connection

For Codex-specific setup, the companion [Codex and AI-harness guide](codex-harness.md)
uses a trusted-project `.codex/config.toml` plus scoped `codex mcp login`.
It never uses a copied bearer token or API key. Do not use `codex mcp add` for
normal tenant setup: that CLI command writes a global server configuration.

The remote server is OAuth-protected. It does not accept API keys, copied bearer
tokens, tenant IDs, dashboard passwords, raw HTTP, or SQL.

```toml
[mcp_servers.bizyeet]
url = "<your-tenant-mcp-server-url>"
default_tools_approval_mode = "writes"
```

Then complete the browser-based authorization flow:

```sh
codex mcp login bizyeet
```

The V1 read contract includes bounded customer and lead list/get tools using
`customers.read`. Servers with the payment-read increment deployed also expose:

- `bizyeet_payments_list` and `bizyeet_payments_get`: require `payments.read` and
  return payment-only fields.
- `bizyeet_payments_list_with_relationships` and
  `bizyeet_payments_get_with_relationships`: require both `payments.read` and
  `customers.read`, with an explicit `customer` or `service` field selection.

The `bizyeet_services_history` source descriptor reads one service's bounded
status transitions with `customers.read`. Its opaque cursor is service-bound;
private notes and native identifiers are excluded. Check the authenticated
server's advertised tools before relying on this source declaration.

The `bizyeet_services_payments` source descriptor reads bounded public payment
facts linked to one opaque service ID. It requires both `customers.read` and
`payments.read`, excludes private relationship fields, and cannot change a
payment. Its cursor is service-bound by the canonical server. Check the
authenticated server's advertised tools before relying on source availability.

Payment list filters include bounded pagination, status, sorting and canonical
UTC start/end timestamps. Provider routing and live permissions remain
server-owned; unsupported operations fail explicitly. Never combine currencies
implicitly. The authenticated server's tool list determines deployed availability.

Servers with the received-summary increment deployed additionally advertise
`bizyeet_payments_received_summary` with `payments.read`.

Servers with the canonical booking-summary increment deployed additionally
advertise `bizyeet_bookings_upcoming`. It requires `bookings.read` and returns a
provider-aware count for a bounded 1–720-hour future window (default 168). It
does not list appointments or slots, expose booking details, or authorize booking
changes. Reauthorize the MCP server for that exact scope when it is insufficient;
the default CLI login scope is `customers.read`, not `bookings.read`.

The source-only `bizyeet_bookings_capabilities` descriptor also uses
`bookings.read`, but requires the matching canonical backend endpoint to be
merged and deployed before use. It reports configured operation support and
whether booking links exist, without URLs or customer data. An
`external_link_only` create capability is not an executable booking operation;
the matrix does not verify live provider health.

The summary reports gross collected receipts, not net revenue. It preserves
the requested custom dates in `period.requestedStartDate` and
`period.requestedEndDate` (null for named ranges), allowing request binding
without client-side timezone calculations. It preserves
separate currency and labelled legacy-default groups. Named ranges are `today`,
`month`, `last_month`, and `ytd`; `custom` requires inclusive `start_date` and
`end_date` in `YYYY-MM-DD` form. The server resolves timezone and currency;
callers cannot override either. Read-completion time is not a synchronization
guarantee. Unsupported providers return an explicit error, never inactive data.

Any future write must first return a preview and requires the exact preview ID,
a single-use trusted approval receipt, and an idempotency key.

## Persisted expense reads

When deployed, `bizyeet_expenses_list` and `bizyeet_expenses_get` require
`expenses.read` plus live dashboard expense permission. The tools share the
canonical expense API rather than selecting a provider or reading a store.
List filters use inclusive calendar dates. IDs and cursors remain opaque.

Output metadata explicitly marks the persisted view and materialization as
not evaluated. Reading does not generate scheduled occurrences: an empty page
does not prove that no expenses are due. Read-completion time is not a snapshot
or synchronization guarantee. Preserve amounts and currencies. Internal notes
are not included in these public expense reads.

`bizyeet_expense_schedules_list` and `bizyeet_expense_schedules_get` separately
read recurring schedules with `expenses.read` and live dashboard expense
permission. Schedule handles are opaque and are not expense handles. The
schedule projection excludes internal notes; reading never creates an expense.

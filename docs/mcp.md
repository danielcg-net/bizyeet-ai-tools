# Codex MCP connection

The remote server is OAuth-protected. It does not accept API keys, copied bearer
tokens, tenant IDs, dashboard passwords, raw HTTP, or SQL.

```toml
[mcp_servers.bizyeet]
url = "<your-tenant-mcp-server-url>"
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

Payment list filters include bounded pagination, status, sorting and canonical
UTC start/end timestamps. Provider routing and live permissions remain
server-owned; unsupported operations fail explicitly. Never combine currencies
implicitly. The authenticated server's tool list determines deployed availability.

Servers with the received-summary increment deployed additionally advertise
`bizyeet_payments_received_summary` with `payments.read`.

The summary reports gross collected receipts, not net revenue. It preserves
separate currency and labelled legacy-default groups. Named ranges are `today`,
`month`, `last_month`, and `ytd`; `custom` requires inclusive `start_date` and
`end_date` in `YYYY-MM-DD` form. The server resolves timezone and currency;
callers cannot override either. Read-completion time is not a synchronization
guarantee. Unsupported providers return an explicit error, never inactive data.

Any future write must first return a preview and requires the exact preview ID,
a single-use trusted approval receipt, and an idempotency key.

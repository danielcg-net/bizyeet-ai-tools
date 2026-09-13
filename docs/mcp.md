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

Any future write must first return a preview and requires the exact preview ID,
a single-use trusted approval receipt, and an idempotency key.

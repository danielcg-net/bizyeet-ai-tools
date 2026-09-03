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

The current V1 adapter exposes only bounded customer and lead read tools. Any
future write must first return a preview and requires the exact preview ID, a
single-use trusted approval receipt, and an idempotency key.

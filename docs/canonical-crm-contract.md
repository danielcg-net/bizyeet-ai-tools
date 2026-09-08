# Canonical CRM read contract — BIZYEET-801

External CLI/MCP consumers use the shared `createCanonicalCrmClient` transport.
The hosted MCP adapter uses the same server application service as these endpoints.
Provider selection belongs to that service; no consumer selects providers or
falls back to inactive storage.

| Operation | Canonical OAuth endpoint |
| --- | --- |
| Customer list | `GET /api/agent/customers` |
| Customer detail | `GET /api/agent/customers/:id` |
| Lead list | `GET /api/agent/leads` |
| Lead detail | `GET /api/agent/leads/:id` |

Construct the transport with an HTTPS tenant resource origin, an OAuth token
getter bound to that origin, and optionally an injected HTTP transport for tests.
HTTP loopback origins are permitted for isolated development. Credentials in URLs,
origin paths, query strings and fragments are rejected. Requests disallow redirects.
There is no API-key, password or dashboard-session fallback and no credential
storage in this module. OAuth login and future CLI command publication retain their
existing downstream issue ownership.

`list(resource, options)` maps `page_size` to `limit` and passes opaque cursors,
search, sort, direction and field projection to the canonical API. The server
owns validation, tenant identity, live permission checks, field redaction and
provider routing. `get(resource, id, options)` sends the opaque ID unchanged
apart from URL encoding. Never extract provider IDs or construct replacement IDs.

A successful list returns `data.items`, a nonnegative integer `data.total`, and
`meta.contract_version: "v1"` with `meta.next_cursor`. Total describes the filtered
collection; it is not a count of new records in a period. Resource responses return
`data.id` and contract metadata. Clients return the server envelope without
combining pages, enriching contact information, or substituting local records.
The public MCP schemas advertise totals and IDs up to 512 characters.

Server errors retain their HTTP status and structured error envelope, including
authorization, unsupported operations, provider failures and stale cursors. A
transport failure is explicit; it cannot become an empty successful list.
Changing providers or reconnecting an account invalidates old IDs/cursors at the
server. Consumers must start a fresh query when told a cursor is invalid.

The public guard in `npm run check` rejects private repository/provider imports
and noncanonical HTTP paths. Its negative fixtures and the shared transport tests
must pass together with typecheck and immutable TypeScript lint.

The read transport retries a network exception at most once after 250 ms, using
the same OAuth binding and original 15-second deadline. HTTP responses (including
denials, rate limits and provider failures) are not automatically retried. OAuth
token exchanges, registration and revocation have independent 15-second
deadlines, reject redirects, and never use this read-retry path. Future mutation
commands must not inherit automatic read retries.

Delivery dependency: these response/schema additions accompany the private
BIZYEET-801 server migration, which follows BIZYEET-800. They do not claim that
the older deployed endpoint already provides this complete contract. The
BIZYEET-798 rollout verification must exercise the integrated deployed system
before the effort or this child is marked Done.

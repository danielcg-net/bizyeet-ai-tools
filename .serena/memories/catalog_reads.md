# Catalog read contract

- BIZYEET-645 adds `catalog list/get` using canonical `/api/agent/catalog` endpoints.
- OAuth customers.read; reuse shared refresh/session persistence and profile lock.
- Catalog source routing and pricing remain server-owned, independent of client CRM selection.
- Explicit public field projection strips costs, tenant IDs and native provider references.
- Source-optional public fields may be absent. Active is numeric 0 or 1.
- Page limit 1..100, search at most 120 characters; no sort/provider/tenant query keys.
- Preserve opaque IDs/cursors. Propagate stale-cursor errors, never auto-restart discovery.
- Map catalog provider-unavailable/invalid-response errors to safe shared categories. Preserve catalog_provider_limit_exceeded as non-retryable with administrator recovery; smaller pages cannot bypass full-snapshot capacity.
- No catalog writes or deployed availability claim. Server delivery is still pending.
- Validate with catalog-read.test.ts and full npm run check.

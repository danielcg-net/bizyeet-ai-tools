# Expense reads

- Expense CLI work belongs to BIZYEET-646. Use canonical `/api/agent/expenses` endpoints with OAuth `expenses.read`, never provider-specific stores or endpoints.
- `expense-contract.ts` defines transport syntax: bounded pages, opaque cursor, explicit allow-listed fields, inclusive calendar-date filters and sort/status values. Tenant/provider/category resolution and schedule identity remain server-owned.
- Expense data is a persisted view. Reads must not generate scheduled occurrences or imply that empty persisted rows mean no expenses are due. Preserve each currency and require source/read-completion/materialization metadata.
- The contract foundation is tested but not yet wired into the canonical client, authenticated command handlers or MCP descriptors. Response validation, installed cross-repository tests and end-to-end command coverage remain required before delivery.

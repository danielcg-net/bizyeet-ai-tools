# Expense reads

- Expense CLI work belongs to BIZYEET-646. Use canonical `/api/agent/expenses` endpoints with OAuth `expenses.read`, never provider-specific stores or endpoints.
- `expense-contract.ts` defines transport syntax: bounded pages, opaque cursor, explicit allow-listed fields, inclusive calendar-date filters and sort/status values. Tenant/provider/category resolution and schedule identity remain server-owned.
- Expense data is a persisted view. Reads must not generate scheduled occurrences or imply that empty persisted rows mean no expenses are due. Preserve each currency and require source/read-completion/materialization metadata.
- The canonical client list/get transport supports expenses through the existing bounded OAuth GET/retry boundary. Response validation preserves money strings/currencies, projects requested fields only, and requires persisted source/materialization metadata plus exact requested list dates. It does not derive provider routing or decode opaque identities.
- `expenses list/get` uses shared profile locking, OAuth refresh/persistence and private exports. Argument parsing rejects unknown/duplicate options and malformed/duplicate fields before credential reads. Help and README describe persisted-only semantics and expenses.read.
- `expenseMcpTools` advertises the exact canonical server list/get schemas with expenses.read and explicit persisted metadata. Installed local TLS/OAuth E2E verifies descriptor equality, list/detail canonical parity, credential-free private exports and revoked grant denial.
- Installed local coverage forces and persists OAuth rotation, follows an amount-sorted second page, rejects cursor/filter mismatch and revokes the rotated grant. Exports exclude original and rotated credentials.
- Schedule support and tracked CI rollout remain required before full expense delivery.

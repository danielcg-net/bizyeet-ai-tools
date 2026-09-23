# BIZYEET-869: remaining CRM write approval contract

Tracking: https://bizyeet.youtrack.cloud/issue/BIZYEET-869

This contract specifies the remaining scope of BIZYEET-639/644. It does not
advertise shipped commands, enable a capability, authorize a production canary,
or reopen completed OAuth and routing work. Existing customer update remains
unchanged. Implementations consume canonical CRM services and their current
provider, permission, validation, audit and lifecycle behavior.

## Operations

Every operation requires `customers.write` intersected with the human user's
current tenant permissions. Preview, approval, execution and status are distinct
operations; preview must never execute a business mutation.

| Capability | Proposed business effect | Approval class |
| --- | --- | --- |
| `customers.create` | Create one customer using validated fields and defaults | `reversible_write` |
| `leads.create` | Create one lead using validated fields and defaults | `reversible_write` |
| `leads.update` | Edit one existing lead without causing customer conversion | `reversible_write` |
| `leads.promote` | Perform the canonical lead-to-customer conversion, including reuse/linking of an existing customer where applicable | `lifecycle_transition` |

Here, reversible describes the approval class, not a guarantee of a rollback
command. Delete, bulk import, arbitrary provider fields, sending communications
and financial mutations remain outside these operations.

A lead edit must not hide customer conversion. In particular, a requested
transition to Won that triggers conversion must be rejected by the reversible
edit operation and handled through a separately reviewed lifecycle preview.
Creating a lead directly in a converting state follows the same rule. Promotion
must display the actual canonical effects, including whether it creates or
reuses a customer and any lead-state changes; the adapter must not invent a
different lifecycle merely to fit its command name.

If a canonical operation requires an external communication, it cannot execute
under one of the reversible approvals above. The contract must explicitly
describe that effect, require its corresponding scope and approval class, and
gain coverage before enabling that operation. Never suppress a required
canonical effect merely to keep a lower approval class.

## Preview and approval

- Accept allowlisted structured fields, never a tenant identifier or provider
  selector. Resolve tenant, provider and effective role on the server.
- Canonical preflight validates and normalizes every field and materializes
  defaults before preview. Show all human-meaningful persisted values and
  lifecycle effects, including notes, derived names and relationship reuse.
- Creation previews identify a new-record proposal. They must not fabricate an
  existing resource ID to satisfy an update-only schema. Use a discriminated
  create/update/lifecycle target in the bounded public contract.
- Bind the stored proposal to tenant, human user, client, live grant family,
  capability, routing fingerprint, request hash, expiry and relevant record
  versions. Server-generated IDs and audit metadata are not caller authority.
- Only a trusted harness or server-side out-of-band approval boundary (including
  the dashboard) may issue the single-use receipt after displaying that exact
  proposal and obtaining human approval. The model and untrusted tool output
  cannot mint receipts or substitute a conversational confirmation for one.
  Execution accepts the receipt,
  preview ID and stable idempotency key, never replacement business fields.

## Execution, concurrency and provider parity

Revalidate live authority, routing and the prepared proposal before effects.
Record edits and promotion require atomic version preconditions covering the
records whose changes would invalidate approval. A read-then-write comparison
alone is not sufficient. Creation must enforce duplicate and relationship
preconditions atomically with the mutation, using provider-enforced uniqueness,
a reservation, or an equivalent canonical atomic create boundary. Two approved
creates with different idempotency keys must not both pass a read-only duplicate
check and create duplicate records. A changed precondition rejects execution;
it must not turn an approved create into an unreviewed merge or overwrite.

Claim execution durably before contacting the canonical mutation service. A
concurrent or repeated call with the same key cannot perform another mutation;
return the recorded result or a pending/ambiguous status. After a lost response
or outcome-persistence failure, do not automatically issue a fresh mutation,
replace its key, or infer failure from elapsed time. Status must say whether
reconciliation is required without exposing credentials or private provider data.

Apply these guarantees to the tenant's selected provider. If its canonical
boundary cannot enforce a required precondition, idempotency or lifecycle
guarantee, return `unsupported_operation` (HTTP 422, CLI exit 2) before effects.
The canonical `crm_operation_unsupported` alias normalizes to that public code.
A temporarily unavailable provider returns `provider_unavailable` (HTTP 503,
CLI exit 7), not unsupported or empty success. Record
that provider gap as unfinished delivery; do not treat denial alone as feature
completion, silently fall back to local storage, or implement provider rules
inside CLI/MCP adapters.

## Required delivery evidence

Each capability needs canonical service tests, OAuth and trusted approval
browser tests, public CLI/MCP contract tests, and installed-command tests for:

- supported provider success and explicit unsupported/unavailable outcomes;
- live scope/role reduction, tenant and grant substitution, and stale routing;
- complete preview values, forged/expired/replaced receipts and changed inputs;
- version races, duplicate creation/relationship races, concurrent execution,
  replay, lost responses and failed outcome persistence;
- lead edits that cannot cause unapproved conversion, and promotion that
  preserves the canonical customer identity and history without duplicates;
- bounded, redacted result/status/error output and preserved audit attribution.

Release claims require merged green checks, successful deployment and the
separately authorized canary for the new effect. Contract review and synthetic
tests do not grant permission to create or modify production records.

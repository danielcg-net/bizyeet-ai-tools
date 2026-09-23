# BIZYEET-647 communication read contract

The five resource families customers/leads/quotes/services/payments expose
communications through canonical agent GET endpoints only. CLI options are
closed, page 1..10000 and limit 10/20/50, with one explicit page per command.
Opaque IDs are never decoded. Provider routing and permissions stay server-side.

communication-contract.ts rejects widened rows and inconsistent pagination;
only immutable delivery metadata is allowed, never bodies, addresses, subject,
parent/provider IDs, provider errors or tenant internals. Reads reuse OAuth
refresh, bounded transport, private exports and profile locks. No send or other
mutation is provided here. Synthetic installed-tarball tests cover all families.

Source only: backend delivery and production validation are pending. Do not
claim release or provider inbox access from these synthetic contract tests.

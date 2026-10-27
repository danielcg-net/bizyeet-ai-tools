# CLI publication setup remains pending

`@bizyeet/cli` has no checked-in publication readiness record. Unpublished
verification in `release-cli.yml` works without one. Publication fails closed
until separately approved, actual new-package ownership and trusted-publisher
configuration are recorded in `scripts/release-readiness.json` and reviewed.
Test fixtures are synthetic and cannot establish external setup.

The relationship must bind `@bizyeet/cli`, repository
`danielcg-net/bizyeet-ai-tools`, workflow `release-cli.yml`, environment
`npm-release`, the exact `cli-vVERSION` and version, current ownership evidence,
human reviewer policy, observed trust configuration time and first successful
OIDC state. Manual bootstrap is not an OIDC success. The initial two-day trust
window and every normal source/run/artifact/provenance/human gate still apply.
See [verification and release guidance](release-verification.md).

The prior `@bizyeet/ai-tools` setup is historical. Its inert `0.0.0` bootstrap,
`0.0.0-stage` provider record, `bootstrap`/`latest` mappings and failed immutable
`v0.1.0-beta.1` run remain untouched. Its ownership attestation, publisher
relationship and user approvals do not transfer to `@bizyeet/cli`. Git history
retains the old readiness record; no current record copies its evidence.

A new namespace may require a separately approved public inert bootstrap before
trusted-publisher setup. Such a package is publicly installable even without a
`latest` tag; it has no CLI or OIDC provenance. Prepare exact contents, digest,
command, channel effects and recovery limits for review before any registry
write. No bootstrap, publisher change or publication is authorized by this file.

Hosted MCP has a separate private version, build and deployment process. It is
not another npm executable and its deployment cannot be inferred from CLI setup.

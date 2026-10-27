# First beta setup evidence

The [readiness record](../scripts/release-readiness.json) is a nonsecret
maintainer attestation of external setup for 0.1.0-beta.1. It is not a verified
OIDC exchange, an existing beta tag, a published CLI or human approval to publish
a particular candidate. Actual source/run/tag/digest and the protected human gate
remain required by the [release contract](plans/bizyeet-1188-release-contract.md).

## Authorization and observation times

- `maintainer.login` is the verified npm owner `danielcgomes`. The separate
  existing GitHub human reviewer is `dcgomesbr`, ID 23157483.
- `confirmed_at:2026-10-27T12:32:12Z` refers to the coordinator's
  [record of actual human authorization](https://bizyeet.youtrack.cloud/issue/bizyeet-1192#focus=Comments-7-5153.0-0)
  for the exact planned bootstrap/publisher actions. It is not the exact chat
  utterance time or a new human confirmation after agent execution/readback.
- `trust_configured_at:2026-10-27T13:07:27Z` is the observed successful CLI
  configuration completion. The provider returned no creation timestamp.
  Independent CLI readback completed at 13:07:56Z; the
  [setup evidence](https://bizyeet.youtrack.cloud/issue/bizyeet-1192#focus=Comments-7-5163.0-0)
  records the distinction and exact operation results.
- `first_publish_succeeded:false` is intentional. Manual inert bootstrap is not
  a trusted OIDC success. The recorded two-day first-success window ends
  2026-10-29T13:07:27Z; expired/unverified setup must stop a new publication.

## Actual bootstrap baseline

One specifically approved direct publication created inert
`@bizyeet/ai-tools@0.0.0`: 4,769 bytes, SHA256
`c65fb12f2cc5f47881fc662cfcf4d6ba5aa988c5bcae809c3d023b2f532d07fd`.
Its package.json, README and LICENSE contain no CLI, executable files, scripts or
dependencies. Exact registry bytes/SHA512 and sole maintainer `danielcgomes` matched.

Observed registry state also contains a 368-byte `0.0.0-stage` stub with only
package.json/README and `stub:true`. No agent stage command was run; this evidence
does not prove npm's internal processing implementation. Observed tags are
`bootstrap:0.0.0` and `latest:0.0.0`, with beta absent. A single parent-reviewed
latest-removal attempt returned E400 and left state unchanged. The coordinator
accepted this existing inert baseline without further cleanup, retagging or
unpublishing; do not claim an absent latest tag or a restored no-latest condition.

The actual CLI must publish only to beta and preserve existing `latest:0.0.0`.
The workflow captures/rechecks that mapping; no checks were weakened for this
baseline. Unqualified installations may fetch the inert placeholder, so use the
explicit version/beta guidance only after the real CLI release is verified.

## Verified controls and remaining gate

The existing human/no-admin-bypass/main-only GitHub `npm-release` gate was applied
and read back separately. Self-review is allowed for the accepted single-maintainer
contract; reviewer 23157483 receives no new repository privileges.

npm publisher ID `6cd3feb1-c236-49bf-8a8e-3295eabb898e` was created once after
verified empty existing trust. Readback: type `github`, repository
`danielcg-net/bizyeet-ai-tools`, file `release.yml`, environment `npm-release`,
permissions `createPackage` and `createStagedPackage`. This proves configured direct
publishing plus provider-default staging capability; the workflow uses direct
publication only and no stage action was authorized or executed. No static CI
token, ownership change, revocation or replacement was used.

Configuration/readback is not independent proof of a successful OIDC publication.
After this record's normal review/merge, obtain a fresh final-source candidate and
the required concrete source/tag/run approval. Keep the actual real-beta
publication, npm provenance, installed registry CLI and matching GitHub prerelease
unclaimed until those operations and their verification succeed. Current live
CanRock auth and broader harness acceptance retain their separately recorded limits.

# CLI publisher setup and first publication evidence

The [readiness record](../scripts/release-readiness.json) is a nonsecret
maintainer attestation for `@bizyeet/cli@0.1.0-beta.1`. It now records the
verified first trusted publication described below. It does not approve any
future candidate. Actual source/run/tag/digest, fresh verification and the
protected human gate remain required by [release guidance](release-verification.md).

## Approval and time provenance

The npm owner is `danielcgomes`; the existing GitHub reviewer is `dcgomesbr`,
ID 23157483. Those identities have different roles.

- [Authorization record 5242](https://bizyeet.youtrack.cloud/issue/bizyeet-1192#focus=Comments-7-5242.0-0)
  was created at 2026-10-27T21:45:17Z and records the actual human answer
  “Approve bootstrap and publisher setup” at approximately 21:27 UTC for the exact
  planned configuration. `confirmed_at` uses this record time, not an invented
  precise utterance time or subsequent human readback approval.
- [Actual execution/readback 5243](https://bizyeet.youtrack.cloud/issue/bizyeet-1192#focus=Comments-7-5243.0-0)
  records bootstrap verification and one new trusted-publisher creation.
  The provider did not return its creation timestamp. Agent-observed command
  completion was 21:47:53 UTC; independent readback completed 21:48:07 UTC.
- [Timestamp clarification 5245](https://bizyeet.youtrack.cloud/issue/bizyeet-1192#focus=Comments-7-5245.0-0)
  explains `trust_configured_at:2026-10-27T21:47:02Z`: this is a verified clock
  sample after empty trust inspection and before starting creation. It is a
  conservative **lower-bound window origin**, not the unknown provider creation
  timestamp or an invented precise request-start time. Before first success, the
  existing 48-hour guard would stop new publication at 2026-10-29T21:47:02Z,
  before the actual provider deadline. This origin is unchanged; completion time
  is not used to extend the window.
- Source `44a34f2` and its retained prepublication record correctly contain
  `first_publish_succeeded:false`. The current source record changes to `true`
  only after the real beta's npm provenance was cryptographically verified.
  Manual inert bootstrap is not that success. Original tag, artifact and release
  bytes remain unchanged; current source does not rewrite their historical state.

## Exact public bootstrap baseline

One specifically approved direct publication produced public inert
`@bizyeet/cli@0.0.0`: 4,898 bytes, SHA256
`96c6fba0417d5d5c859f2ac51a4211ca9e86f28be135a7bd86b58824c1c215b3`.
Independent registry download matched SHA256 and SHA512 integrity. Its only files
are metadata, README and Apache-2.0 LICENSE; there is no executable, script,
dependency, CLI OIDC provenance or GitHub CLI release. Sole observed maintainer
was `danielcgomes`.

Observed registry state at 21:45:25 UTC also contains the provider's inert
`0.0.0-stage` metadata (`stub:true`) and `latest:0.0.0` plus
`bootstrap:0.0.0`; no beta version/tag exists. No stage command was executed and
server internals are not inferred. These possible effects were disclosed before
approval. Bootstrap tags are not privacy: exact versions, ranges or clients may
install the inert package. No cleanup/retag/unpublish occurred. Future actual CLI
publication must use beta and preserve this captured latest baseline.

## New trusted relationship

Independent npm CLI readback returned one GitHub publisher:

- ID `9c31139c-1336-4164-a948-b152eb9f4def`
- Repository `danielcg-net/bizyeet-ai-tools`, file `release-cli.yml`,
  environment `npm-release`
- Permissions `createPackage` and `createStagedPackage`

Direct publishing was explicitly enabled. Provider staging capability is also
reported; no staging action is authorized. No static CI token, account/owner
change, secret transfer or weaker environment was used. Existing native human
review/main-only/no-admin-bypass environment policy remains independently checked
by the actual workflow; it was not changed by setup.

## Verified first trusted publication

[Actual publication evidence 5285](https://bizyeet.youtrack.cloud/issue/bizyeet-1192#focus=Comments-7-5285.0-0)
binds the [npm version](https://registry.npmjs.org/@bizyeet/cli/0.1.0-beta.1)
and [matching prerelease](https://github.com/danielcg-net/bizyeet-ai-tools/releases/tag/cli-v0.1.0-beta.1)
to source `44a34f2db1b03ecc0453bdc7e9580290e441a7e7` and tarball SHA256
`462536020df3fd0e73c25b45d58a8ff2cb245d5893df4c6f9693e2a36878e90d`.
Strict verification of the public npm SLSA proof binds `release-cli.yml`, main,
the GitHub-hosted builder and run `40598299565`, attempt 1. The native server review
records `dcgomesbr` approval; npm publication succeeded at 23:12:08 UTC. Independent
actual-run artifact QA completed at 23:13 UTC, after publication, and is not
retroactive coordinator prepublication assurance.

The immediate GitHub step stopped while npm processed the version. After exact
registry bytes, integrity, channels and provenance were reconciled, one approved
GitHub-only recovery completed as attempt 2. Build, attestation and npm publication
were not executed again; original producer/npm evidence remains attempt 1. All
seven uploaded prerelease assets match the retained digests and canonical notes.
GitHub reports `immutable:false`: workflow no-overwrite checks and signed/digest
evidence do not provide platform-enforced release immutability. Verify downloads;
no immutability setting was changed. npm `beta` selects `0.1.0-beta.1` while
`latest` and `bootstrap` remain `0.0.0`; GitHub stable-latest lookup returned 404.

One fresh outside-repository exact registry-version installation passed with
scripts disabled, no inherited authentication and unchanged private config and
command canaries. Only local version, help and diagnostics ran; authentication
and update checks remained false. This proves neither live OAuth/business access
nor hosted MCP deployment.

The true flag prevents applying the initial first-use cutoff to later reviewed
releases after this verified success. It does not grant publication authority or
prove permanent publisher access. Future publication still needs a separately
reviewed new version/tag/readiness/source candidate and all normal gates. Do not
republish the released `0.1.0-beta.1` from a later source revision or rerun its
completed workflow to update metadata.

Old `@bizyeet/ai-tools` bootstrap/trust/tag/failure history stays untouched and
confers no new-package authority. Hosted MCP has a separate private version,
build and deployment; this record neither publishes an npm MCP executable nor
activates that service. Live OAuth/read/tenant acceptance remains separate.

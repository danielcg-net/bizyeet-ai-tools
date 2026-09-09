# Required checks and fork validation

This is the BIZYEET-741 rollout checklist, not a claim that fork validation or
release authorization is complete. Re-read live protection before changing it.
The inspected `main` configuration on 2026-09-09 requires an up-to-date branch
and the four checks below; the package matrix is not yet required.

| Check context | Workflow | What it proves |
| --- | --- | --- |
| Test public scaffold | CI | TypeScript, immutable functional ESLint, unit contracts, workflow safety, canonical routing and offline documentation checks |
| Analyze JavaScript | CodeQL | JavaScript/TypeScript static analysis |
| Review dependency changes | Dependency Review | Dependency severity and license policy |
| Validate YouTrack delivery | YouTrack delivery policy | Branch, title, non-merge commit and PR-body tracking metadata, using the exact base revision's validator |

Canonical routing and documentation are currently covered inside the required
`Test public scaffold` check, not separate status contexts. Do not invent context
names when configuring protection. The existing Dependabot exception applies only
to delivery metadata, not the other checks.

## Package matrix promotion

Release Verification runs these additional contexts on pull requests:

- `Package (ubuntu-latest, Node 24)`
- `Package (ubuntu-latest, Node 26)`
- `Package (macos-latest, Node 24)`
- `Package (macos-latest, Node 26)`
- `Package (windows-latest, Node 24)`
- `Package (windows-latest, Node 26)`

Each builds and tests an installable package, SBOM and checksum bundle. A green
matrix does not authorize publication or prove trusted provenance. Before adding
these contexts to required checks, complete the representative external-fork
exercise below and record the observed names and producing application. Preserve
all existing protections and checks; do not replace the four-check set with only
the matrix. Bind checks to the expected producing application where supported,
using observed identifiers rather than guessed IDs.

## Representative external-fork exercise

Creating the real external-fork test contribution requires maintainer approval.
Use a tracked YouTrack issue and a harmless documentation-only change, never a
secret-exfiltration payload or production configuration.

1. Record the source fork, contributor, exact head/base revisions and PR URL in
   YouTrack. Confirm it is genuinely a different repository, not a same-repository
   branch. Use valid issue-prefixed branch, commit and title metadata and a matching
   YouTrack link in the body.
2. Inspect the complete diff at the exact current head before approving any
   first-contributor run, including executable source/scripts, package metadata,
   lockfile/dependency changes and workflows. Do not trust a stated documentation-only
   scope: installation and checks execute checked-out PR code. Unexpected executable
   or dependency changes require their own review. Do not assume another approval
   prompt will prevent a later push from executing. Use a maintainer-controlled
   external fork with no other writers or automation, and freeze the canary head
   throughout the exercise. A head change invalidates the inspection and evidence:
   stop the exercise, cancel its runs and review a new controlled head. Run approval
   is not the security boundary for untrusted commits; secret isolation, hosted
   runners and least privilege must hold independently.
   Confirm PR jobs use GitHub-hosted runners, no deployment environment, no
   repository/environment/organization secret references, and no persisted checkout
   credentials. Do not grant a write token or expose secrets to make a test pass.
3. Record each current-head job's conclusion, exact context, runner and effective
   permission evidence from the run. Check delivery validation loaded the exact
   base revision. Inspect repository Actions settings for fork-token/secret
   escalation; a green same-repository run does not prove fork isolation.
4. Require all four existing contexts and all six package jobs to finish green.
   Investigate missing, skipped or failed jobs. Do not mark a missing context as
   passed, disable policy, or merge the canary merely to unblock validation.
5. Save sanitized run links and the protection readback in YouTrack. Promote the
   verified matrix contexts through the reviewed repository configuration path,
   then verify strictness, existing checks and protections were preserved. Leave
   required checks unchanged if this exercise fails. Close the test contribution
   without merging unless its harmless change was separately approved for merge.

## Operations and ownership

Maintainers own failing checks and dependency/security alerts. Track fixes in
YouTrack; GitHub Issues are disabled. Dependabot updates still need green security,
architecture and package checks. Do not lower policy to clear a dependency alert.

CI, Release Verification, CodeQL, Dependency Review and delivery validation cancel
superseded runs in distinct workflow-specific PR/ref concurrency groups. A new run
for one PR cannot cancel another PR's run or a main-branch run through these keys.
Concurrency does not authorize release cancellation or publication. Job timeouts are
5 minutes for delivery, 10 for CI/dependency review, and 15 for CodeQL/package jobs.
Package artifacts expire after seven days. Workflow-log retention follows the
repository's live Actions retention setting, not that artifact value; record the
setting when collecting fork evidence. Never preserve credentials in evidence.

Publication and rollback remain separate gates described in
[release verification](release-verification.md).

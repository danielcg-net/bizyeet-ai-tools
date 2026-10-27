# Protected release environment setup

The release contract requires a GitHub `npm-release` environment with a human
approval gate. This helper prepares that narrow repository setting using the
existing authenticated GitHub CLI session. It does not log in, extract tokens,
change npm ownership/trusted publishers, configure secrets, alter main protection,
create tags/releases, or enable tenants. Merging the helper applies no settings.

From a clean reviewed checkout, with Node 24+ and GitHub CLI already available:

```sh
npm ci --ignore-scripts
npm run build
node dist/scripts/release-environment.js
```

The default only reads and prints a JSON plan. It verifies the current `/user`
is a human `User` with a numeric ID/login and administrator permission on the
exact public `danielcg-net/bizyeet-ai-tools` repository. That existing human is
the sole proposed reviewer; the helper grants nobody new repository access.
GitHub environment creation requires repository administration write access;
insufficient existing access stops rather than requesting or substituting a token.

After reviewing the plan and obtaining authorization for this settings change,
an operator can explicitly apply it:

```sh
node dist/scripts/release-environment.js --apply
```

The new gate requires that reviewer, permits self-review for the accepted
single-maintainer contract (`prevent_self_review:false`), disables admin bypass,
and uses only the custom `main` branch policy. Human approval is configured in
the initial environment request before the branch policy is created. The helper
rechecks identity/state before mutation and independently reads back both steps.
Before treating an environment 404 as absence, both planning and the immediate
pre-apply recheck require a complete bounded environment inventory with the target
absent. Repository admin role alone does not prove a token can read a particular
environment; denied, incomplete or conflicting inventory stops without a PUT.
An already correct environment is a no-op. Different reviewers, bypass/self-review
settings, nonzero timers, extra protection rules, branches/tags or incomplete
policy pagination stop the operation; existing environment settings are never
updated, weakened or deleted. Harmless API-owned metadata and a zero wait timer
are permitted.

If creation stops between steps, preserve the human gate. Inspect the exact
environment ID reported in the failure, confirm it is the known partial creation,
then preview the narrowly scoped recovery:

```sh
node dist/scripts/release-environment.js --resume-environment-id 123
# Only after the plan is reviewed and the settings action is authorized:
node dist/scripts/release-environment.js --apply --resume-environment-id 123
```

Recovery adds only a missing `main` branch policy to an otherwise exact gate
with that ID. It never PUTs an existing environment or deletes another policy.
An unverified outcome may already be complete (for example, a lost POST
response); a later exact readback verifies it as unchanged without another write.
Do not run concurrent setup/admin settings changes: GitHub's environment PUT is
an upsert with no create-only transaction, so a concurrent administrator can
race the absence recheck. Unexpected readback stops without automatic rollback
or retry; inspect the live setting before any further action.

This configures an approval mechanism, not approval for a release. npm bootstrap,
publisher configuration and the reviewed readiness record remain separate gates.
Approve publication only after reviewing the exact source/run/tag/version/digest,
matrix, installed smoke and cryptographic provenance evidence described in the
[release contract](plans/bizyeet-1188-release-contract.md). A verify-only candidate
or a successful environment readback is never evidence of npm publication.

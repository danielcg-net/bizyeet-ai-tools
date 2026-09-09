# YouTrack PR-body delivery link

The delivery workflow passes the GitHub event's PR body to the TypeScript
validator after the exact authenticated Dependabot exception. Human PRs require
an HTTPS URL on bizyeet.youtrack.cloud whose issue path matches the branch issue.
Labels, wrong issue IDs, lookalike hosts, credentials and nonstandard ports do not
satisfy the requirement. This is offline metadata validation, not a network lookup
or proof that an issue exists. Never add YouTrack credentials to fork workflows.
Marked's GFM lexer supplies actual destinations, including reference/autolinks;
link labels, code, images, unused definitions and HTML are not tracking links.
Require an explicit HTTPS authority before URL normalization; relative HTTPS
destinations can otherwise resolve against GitHub instead of YouTrack.

PR23 landed the helper on main before trusted-base wiring. The workflow checks
out the exact event base SHA into trusted-policy, installs its locked dependencies
with lifecycle scripts disabled, tests/builds there, and imports only that helper.
There is no PR-head fallback. PR-local validator/dependency edits cannot redefine
this invocation. This does not make PR-controlled workflow YAML independently
trusted: workflow edits still require repository protections and trusted review.

# YouTrack PR-body delivery link

The delivery workflow passes the GitHub event's PR body to the TypeScript
validator after the exact authenticated Dependabot exception. Human PRs require
an HTTPS URL on bizyeet.youtrack.cloud whose issue path matches the branch issue.
Labels, wrong issue IDs, lookalike hosts, credentials and nonstandard ports do not
satisfy the requirement. This is offline metadata validation, not a network lookup
or proof that an issue exists. Never add YouTrack credentials to fork workflows.

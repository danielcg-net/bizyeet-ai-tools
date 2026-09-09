# Contributing

Thanks for helping improve BizYeet AI Tools.

## Before opening a pull request

1. Obtain a BizYeet YouTrack issue from a maintainer for the proposed change.
2. Use a branch such as `bizyeet-123/short-title`; the pull-request title must
   begin `BIZYEET-123: ` and every non-merge commit must begin `bizyeet-123: `.
   Include the matching canonical issue URL in the PR body, for example
   `[BIZYEET-123](https://bizyeet.youtrack.cloud/issue/BIZYEET-123)`.
   CI validates the link locally without requiring contributors' YouTrack credentials.
3. Run `npm run check`.
4. Do not include tenant data, credentials, copied production configuration, or
   code from BizYeet private repositories.

BizYeet YouTrack is the delivery system of record. External contributors who
need an issue identifier should request one from a maintainer; GitHub Issues
are disabled for this repository.

The authenticated `dependabot[bot]` account is the only exception to the
delivery-identifier rule. Its dependency update PRs remain subject to all
security, test, and review checks.

## Pull request expectations

- Keep changes small and explain the user-visible or security impact.
- Add or update tests for behavior changes.
- Do not modify release, deployment, or security workflows to broaden token
  permissions, run fork code in privileged contexts, or expose secrets.
- Use imperative commit messages with the matching issue prefix before opening
  the PR; missing identifiers are not deferred until acceptance.

## Local development

Use Node.js 24 or newer and run the commands in the README.

`npm run check:docs` verifies tracked public Markdown's local file/image targets,
JSON code fences and documented `npm run` script names. It is part of the full
PR and release checks. Links are not fetched and documentation commands are never
executed. External availability, fragment anchors, full JSON-schema validation
and arbitrary CLI example behavior require separate review/contract tests.
Checked shell examples must use literal package script names (quoted names are
supported), without options before the name or environment-dependent names.
Option-prefixed npm invocations are explicitly unsupported by the static checker,
except standalone version/help flags; use direct commands in checked examples.
Fence metadata after the language does not opt out of example validation.
Only direct command positions are checked, not echoed examples or output.
Console fences support a `$ ` prompt; wrappers, environment-prefix assignments,
and other prompt formats need separate review rather than this static check.
When a console fence uses that prompt, unprompted output is ignored. Literal
heredoc delimiters are tracked so payload lines are not treated as commands;
command checking resumes after the terminator. This does not evaluate shell
expansions or command substitutions.

## Canonical business routing

Tenant data consumers must use OAuth-authorized canonical agent endpoints or the
hosted MCP contract. Provider selection belongs to the server application service.
Do not import server storage/provider implementations or call provider APIs directly;
do not substitute dashboard session endpoints for bearer-authorized agent operations.

`npm run check` includes `check:routing`. It parses source and executable scripts
without executing them, rejecting prohibited imports/re-exports/dynamic imports,
provider URLs and legacy business routes. Literal values, templates, concatenations
and uniquely named local constants are inspected independently of HTTP wrapper names.
Negative fixtures live in `scripts/check-canonical-routing.test.ts`; extend them when
adding a transport or endpoint convention. Existing TypeScript immutability rules
remain required. The checker itself and test fixture files are excluded from runtime
scanning; no production consumer has an exemption.

This check covers statically identifiable edges. Server authorization and provider
routing remain mandatory for direct requests and cannot be replaced by a source
check. Dynamically constructed destinations need explicit contract tests in addition
to these checks. BIZYEET-804 also tracks enforcement in the private server repository;
passing this public check alone does not close that issue.

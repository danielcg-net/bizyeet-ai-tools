# Contributing

Thanks for helping improve BizYeet AI Tools.

## Before opening a pull request

1. Open or reference a GitHub issue describing the proposed public change.
2. Fork the repository and use a focused branch such as `issue-123-short-title`.
3. Run `npm run check`.
4. Do not include tenant data, credentials, copied production configuration, or
   code from BizYeet private repositories.

Maintainers triage accepted public work into BizYeet's private delivery system
before merge. External contributors do not need access to that system.

## Pull request expectations

- Keep changes small and explain the user-visible or security impact.
- Add or update tests for behavior changes.
- Do not modify release, deployment, or security workflows to broaden token
  permissions, run fork code in privileged contexts, or expose secrets.
- Use conventional, imperative commit messages. Maintainers add internal
  delivery references when the work is accepted.

## Local development

Use Node.js 24 or newer and run the commands in the README.

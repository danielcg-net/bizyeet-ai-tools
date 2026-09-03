# Contributing

Thanks for helping improve BizYeet AI Tools.

## Before opening a pull request

1. Obtain a BizYeet YouTrack issue from a maintainer for the proposed change.
2. Use a branch such as `bizyeet-123/short-title`; the pull-request title must
   begin `BIZYEET-123: ` and every non-merge commit must begin `bizyeet-123: `.
3. Run `npm run check`.
4. Do not include tenant data, credentials, copied production configuration, or
   code from BizYeet private repositories.

BizYeet YouTrack is the delivery system of record. External contributors who
need an issue identifier should request one from a maintainer; GitHub Issues
are disabled for this repository.

## Pull request expectations

- Keep changes small and explain the user-visible or security impact.
- Add or update tests for behavior changes.
- Do not modify release, deployment, or security workflows to broaden token
  permissions, run fork code in privileged contexts, or expose secrets.
- Use conventional, imperative commit messages. Maintainers add internal
  delivery references when the work is accepted.

## Local development

Use Node.js 24 or newer and run the commands in the README.

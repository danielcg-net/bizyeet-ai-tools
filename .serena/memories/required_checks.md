# Required checks rollout

`docs/required-checks.md` maps the four existing required contexts to their actual
coverage and lists the six package-matrix contexts awaiting promotion. It records
the 2026-09-09 inspection, not a timeless live-state assertion. Re-read protection
before any mutation. Real external-fork validation needs explicit maintainer
approval and sanitized current-head run/permission evidence before promotion.
Keep the existing checks and security protections; never weaken fork permissions
or treat a same-repository green run as external-fork proof. Publication is separate.

All five PR workflows have distinct per-workflow PR/ref cancellation groups.
`scripts/release-workflow.test.ts` checks the exact group expressions, cancellation
flags and cross-workflow uniqueness. Do not share a group with privileged release
work or replace PR identity with a fork-controlled branch name.

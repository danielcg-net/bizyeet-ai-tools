# Trusted-base validator prerequisite

This additive change lands the PR-body helper and pinned Markdown parser on main
before PR21 changes its workflow to load validation from the exact base SHA.
Existing branch/title/commit checks and the exact Dependabot exception remain
unchanged. No workflow enforcement is removed, and PR21's existing body check
is retained while the trusted-source finding remains open.

This prerequisite alone does not enforce PR-body links in the main workflow.
After merge, reconcile PR21 with main, use a separate base-SHA checkout/build/import,
and add a regression proving a modified PR validator cannot change the result.
Keep PR21 unmerged until that wiring and independent review are complete.

# Repository-level action pinning

Maintainers use `npm run security:actions` to inspect the public repository's
GitHub Actions policy through their existing authenticated `gh` session. The
default is read-only. This is an administrative script, not tenant CLI auth;
never supply tenant OAuth credentials or run it in a pull-request workflow.

After review and confirming every workflow action uses a full commit SHA, run
`npm run security:actions -- --apply`. The fixed repository target is
`danielcg-net/bizyeet-ai-tools`. It enables only `sha_pinning_required`, preserves
the enabled and allowed-actions settings, and reads back the policy to verify.
Existing selected-action patterns are not modified. It does not alter branch
protection, environments, secrets, review requirements or package publication.

Every request explicitly selects `--hostname github.com`; an Enterprise
`GH_HOST` setting cannot redirect inspection or application to another host.

Coordinate with other administrators: this read/update/read sequence is not an
atomic compare-and-swap. An update or verification failure is reported without
automatic retries or rollback. Inspect the actual policy before trying again.

GitHub's enforcement complements the source policy tests; it does not replace
fork validation, least privilege, review, or canonical-routing checks. A passing
local test does not prove the remote setting is enabled. Record the actual
read-back and subsequent hosted CI evidence in BIZYEET-741.

See the official [Actions permissions API](https://docs.github.com/en/rest/actions/permissions).

import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedDependabotAuthor, validateCommitMessages, validatePullRequestMetadata } from "./validate-youtrack-delivery-policy.js";

void test("accepts matching branch, title, and commit identifiers", (): void => {
  const metadata = validatePullRequestMetadata({ branch: "bizyeet-740/enforce-delivery-policy", title: "BIZYEET-740: Enforce delivery policy" });

  assert.deepEqual(metadata, { errors: [], issueId: "bizyeet-740" });
  assert.deepEqual(validateCommitMessages("bizyeet-740", [{ sha: "abc1234", commit: { message: "bizyeet-740: add policy" }, parents: [{}] }]), []);
});

void test("rejects malformed branch names, title identifiers, and unprefixed commits", (): void => {
  assert.equal(validatePullRequestMetadata({ branch: "feature/policy", title: "BIZYEET-740: Policy" }).issueId, null);
  assert.deepEqual(validatePullRequestMetadata({ branch: "bizyeet-740/policy", title: "BIZYEET-741: Policy" }).errors, ["PR title must start with 'BIZYEET-740: '."]);
  assert.match(validateCommitMessages("bizyeet-740", [{ sha: "abc1234", commit: { message: "wrong subject" }, parents: [{}] }])[0] ?? "", /abc1234 \(wrong subject\)/u);
});

void test("exempts only the authenticated Dependabot service account", (): void => {
  assert.equal(isTrustedDependabotAuthor("dependabot[bot]"), true);
  assert.equal(isTrustedDependabotAuthor("dependabot"), false);
  assert.equal(isTrustedDependabotAuthor("dependabot[bot] "), false);
  assert.equal(isTrustedDependabotAuthor("mallory"), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedDependabotAuthor, validateCommitMessages, validatePullRequestBody, validatePullRequestMetadata } from "./validate-youtrack-delivery-policy.js";

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

void test("accepts canonical issue links in Markdown or plain text", () => {
  [
    "https://bizyeet.youtrack.cloud/issue/BIZYEET-741",
    "Tracked in [YouTrack](https://bizyeet.youtrack.cloud/issue/bizyeet-741).",
    "<https://bizyeet.youtrack.cloud/issue/BIZYEET-741>",
    "https://bizyeet.youtrack.cloud/issue/BIZYEET-741/#focus=Comments",
    "Tracked at https://bizyeet.youtrack.cloud/issue/BIZYEET-741.",
    "Tracked at https://bizyeet.youtrack.cloud/issue/BIZYEET-741, with details.",
    "[Work][issue]\n\n[issue]: https://bizyeet.youtrack.cloud/issue/BIZYEET-741",
  ].forEach((body) => { assert.deepEqual(validatePullRequestBody("bizyeet-741", body), []); });
});

void test("rejects absent, wrong-issue and deceptive tracking links", () => {
  [
    undefined, null, {}, "", "BIZYEET-741",
    "https://bizyeet.youtrack.cloud/issue/BIZYEET-740",
    "https://bizyeet.youtrack.cloud/issue/BIZYEET-7410",
    "https://bizyeet.youtrack.cloud/issue/BIZYEET-741/other",
    "http://bizyeet.youtrack.cloud/issue/BIZYEET-741",
    "https://bizyeet.youtrack.cloud.evil.example/issue/BIZYEET-741",
    "https://bizyeet.youtrack.cloud@evil.example/issue/BIZYEET-741",
    "https://user@bizyeet.youtrack.cloud/issue/BIZYEET-741",
    "https://bizyeet.youtrack.cloud:8443/issue/BIZYEET-741",
    "https://example.com/?next=https://bizyeet.youtrack.cloud/issue/BIZYEET-741",
    "[https://bizyeet.youtrack.cloud/issue/BIZYEET-741](https://example.com)",
    "[ https://bizyeet.youtrack.cloud/issue/BIZYEET-741 ](https://evil.example)",
    "[ https://bizyeet.youtrack.cloud/issue/BIZYEET-741 ][bad]\n\n[bad]: https://evil.example",
    "`https://bizyeet.youtrack.cloud/issue/BIZYEET-741`",
    "```\nhttps://bizyeet.youtrack.cloud/issue/BIZYEET-741\n```",
    "<!-- https://bizyeet.youtrack.cloud/issue/BIZYEET-741 -->",
    "![image](https://bizyeet.youtrack.cloud/issue/BIZYEET-741)",
    "[unused]: https://bizyeet.youtrack.cloud/issue/BIZYEET-741",
    "https://[invalid/issue/BIZYEET-741",
  ].forEach((body) => { assert.equal(validatePullRequestBody("bizyeet-741", body).length, 1); });
});

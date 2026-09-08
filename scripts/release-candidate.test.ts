import assert from "node:assert/strict";
import test from "node:test";
import { releaseCandidateErrors, releaseVersion } from "./release-candidate.js";

const candidate = (): Parameters<typeof releaseCandidateErrors>[0] => ({
  metadata: { name: "@bizyeet/ai-tools", version: "0.1.0-rc.1", private: false, publishConfig: { access: "public" } },
  lockfile: { lockfileVersion: 3, name: "@bizyeet/ai-tools", version: "0.1.0-rc.1", packages: { "": { name: "@bizyeet/ai-tools", version: "0.1.0-rc.1" } } },
  changelog: "# Changelog\n\n## [0.1.0-rc.1] - 2026-09-08\n\n- Verify tenant-authorized read commands.\n",
  tag: "v0.1.0-rc.1",
});

void test("accepts consistent explicitly publishable release metadata", () => {
  assert.deepEqual(releaseCandidateErrors(candidate()), []);
});

void test("rejects private development packages, stale locks, wrong tags and absent notes", () => {
  const input = candidate();
  assert.ok(releaseCandidateErrors({ ...input, metadata: { name: "@bizyeet/ai-tools", version: "0.0.0-development", private: true } }).length >= 4);
  assert.ok(releaseCandidateErrors({ ...input, lockfile: {} }).some((error) => error.includes("lockfile")));
  assert.ok(releaseCandidateErrors({ ...input, tag: "v0.2.0" }).some((error) => error.includes("tag")));
  assert.ok(releaseCandidateErrors({ ...input, changelog: "# Unreleased" }).some((error) => error.includes("changelog")));
});

void test("rejects ambiguous, invalid and placeholder changelog entries", () => {
  const input = candidate();
  assert.ok(releaseCandidateErrors({ ...input, changelog: input.changelog.repeat(2) }).length > 0);
  assert.ok(releaseCandidateErrors({ ...input, changelog: input.changelog.replace("2026-09-08", "2026-02-30") }).length > 0);
  assert.ok(releaseCandidateErrors({ ...input, changelog: input.changelog.replace("Verify tenant-authorized read commands.", "TODO fill in release notes.") }).length > 0);
});

void test("requires explicit publication intent and consistent package identity at both lock roots", () => {
  const input = candidate();
  const metadata = { name: "@bizyeet/ai-tools", version: "0.1.0-rc.1", private: false, publishConfig: { access: "public" } };
  assert.ok(releaseCandidateErrors({ ...input, metadata: { ...metadata, private: undefined } }).some((error) => error.includes("explicitly enabled")));
  assert.ok(releaseCandidateErrors({ ...input, metadata: { ...metadata, publishConfig: { access: "restricted" } } }).some((error) => error.includes("Public package access")));
  assert.ok(releaseCandidateErrors({ ...input, metadata: { ...metadata, name: "unexpected" } }).some((error) => error.includes("package name")));
  const lockfile = { lockfileVersion: 3, name: "@bizyeet/ai-tools", version: "0.1.0-rc.1", packages: { "": { name: "@bizyeet/ai-tools", version: "0.0.1" } } };
  assert.ok(releaseCandidateErrors({ ...input, lockfile }).some((error) => error.includes("lockfile")));
  assert.ok(releaseCandidateErrors({ ...input, metadata: null, lockfile: [] }).length > 0);
});

void test("validates numeric prerelease identifiers without forbidding alphanumeric ones", () => {
  ["0.1.0", "1.2.3-rc.0", "1.2.3-01a", "1.2.3-alpha-beta.123"].forEach((version) => { assert.equal(releaseVersion(version), true); });
  ["0.0.0", "0.0.0-development", "01.2.3", "1.2", "v1.2.3", "1.2.3-01", "1.2.3-rc..1", "1.2.3+build", "1.2.3\n", "1.2.3/other"].forEach((version) => { assert.equal(releaseVersion(version), false); });
});

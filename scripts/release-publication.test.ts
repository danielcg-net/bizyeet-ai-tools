import assert from "node:assert/strict";
import test from "node:test";
import { readinessErrors } from "./release-publication.js";

const readiness = (): Readonly<Record<string, unknown>> => ({schema_version: 1, repository: "danielcg-net/bizyeet-ai-tools", package: "@bizyeet/ai-tools", version: "0.1.0-beta.1", tag: "v0.1.0-beta.1", workflow: "release.yml", environment: "npm-release", maintainer: {login: "maintainer", ownership_evidence_url: "https://example.test/ownership", publisher_evidence_url: "https://example.test/oidc", confirmed_at: new Date().toISOString(), publisher: {direct_publish_allowed: true, trust_configured_at: new Date().toISOString(), first_publish_succeeded: false}, prevent_self_review: false, reviewer_ids: [123]}});
void test("ownership attestation never substitutes for actual protected human environment", (): void => {
  assert.deepEqual(readinessErrors(readiness(), "0.1.0-beta.1"), []);
  assert.ok(readinessErrors(null, "0.1.0-beta.1").length > 0);
  assert.ok(readinessErrors(readiness(), "0.1.0-beta.2").length > 0);
  assert.ok(readinessErrors({...readiness(), workflow: "other.yml"}, "0.1.0-beta.1").length > 0);
  assert.ok(readinessErrors({...readiness(), maintainer: {login: "name"}}, "0.1.0-beta.1").length > 0);
  assert.ok(readinessErrors({...readiness(), maintainer: {login: "name", publisher: {direct_publish_allowed: false}}}, "0.1.0-beta.1").length > 0);
});

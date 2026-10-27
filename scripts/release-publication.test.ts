import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readinessErrors } from "./release-publication.js";

void test("the reviewed CLI record validates the verified first OIDC success and original time bound", async (): Promise<void> => {
  const value: unknown = JSON.parse(await readFile(new URL("../../scripts/release-readiness.json", import.meta.url), "utf8"));
  assert.deepEqual(readinessErrors(value, "0.1.0-beta.1"), []);
  const record = value as Readonly<{maintainer: Readonly<{publisher: Readonly<{first_publish_succeeded: boolean; trust_configured_at: string}>}>}>;
  assert.equal(record.maintainer.publisher.first_publish_succeeded, true);
  assert.equal(record.maintainer.publisher.trust_configured_at, "2026-10-27T21:47:02Z");
});

const readiness = (): Readonly<Record<string, unknown>> => ({schema_version: 1, repository: "danielcg-net/bizyeet-ai-tools", package: "@bizyeet/cli", version: "0.1.0-beta.1", tag: "cli-v0.1.0-beta.1", workflow: "release-cli.yml", environment: "npm-release", maintainer: {login: "maintainer", ownership_evidence_url: "https://example.test/ownership", publisher_evidence_url: "https://example.test/oidc", confirmed_at: new Date().toISOString(), publisher: {direct_publish_allowed: true, trust_configured_at: new Date().toISOString(), first_publish_succeeded: false}, prevent_self_review: false, reviewer_ids: [123]}});
void test("ownership attestation never substitutes for actual protected human environment", (): void => {
  assert.deepEqual(readinessErrors(readiness(), "0.1.0-beta.1"), []);
  assert.ok(readinessErrors(null, "0.1.0-beta.1").length > 0);
  assert.ok(readinessErrors(readiness(), "0.1.0-beta.2").length > 0);
  assert.ok(readinessErrors({...readiness(), workflow: "other.yml"}, "0.1.0-beta.1").length > 0);
  assert.ok(readinessErrors({...readiness(), workflow: "release.yml"}, "0.1.0-beta.1").length > 0);
  assert.ok(readinessErrors({...readiness(), package: "@bizyeet/ai-tools", tag: "v0.1.0-beta.1", workflow: "release.yml"}, "0.1.0-beta.1").length > 0);
  assert.ok(readinessErrors({...readiness(), maintainer: {login: "name"}}, "0.1.0-beta.1").length > 0);
  assert.ok(readinessErrors({...readiness(), maintainer: {login: "name", publisher: {direct_publish_allowed: false}}}, "0.1.0-beta.1").length > 0);
});

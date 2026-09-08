import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { actionPolicy, enforceActionPinning } from "./repository-action-pinning.js";

const policy = (pinned = false, allowed = "selected", enabled = true): string => JSON.stringify({
  enabled, allowed_actions: allowed, sha_pinning_required: pinned,
});

void test("inspection is read-only and already enforced policy needs no write", async () => {
  const inspect = mock.fn(() => Promise.resolve(policy()));
  assert.equal((await enforceActionPinning(inspect, false)).changed, false);
  assert.equal(inspect.mock.callCount(), 1);
  const enforced = mock.fn(() => Promise.resolve(policy(true)));
  assert.equal((await enforceActionPinning(enforced, true)).changed, false);
  assert.equal(enforced.mock.callCount(), 1);
});

void test("only enables SHA pinning and preserves each allowed policy and disabled Actions", async () => {
  await Promise.all(["all", "local_only", "selected"].map(async (allowed) => {
    const github = mock.fn<(args: readonly string[]) => Promise<string>>(() => Promise.resolve(policy(true, allowed, false)));
    github.mock.mockImplementationOnce(() => Promise.resolve(policy(false, allowed, false)));
    const result = await enforceActionPinning(github, true);
    assert.deepEqual(result, { changed: true, policy: actionPolicy(policy(true, allowed, false)) });
    assert.deepEqual(github.mock.calls[1]?.arguments[0], ["api", "repos/danielcg-net/bizyeet-ai-tools/actions/permissions", "--method", "PUT",
      "-F", "enabled=false", "-f", `allowed_actions=${allowed}`, "-F", "sha_pinning_required=true"]);
    assert.equal(github.mock.callCount(), 3);
  }));
});

void test("rejects missing or malformed settings before any write", async () => {
  await Promise.all(["null", "{}", "[]", "invalid", policy(false, "unknown"),
    '{"enabled":true,"allowed_actions":"all","sha_pinning_required":"false"}',
    '{"enabled":true,"allowed_actions":["all"],"sha_pinning_required":false}',
  ].map(async (source) => {
    const github = mock.fn(() => Promise.resolve(source));
    await assert.rejects(enforceActionPinning(github, true));
    assert.equal(github.mock.callCount(), 1);
  }));
});

void test("reports failed verification without retrying or restoring policy automatically", async () => {
  const github = mock.fn(() => Promise.resolve(policy()));
  await assert.rejects(enforceActionPinning(github, true), /verification failed/u);
  assert.equal(github.mock.callCount(), 3);
});

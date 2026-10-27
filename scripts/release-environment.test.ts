import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { releaseEnvironmentArguments, releaseEnvironmentResponse, setupReleaseEnvironment } from "./release-environment.js";

const actor = (): unknown => ({ id: 123, login: "maintainer", type: "User" });
const repo = (): unknown => ({ full_name: "danielcg-net/bizyeet-ai-tools", private: false, permissions: { admin: true } });
const gate = (overrides: Record<string, unknown> = {}): unknown => ({ id: 456, name: "npm-release", can_admins_bypass: false,
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  protection_rules: [{ id: 11, type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: actor() }] }, { id: 12, type: "branch_policy" }],
  node_id: "api-owned", updated_at: "2026-10-27T00:00:00Z", ...overrides });
const policy = (): unknown => ({ id: 789, name: "main", type: "branch", node_id: "api-owned" });
const response = (data: unknown, status = 200): Readonly<{ data: unknown; status: number }> => ({ data, status });
const snapshot = (value: unknown = gate(), entries: readonly unknown[] = [policy()]): readonly ReturnType<typeof response>[] => [response(actor()), response(repo()), ...(value === null ? [response({ message: "Not Found" }, 404)] : [response(value), response({ total_count: entries.length, branch_policies: entries })])];
type Request = Readonly<{ method: "GET" | "PUT" | "POST"; path: string; body?: unknown }>;
const client = (responses: readonly (ReturnType<typeof response> | Error)[]): ReturnType<typeof mock.fn<(request: Request) => Promise<ReturnType<typeof response>>>> => {
  const github: ReturnType<typeof mock.fn<(request: Request) => Promise<ReturnType<typeof response>>>> = mock.fn<(request: Request) => Promise<ReturnType<typeof response>>>((): Promise<ReturnType<typeof response>> => {
    const next = responses[github.mock.callCount()];
    return next instanceof Error ? Promise.reject(next) : next ? Promise.resolve(next) : Promise.reject(new Error("Unexpected request"));
  });
  return github;
};
const writes = (github: ReturnType<typeof client>): readonly Request[] => github.mock.calls.map((call) => call.arguments[0]).filter((request) => request.method !== "GET");

void test("default mode plans absent environment with no writes, and existing exact gate is idempotent", async () => {
  const absent = client(snapshot(null));
  assert.deepEqual(await setupReleaseEnvironment(absent), { changed: false, plan: { action: "create", reviewer: { id: 123, login: "maintainer" }, environment_id: null } });
  assert.deepEqual(writes(absent), []);
  const existing = client(snapshot());
  assert.equal((await setupReleaseEnvironment(existing, true)).plan.action, "unchanged");
  assert.deepEqual(writes(existing), []);
});

void test("creates reviewer gate before main policy and independently verifies both readbacks", async () => {
  const github = client([...snapshot(null), ...snapshot(null), response(gate()), ...snapshot(gate(), []), response(policy()), ...snapshot()]);
  const result = await setupReleaseEnvironment(github, true);
  assert.equal(result.changed, true);
  assert.equal(result.plan.environment_id, 456);
  assert.deepEqual(writes(github), [
    { method: "PUT", path: "repos/danielcg-net/bizyeet-ai-tools/environments/npm-release", body: { wait_timer: 0, prevent_self_review: false, can_admins_bypass: false, reviewers: [{ type: "User", id: 123 }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } } },
    { method: "POST", path: "repos/danielcg-net/bizyeet-ai-tools/environments/npm-release/deployment-branch-policies", body: { name: "main", type: "branch" } },
  ]);
});

void test("partial recovery requires the recorded exact ID, adds only main, and never PUTs existing environment", async () => {
  const unknown = client(snapshot(gate(), []));
  await assert.rejects(setupReleaseEnvironment(unknown, true), /known partial/u);
  assert.deepEqual(writes(unknown), []);
  const wrong = client(snapshot(gate(), []));
  await assert.rejects(setupReleaseEnvironment(wrong, true, 999), /Resume ID/u);
  assert.deepEqual(writes(wrong), []);
  const resumed = client([...snapshot(gate(), []), ...snapshot(gate(), []), ...snapshot(gate(), []), response(policy()), ...snapshot()]);
  assert.equal((await setupReleaseEnvironment(resumed, true, 456)).plan.action, "resume");
  assert.deepEqual(writes(resumed).map((request) => request.method), ["POST"]);
  const planOnly = client(snapshot(gate(), []));
  assert.equal((await setupReleaseEnvironment(planOnly, false, 456)).changed, false);
  assert.deepEqual(writes(planOnly), []);
});

void test("preserves incompatible and unexpected effective policies without any mutation", async () => {
  const values = [
    gate({ name: "other" }), gate({ id: 0 }), gate({ can_admins_bypass: true }), gate({ can_admins_bypass: undefined }),
    gate({ deployment_branch_policy: null }), gate({ deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }),
    gate({ protection_rules: [] }),
    gate({ protection_rules: [{ type: "required_reviewers", prevent_self_review: true, reviewers: [{ type: "User", reviewer: actor() }] }] }),
    gate({ protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "Team", reviewer: actor() }] }] }),
    gate({ protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { id: 124, login: "other", type: "User" } }] }] }),
    gate({ protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: actor() }] }, { type: "wait_timer", wait_timer: 1 }] }),
    gate({ protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: actor() }] }, { type: "custom_protection_rule" }] }),
  ];
  await Promise.all(values.map(async (value) => {
    const github = client(snapshot(value));
    await assert.rejects(setupReleaseEnvironment(github, true));
    assert.deepEqual(writes(github), []);
  }));
  await Promise.all([[{ id: 1, name: "main", type: "tag" }], [{ id: 1, name: "*", type: "branch" }], [policy(), policy()]].map(async (entries) => {
    const github = client(snapshot(gate(), entries));
    await assert.rejects(setupReleaseEnvironment(github, true), /polic/u);
    assert.deepEqual(writes(github), []);
  }));
});

void test("accepts API-owned metadata, optional branch marker and harmless zero wait timer", async () => {
  const rules = [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: actor() }] }, { type: "wait_timer", wait_timer: 0 }];
  const github = client(snapshot(gate({ protection_rules: rules })));
  assert.equal((await setupReleaseEnvironment(github, true)).changed, false);
});

void test("rejects wrong actor, repository or authority and never interprets unrelated errors as absence", async () => {
  await Promise.all([null, { id: 123, login: "robot", type: "Bot" }, { id: 0, login: "human", type: "User" }].map(async (value) => {
    const github = client([response(value)]);
    await assert.rejects(setupReleaseEnvironment(github, true), /human/u);
    assert.deepEqual(writes(github), []);
  }));
  await Promise.all([{ full_name: "other/repo", private: false, permissions: { admin: true } }, { full_name: "danielcg-net/bizyeet-ai-tools", private: true, permissions: { admin: true } }, { full_name: "danielcg-net/bizyeet-ai-tools", private: false, permissions: { admin: false } }].map(async (value) => {
    const github = client([response(actor()), response(value)]);
    await assert.rejects(setupReleaseEnvironment(github, true), /administer/u);
    assert.deepEqual(writes(github), []);
  }));
  await Promise.all([response({}, 403), response({}, 404), response({}, 500)].map(async (value) => {
    const github = client([response(actor()), response(repo()), value]);
    await assert.rejects(setupReleaseEnvironment(github, true));
    assert.deepEqual(writes(github), []);
  }));
});

void test("identity/state recheck prevents writes after concurrent changes", async () => {
  const github = client([...snapshot(null), ...snapshot()]);
  await assert.rejects(setupReleaseEnvironment(github, true), /changed since planning/u);
  assert.deepEqual(writes(github), []);
});

void test("creation failure leaves human gate and reports exact partial ID, without destructive recovery", async () => {
  const github = client([...snapshot(null), ...snapshot(null), response(gate()), ...snapshot(gate(), []), new Error("network failed")]);
  await assert.rejects(setupReleaseEnvironment(github, true), /environment 456.*--apply --resume-environment-id 456/u);
  assert.deepEqual(writes(github).map((request) => request.method), ["PUT", "POST"]);
  const failedReadback = client([...snapshot(null), ...snapshot(null), response(gate()), ...snapshot(gate(), []), response(policy()), ...snapshot(gate({ can_admins_bypass: true }))]);
  await assert.rejects(setupReleaseEnvironment(failedReadback, true), /Setup incomplete/u);
  assert.deepEqual(writes(failedReadback).map((request) => request.method), ["PUT", "POST"]);
});

void test("malformed or truncated policy pagination never authorizes recovery", async () => {
  const github = client([response(actor()), response(repo()), response(gate()), response({ total_count: 2, branch_policies: [] })]);
  await assert.rejects(setupReleaseEnvironment(github, true, 456), /incomplete/u);
  assert.deepEqual(writes(github), []);
});

void test("CLI requires explicit apply and rejects unsupported flags/IDs before requests", () => {
  assert.deepEqual(releaseEnvironmentArguments([]), { apply: false });
  assert.deepEqual(releaseEnvironmentArguments(["--apply"]), { apply: true });
  assert.deepEqual(releaseEnvironmentArguments(["--resume-environment-id", "456"]), { apply: false, resumeId: 456 });
  assert.deepEqual(releaseEnvironmentArguments(["--apply", "--resume-environment-id", "456"]), { apply: true, resumeId: 456 });
  [ ["--apply=true"], ["--repo", "other"], ["--apply", "--apply"], ["--resume-environment-id", "0"], ["--resume-environment-id", "NaN"], ["--resume-environment-id", "999999999999999999"] ].forEach((args) => { assert.throws(() => releaseEnvironmentArguments(args)); });
});

void test("HTTP parsing preserves only status/JSON and rejects malformed upstream envelopes", () => {
  assert.deepEqual(releaseEnvironmentResponse('HTTP/2.0 404 Not Found\r\nContent-Type: application/json\r\n\r\n{"message":"Not Found"}'), response({ message: "Not Found" }, 404));
  assert.throws(() => releaseEnvironmentResponse("unexpected diagnostics"), /invalid HTTP/u);
  assert.throws(() => releaseEnvironmentResponse("HTTP/2.0 200 OK\n\ninvalid json"), /invalid JSON/u);
});

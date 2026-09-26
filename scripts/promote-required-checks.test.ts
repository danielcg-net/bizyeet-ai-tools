import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { packageContexts, promoteRequiredChecks, requiredChecks, requiredChecksPlan } from "./promote-required-checks.js";

const base = (): unknown => ({ strict: true, checks: [
  { context: "Test public scaffold", app_id: null }, { context: "Analyze JavaScript", app_id: null },
  { context: "Review dependency changes", app_id: null }, { context: "Validate YouTrack delivery", app_id: 15368 },
] });
const promoted = (): unknown => ({ strict: true, checks: [...requiredChecks(base()).checks,
  ...packageContexts.map((context) => ({ context, app_id: 15368 }))] });

void test("plans only six observed package contexts and preserves the four existing checks", () => {
  const plan = requiredChecksPlan(requiredChecks(base()));
  assert.equal(plan.changed, true);
  assert.deepEqual(plan.checks.slice(0, 4), [
    { context: "Test public scaffold", app_id: -1 }, { context: "Analyze JavaScript", app_id: -1 },
    { context: "Review dependency changes", app_id: -1 }, { context: "Validate YouTrack delivery", app_id: 15368 },
  ]);
  assert.deepEqual(plan.checks.slice(4), packageContexts.map((context) => ({ context, app_id: 15368 })));
  assert.equal(requiredChecksPlan(requiredChecks(promoted())).changed, false);
});

void test("inspection never mutates and application verifies live readback", async () => {
  const inspect = mock.fn(() => Promise.resolve(base()));
  const dryRun = await promoteRequiredChecks(inspect, false);
  assert.equal(dryRun.changed, false);
  assert.deepEqual(dryRun.plannedChecks, requiredChecksPlan(requiredChecks(base())).checks);
  assert.equal(inspect.mock.callCount(), 1);
  const github = mock.fn<(method: "GET" | "PATCH", body?: unknown) => Promise<unknown>>(() => Promise.resolve(promoted()));
  github.mock.mockImplementationOnce(() => Promise.resolve(base()));
  const result = await promoteRequiredChecks(github, true);
  assert.equal(result.changed, true);
  assert.deepEqual(github.mock.calls.map((call) => call.arguments[0]), ["GET", "PATCH", "GET"]);
  assert.deepEqual(github.mock.calls[1]?.arguments[1], { strict: true, checks: requiredChecksPlan(requiredChecks(base())).checks });
});

void test("fails closed on weakened or malformed protection and unexpected package app", async () => {
  await Promise.all([null, {}, { strict: false, checks: [] }, { strict: true, checks: [] },
    { strict: true, checks: [...requiredChecks(base()).checks, { context: "Test public scaffold", app_id: 15368 }] },
    { strict: true, checks: [...requiredChecks(base()).checks, { context: packageContexts[0], app_id: 12 }] },
  ].map(async (value) => {
    const github = mock.fn(() => Promise.resolve(value));
    await assert.rejects(promoteRequiredChecks(github, true));
    assert.equal(github.mock.callCount(), 1);
  }));
});

void test("rejects a post-update readback that omits package bindings", async () => {
  const github = mock.fn<(method: "GET" | "PATCH", body?: unknown) => Promise<unknown>>((method) =>
    Promise.resolve(method === "PATCH" ? promoted() : base()));
  await assert.rejects(promoteRequiredChecks(github, true), /readback differs/u);
  assert.equal(github.mock.callCount(), 3);
});

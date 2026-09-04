import assert from "node:assert/strict";
import test from "node:test";

import { openLoopbackCallback } from "./loopback.js";

void test("accepts only the matching loopback authorization callback", async (): Promise<void> => {
  const callback = await openLoopbackCallback("matching-state");
  const response = await fetch(`${callback.redirectUri}?code=authorization-code&state=matching-state`);

  assert.equal(response.status, 200);
  assert.equal(await callback.awaitCode(), "authorization-code");
});

void test("rejects a callback whose state does not match the active browser login", async (): Promise<void> => {
  const callback = await openLoopbackCallback("matching-state");
  const code = callback.awaitCode();
  void code.catch(() => undefined);
  const response = await fetch(`${callback.redirectUri}?code=authorization-code&state=wrong-state`);

  assert.equal(response.status, 400);
  await assert.rejects(code, /did not match/u);
});

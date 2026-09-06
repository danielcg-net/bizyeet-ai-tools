import assert from "node:assert/strict";
import test from "node:test";

import { openLoopbackCallback } from "./loopback.js";

const expectedIssuer = "https://example.test";
[
  ["missing issuer", "code=code&state=matching-state"],
  ["wrong issuer", "code=code&state=matching-state&iss=https://other.test"],
  ["issuer trailing slash", "code=code&state=matching-state&iss=https://example.test/"],
  ["duplicate issuer", "code=code&state=matching-state&iss=https://example.test&iss=https://other.test"],
  ["duplicate state", "code=code&state=matching-state&state=other&iss=https://example.test"],
  ["duplicate code", "code=code&code=other&state=matching-state&iss=https://example.test"],
  ["code and error", "code=code&error=access_denied&state=matching-state&iss=https://example.test"],
  ["unbound error", "error=access_denied&state=matching-state&iss=https://other.test"],
].forEach(([label, query]): void => {
  void test(`rejects ${label ?? "invalid"} in authorization callbacks`, async (): Promise<void> => {
    const callback = await openLoopbackCallback("matching-state", expectedIssuer);
    const code = callback.awaitCode();
    void code.catch(() => undefined);
    const response = await fetch(`${callback.redirectUri}?${query ?? ""}`);
    assert.equal(response.status, 400);
    await assert.rejects(code, /did not match/u);
  });
});

void test("recognizes a denial only when state and issuer match", async (): Promise<void> => {
  const callback = await openLoopbackCallback("matching-state", expectedIssuer);
  const code = callback.awaitCode();
  void code.catch(() => undefined);
  const response = await fetch(`${callback.redirectUri}?error=access_denied&state=matching-state&iss=https://example.test`);
  assert.equal(response.status, 400);
  await assert.rejects(code, /was denied/u);
});

void test("accepts only the matching loopback authorization callback", async (): Promise<void> => {
  const callback = await openLoopbackCallback("matching-state", "https://example.test");
  const response = await fetch(`${callback.redirectUri}?code=authorization-code&state=matching-state&iss=https%3A%2F%2Fexample.test`);

  assert.equal(response.status, 200);
  assert.equal(await callback.awaitCode(), "authorization-code");
});

void test("rejects a callback whose state does not match the active browser login", async (): Promise<void> => {
  const callback = await openLoopbackCallback("matching-state", "https://example.test");
  const code = callback.awaitCode();
  void code.catch(() => undefined);
  const response = await fetch(`${callback.redirectUri}?code=authorization-code&state=wrong-state&iss=https%3A%2F%2Fexample.test`);

  assert.equal(response.status, 400);
  await assert.rejects(code, /did not match/u);
});

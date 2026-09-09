import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "node:net";
import { once } from "node:events";

import { openLoopbackCallback } from "./loopback.js";

const expectedIssuer = "https://example.test";

void test("malformed HTTP request targets fail without an uncaught URL exception", { timeout: 5000 }, async (): Promise<void> => {
  const callback = await openLoopbackCallback("matching-state", expectedIssuer);
  const socket = connect(Number(new URL(callback.redirectUri).port), "127.0.0.1");
  try {
    await once(socket, "connect");
    const received = once(socket, "data");
    socket.write("GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    const data: unknown = (await received)[0];
    assert.ok(Buffer.isBuffer(data));
    assert.match(data.toString("utf8"), /^HTTP\/1.1 400/u);
    await assert.rejects(callback.awaitCode(), /did not match/u);
    await assert.rejects(fetch(callback.redirectUri), /fetch failed/u);
  } finally { socket.destroy(); }
});

["code=code&state=wrong", "error=access_denied&state=matching-state"].forEach((query): void => {
  void test(`handles early callback rejection before awaiting the code: ${query}`, async (): Promise<void> => {
    const callback = await openLoopbackCallback("matching-state", expectedIssuer);
    const response = await fetch(`${callback.redirectUri}?${query}&iss=https://example.test`);
    assert.equal(response.status, 400);
    await response.text();
    // The HTTP round trip gives Node an opportunity to report an unhandled rejection.
    await assert.rejects(callback.awaitCode(), /denied|did not match/u);
    await assert.rejects(fetch(callback.redirectUri), /fetch failed/u);
  });
});

["code=authorization-code", "error=access_denied", "code=code&state=wrong"].forEach((query): void => {
  void test(`bounds shutdown with incomplete extra headers after ${query}`, { timeout: 5000 }, async (): Promise<void> => {
    const callback = await openLoopbackCallback("matching-state", expectedIssuer);
    const socket = connect(Number(new URL(callback.redirectUri).port), "127.0.0.1");
    try {
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
      const closed = once(socket, "close");
      const code = callback.awaitCode();
      const outcome = query.startsWith("code=authorization")
        ? code.then((value): void => { assert.equal(value, "authorization-code"); })
        : assert.rejects(code, /denied|did not match/u);
      const response = await fetch(`${callback.redirectUri}?${query}&state=matching-state&iss=https://example.test`);
      await response.text();
      await outcome;
      await closed;
      await assert.rejects(fetch(callback.redirectUri), /fetch failed/u);
    } finally { socket.destroy(); }
  });
});

void test("abandoned browser authorization expires and closes its real listener", async (context): Promise<void> => {
  const callback = await openLoopbackCallback("matching-state", expectedIssuer);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const code = callback.awaitCode();
    const failure = assert.rejects(code, /timed out; run auth login again/u);
    context.mock.timers.tick(300_000);
    await failure;
  } finally {
    context.mock.timers.reset();
  }
  await assert.rejects(fetch(callback.redirectUri), /fetch failed/u);
});
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

import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { readBoundedJson } from "./bounded-json.js";

const fragmentedResponse = (bytes: Uint8Array): Response => {
  const iterator = bytes.values();
  return new Response(new ReadableStream<Uint8Array>({
    pull: (controller): void => {
      const next = iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(Uint8Array.of(next.value));
    },
  }));
};

void test("iteratively consumes many one-byte chunks and decodes split UTF-8 at the exact limit", async () => {
  const value = "é".repeat(50_000);
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const response = fragmentedResponse(bytes);
  assert.equal(await readBoundedJson(response, bytes.byteLength), value);
  assert.equal(response.body?.locked, false);
});

void test("empty chunks do not retain per-chunk accumulator history", async () => {
  const iterator = Array.from({ length: 50_000 }, () => new Uint8Array()).values();
  const response = new Response(new ReadableStream<Uint8Array>({
    pull: (controller): void => {
      const next = iterator.next();
      if (next.done) {
        controller.enqueue(new TextEncoder().encode("null"));
        controller.close();
      } else controller.enqueue(next.value);
    },
  }));
  assert.equal(await readBoundedJson(response, 4), null);
  assert.equal(response.body?.locked, false);
});

void test("cancels an oversized stream regardless of claimed Content-Length and releases its reader", async () => {
  const cancel = mock.fn();
  const response = new Response(new ReadableStream<Uint8Array>({
    pull: (controller): void => { controller.enqueue(new Uint8Array(9)); }, cancel,
  }), { headers: { "Content-Length": "1" } });
  await assert.rejects(readBoundedJson(response, 8), /Invalid or oversized JSON response/u);
  assert.equal(cancel.mock.callCount(), 1);
  assert.equal(response.body?.locked, false);
});

void test("rejects malformed JSON and incomplete UTF-8 without exposing parser excerpts", async () => {
  await Promise.all([
    new TextEncoder().encode('{"secret":"credential-excerpt"'),
    Uint8Array.of(0x22, 0xc3),
    Uint8Array.of(0x22, 0xff, 0x22),
  ].map(async (bytes) => {
    const response = fragmentedResponse(bytes);
    await assert.rejects(readBoundedJson(response, 100), { message: "Invalid or oversized JSON response." });
    assert.equal(response.body?.locked, false);
  }));
});

void test("redacts stream and cleanup errors and always releases the lock", async () => {
  const response = new Response(new ReadableStream<Uint8Array>({
    pull: (controller): void => { controller.error(new Error("credential-excerpt")); },
  }));
  await assert.rejects(readBoundedJson(response, 8), (error: unknown) =>
    error instanceof Error && !error.message.includes("credential-excerpt"));
  assert.equal(response.body?.locked, false);
  const cleanup = new Response(new ReadableStream<Uint8Array>({
    pull: (controller): void => { controller.enqueue(new Uint8Array(9)); },
    cancel: (): Promise<void> => Promise.reject(new Error("credential-excerpt")),
  }));
  await assert.rejects(readBoundedJson(cleanup, 8), { message: "Response stream cleanup failed." });
  assert.equal(cleanup.body?.locked, false);
});

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mock, test } from "node:test";
import { collectWriteInput, receiptCharacters } from "./write-input.js";

await test("fragmented pipe consumes the exact byte limit and empty chunks iteratively", async () => {
  const chunks = Array.from({ length: 16_384 }, () => Buffer.from("a"));
  const iterator = [...chunks, ...Array.from({ length: 20_000 }, () => Buffer.alloc(0))][Symbol.iterator]();
  assert.equal(await collectWriteInput(() => Promise.resolve(iterator.next().value ?? null), 16_384), "a".repeat(16_384));
});

await test("pipe rejects invalid UTF-8 and stream failures without exposing input", async () => {
  const iterator = [new Uint8Array([0xc3])][Symbol.iterator]();
  await assert.rejects(collectWriteInput(() => Promise.resolve(iterator.next().value ?? null), 2), /^Error: Write input is invalid, oversized, cancelled or expired\.$/u);
  await assert.rejects(collectWriteInput(() => Promise.reject(new Error("secret-payload")), 2), /^Error: Write input is invalid, oversized, cancelled or expired\.$/u);
});

await test("raw receipt supports paste, backspace and Enter without mutating previous state", () => {
  const initial = { text: "", done: false };
  const edited = receiptCharacters(initial, `x\u007f${"r".repeat(43)}\r\n`);
  assert.deepEqual(initial, { text: "", done: false });
  assert.deepEqual(edited, { text: "r".repeat(43), done: true });
});

await Promise.all(["\u0003", "\u0004", "\u001b[A", "é", "a".repeat(44)].map((chunk, index) => test(`raw receipt rejects unsafe input ${String(index)}`, () => {
  assert.throws(() => receiptCharacters({ text: "", done: false }, chunk), /invalid, oversized, cancelled or expired/u);
})));

await test("pipe byte bound counts UTF-8 bytes and decodes only after complete chunks", async () => {
  const bytes = Buffer.from("é");
  const next = mock.fn<() => Promise<Uint8Array | null>>();
  next.mock.mockImplementationOnce(() => Promise.resolve(bytes.subarray(0, 1)));
  next.mock.mockImplementationOnce(() => Promise.resolve(bytes.subarray(1)), 1);
  next.mock.mockImplementationOnce(() => Promise.resolve(null), 2);
  assert.equal(await collectWriteInput(next, 2), "é");
  assert.equal(next.mock.callCount(), 3);
  await assert.rejects(collectWriteInput(() => Promise.resolve(bytes), 1), /oversized/u);
});

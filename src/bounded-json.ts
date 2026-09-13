import { Readable } from "node:stream";

export const AUTH_RESPONSE_BYTES = 65_536;

/** Reads untrusted JSON with a byte cap, iterative consumption and deterministic stream cleanup. */
export const readBoundedJson = async (response: Response, maximumBytes: number): Promise<unknown> => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw new Error("Invalid response limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response body.");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const input: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<Uint8Array>> => {
        const next = await reader.read();
        return next.done ? { done: true, value: undefined } : { done: false, value: next.value };
      },
    }),
  };
  try {
    // Native reduction advances iteratively; no recursive promises or copied chunk arrays.
    const result = await Readable.from(input, { highWaterMark: 1 }).reduce(
      (previous: Readonly<{ bytes: number; text: string }>, chunk: unknown) => {
        if (!(chunk instanceof Uint8Array) || previous.bytes + chunk.byteLength > maximumBytes) {
          throw new Error("Response exceeds byte limit.");
        }
        return chunk.byteLength === 0 ? previous : {
          bytes: previous.bytes + chunk.byteLength,
          text: previous.text + decoder.decode(chunk, { stream: true }),
        };
      }, { bytes: 0, text: "" },
    );
    return JSON.parse(result.text + decoder.decode()) as unknown;
  } catch {
    // JSON.parse and stream exceptions can contain response data or credentials.
    throw new Error("Invalid or oversized JSON response.");
  } finally {
    try {
      await reader.cancel().catch(() => { throw new Error("Response stream cleanup failed."); });
    } finally { reader.releaseLock(); }
  }
};

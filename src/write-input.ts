import { Buffer } from "node:buffer";

const invalid = (): never => { throw new Error("Write input is invalid, oversized, cancelled or expired."); };
// Node types describe stdin as a TTY even when the actual stream is a pipe.
const terminalInput = (): boolean => (process.stdin as Readonly<{ isTTY?: boolean }>).isTTY ?? false;
type ReceiptState = Readonly<{ text: string; done: boolean }>;

/** Pure raw-terminal reducer; supports paste, backspace and cancellation without echo. */
export const receiptCharacters = (state: ReceiptState, chunk: string): ReceiptState => Array.from(chunk).reduce((current, character): ReceiptState => {
  if (current.done) return current;
  if (character === "\u0003" || character === "\u0004") return invalid();
  if (character === "\r" || character === "\n") return { ...current, done: true };
  if (character === "\b" || character === "\u007f") return { ...current, text: current.text.slice(0, -1) };
  if (!/^[A-Za-z0-9_-]$/u.test(character) || current.text.length >= 43) return invalid();
  return { ...current, text: current.text + character };
}, state);

const nextInput = (deadline: number): Promise<Buffer | null> => new Promise((resolve, reject) => {
  const cleanup = (): void => {
    process.stdin.off("data", data);
    process.stdin.off("end", end);
    process.stdin.off("error", error);
    process.stdin.pause();
    clearTimeout(timer);
  };
  const data = (value: unknown): void => {
    cleanup();
    if (Buffer.isBuffer(value)) resolve(value);
    else reject(new Error("Write input is invalid, oversized, cancelled or expired."));
  };
  const end = (): void => { cleanup(); resolve(null); };
  const error = (): void => { cleanup(); reject(new Error("Write input is invalid, oversized, cancelled or expired.")); };
  const timer = setTimeout(error, Math.max(1, deadline - Date.now()));
  process.stdin.once("data", data);
  process.stdin.once("end", end);
  process.stdin.once("error", error);
  if (process.stdin.readableEnded) end();
  else process.stdin.resume();
});

/** Collect bounded pipe bytes without printing input or reflecting parser diagnostics. */
export const collectWriteInput = async (next: () => Promise<Uint8Array | null>, limit: number, chunks: readonly Uint8Array[] = [], size = 0): Promise<string> => {
  const value = await next();
  if (value === null) return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  if (size + value.byteLength > limit) return invalid();
  return collectWriteInput(next, limit, [...chunks, value], size + value.byteLength);
};

/** Read only a JSON changes object from an explicit pipe; no arbitrary file or argv payload. */
export const readChanges = async (): Promise<Readonly<Record<string, string>>> => {
  if (terminalInput()) throw new Error("Preview changes require piped JSON with --input-stdin.");
  const deadline = Date.now() + 30_000;
  try {
    const value: unknown = JSON.parse(await collectWriteInput(() => nextInput(deadline), 16_384));
    if (typeof value !== "object" || value === null || Array.isArray(value)
      || !Object.values(value).every((entry: unknown) => typeof entry === "string")) return invalid();
    return value as Readonly<Record<string, string>>;
  } catch { return invalid(); }
};

/** Receive one receipt privately. Raw mode is restored on success, failure or cancellation. */
export const readApprovalReceipt = async (piped: boolean): Promise<string> => {
  if (piped === terminalInput()) throw new Error("Use hidden terminal entry, or --receipt-stdin with a pipe.");
  const deadline = Date.now() + 300_000;
  const raw = process.stdin.isRaw;
  const terminal = async (state: ReceiptState): Promise<string> => {
    if (state.done) return state.text;
    const chunk = await nextInput(deadline);
    if (chunk === null) return invalid();
    return terminal(receiptCharacters(state, chunk.toString("utf8")));
  };
  try {
    if (!piped) {
      process.stdin.setRawMode(true);
      process.stderr.write("Paste approval receipt (hidden), then press Enter: ");
    }
    const receipt = piped ? (await collectWriteInput(() => nextInput(deadline), 45)).trim() : await terminal({ text: "", done: false });
    if (!/^[A-Za-z0-9_-]{43}$/u.test(receipt)) return invalid();
    return receipt;
  } finally {
    process.stdin.pause();
    if (!piped) { process.stdin.setRawMode(raw); process.stderr.write("\n"); }
  }
};

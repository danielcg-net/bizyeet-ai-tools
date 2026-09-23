/** Preserve opaque cursors only when argv and URL encoding can round-trip them. */
export const MAX_CURSOR_LENGTH = 4096;
export const validCursor = (value: unknown): value is string => typeof value === "string"
  && value.length > 0 && value.length <= MAX_CURSOR_LENGTH && value.isWellFormed() && !value.includes("\0");

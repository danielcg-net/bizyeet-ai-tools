/** Preserve opaque cursors only when argv and URL encoding can round-trip them. */
export const validCursor = (value: unknown): value is string => typeof value === "string"
  && value.length > 0 && value.length <= 4096 && value.isWellFormed() && !value.includes("\0");

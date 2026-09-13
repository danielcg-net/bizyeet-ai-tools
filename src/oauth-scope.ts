/** Validates the RFC 6749 section 3.3 scope-token grammar. */
export const validOAuthScope = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/u.test(value);

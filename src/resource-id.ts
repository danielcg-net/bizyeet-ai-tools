/** Preserve opaque IDs while rejecting route substitutions and unbounded input. */
export const validResourceId = (value: unknown): value is string => typeof value === "string"
  && value.length >= 1 && value.length <= 1024 && Array.from(value).length <= 512 && !/^(?:\.|%2e){1,2}$/iu.test(value)
  && !/[/\\?#]/u.test(value)
  && !/[\uD800-\uDFFF]/u.test(value)
  && Array.from(value).every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);

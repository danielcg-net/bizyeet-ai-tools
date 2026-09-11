/** Escape display controls in serialized JSON while preserving decoded values. */
export const escapeDisplayJson = (serialized: string): string => serialized.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu,
  (character) => character.split("").map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""));

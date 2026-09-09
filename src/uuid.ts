/** Accept assigned RFC 9562 variant UUID versions, not sentinel or reserved values. */
export const isUuid = (value: unknown): value is string => typeof value === "string"
  && value.length === 36
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);

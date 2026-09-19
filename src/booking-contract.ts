export type BookingSummaryOptions = Readonly<{ hours?: number }>;

/** Keep the CLI contract aligned with the server's bounded future-window input. */
export const validBookingSummaryOptions = (value: unknown): value is BookingSummaryOptions => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const fields = Object.keys(value);
  if (fields.some((field) => field !== "hours")) return false;
  const hours = (value as Readonly<Record<string, unknown>>).hours;
  return hours === undefined || (typeof hours === "number" && Number.isSafeInteger(hours) && hours >= 1 && hours <= 720);
};

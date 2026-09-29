const localDate = (timestamp: number, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, calendar: "iso8601", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(timestamp);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value.padStart(type === "year" ? 4 : 2, "0") ?? "").join("-");
};

/** Accept only the tenant-calendar anchor observed at completion, with a bounded midnight crossing. */
export const reportAnchorMatchesCompletion = (anchor: string, completedAt: string, timeZone: string): boolean => {
  const completed = Date.parse(completedAt);
  return anchor === localDate(completed, timeZone) || anchor === localDate(completed - 15_000, timeZone);
};

/** Check named ranges without calculating replacement UTC boundaries in the client. */
export const reportRangeLabels = (range: string, start: string, end: string, exclusive: string, today: string): boolean => {
  if (range === "custom") return true;
  if (range === "last_month") {
    const monthIndex = (value: string): number => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
    return start.endsWith("-01") && exclusive === `${today.slice(0, 7)}-01` && monthIndex(exclusive) - monthIndex(start) === 1;
  }
  if (end !== today) return false;
  if (range === "today") return start === today;
  if (range === "month") return start === `${today.slice(0, 7)}-01`;
  if (range === "ytd") return start === `${today.slice(0, 4)}-01-01`;
  const days = (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000;
  return (range === "7d" && days === 6) || (range === "30d" && days === 29);
};

/** Verify a supplied UTC instant is the requested local-day boundary, including DST transitions. */
export const reportCalendarBoundary = (value: string, label: string, timeZone: string): boolean => {
  try {
    const timestamp = Date.parse(value);
    return localDate(timestamp, timeZone) === label && localDate(timestamp - 1, timeZone) !== label;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
};

const record = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const providerNames = Object.freeze(["none", "setmore", "zoho", "calendly", "custom", "unknown"]);
const states = Object.freeze({
  upcoming_summary: Object.freeze(["supported", "unsupported", "unavailable"]),
  availability_slots: Object.freeze(["unsupported", "unavailable"]),
  booking_detail: Object.freeze(["unsupported", "unavailable"]),
  create: Object.freeze(["external_link_only", "unsupported", "unavailable"]),
  reschedule: Object.freeze(["unsupported", "unavailable"]),
  cancel: Object.freeze(["unsupported", "unavailable"]),
});
const linkStates = Object.freeze(["configured", "unavailable"]);

/** Validate a canonical booking capability matrix and omit unrequested backend metadata. */
export const bookingCapabilitiesResponse = (body: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (!record(body) || !record(body.data) || !record(body.meta) || body.meta.contract_version !== "v1") return undefined;
  const { data } = body;
  const links = data.booking_links;
  if (!record(links)) return undefined;
  if (!providerNames.includes(data.booking_provider as string)
    || Object.entries(states).some(([key, allowed]) => !allowed.includes(data[key] as string))
    || !["in_person", "online"].every((key) => linkStates.includes(links[key] as string))
    || (data.create === "external_link_only") !== ["in_person", "online"].some((key) => links[key] === "configured")) return undefined;
  return Object.freeze({ data: Object.freeze({ booking_provider: data.booking_provider,
    ...Object.fromEntries(Object.keys(states).map((key) => [key, data[key]])),
    booking_links: Object.freeze({ in_person: links.in_person, online: links.online }) }),
  meta: Object.freeze({ contract_version: "v1" }) });
};

import { createSalesResponse } from "./sales-read-response.js";
import { quoteReadFields } from "./quote-read-contract.js";

/** Project canonical quote facts without requiring service-only line handles. */
export const quoteResponse = createSalesResponse(quoteReadFields, true, false);

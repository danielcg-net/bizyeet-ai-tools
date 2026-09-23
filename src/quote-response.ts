import { createSalesResponse } from "./sales-read-response.js";
import { quoteReadFields } from "./quote-read-contract.js";

/** Project quote facts and opaque edit handles without private costs. */
export const quoteResponse = createSalesResponse(quoteReadFields, true);

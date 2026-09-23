import { createSalesResponse } from "./sales-read-response.js";
import { serviceReadFields } from "./service-read-contract.js";

/** Project public service facts, excluding private metadata. */
export const serviceResponse = createSalesResponse(serviceReadFields, false);

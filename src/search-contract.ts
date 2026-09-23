/** Advertised canonical CRM search bound, measured in Unicode code points. */
export const CRM_SEARCH_MAX_LENGTH = 200;
export const CRM_SEARCH_LIMIT_MESSAGE = `Search is limited to ${String(CRM_SEARCH_MAX_LENGTH)} Unicode characters and must contain well-formed Unicode.`;

/** Validate raw input without truncation or duplicating server normalization. */
export const validCrmSearch = (value: string): boolean => value.length <= CRM_SEARCH_MAX_LENGTH * 2
  && !/[\uD800-\uDFFF]/u.test(value)
  && Array.from(value).length <= CRM_SEARCH_MAX_LENGTH;

/** Catalog and sales search matches JSON Schema maxLength in Unicode code points. */
export const SALES_SEARCH_MAX_LENGTH = 120;
export const validSalesSearch = (value: unknown): value is string => typeof value === "string"
  && value.length <= SALES_SEARCH_MAX_LENGTH * 2 && !/[\uD800-\uDFFF]/u.test(value)
  && Array.from(value).length <= SALES_SEARCH_MAX_LENGTH;

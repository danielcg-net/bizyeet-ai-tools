/** Advertised canonical CRM search bound, measured in Unicode code points. */
export const CRM_SEARCH_MAX_LENGTH = 200;

/** Validate raw input without truncation or duplicating server normalization. */
export const validCrmSearch = (value: string): boolean => value.length <= CRM_SEARCH_MAX_LENGTH * 2
  && Array.from(value).length <= CRM_SEARCH_MAX_LENGTH;

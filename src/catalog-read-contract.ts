/** Public catalog projection; source selection and prices belong to BizYeet. */
export const catalogReadFields = Object.freeze([
  "id", "name", "description", "sku", "unit_label", "unit_price", "min_price", "max_price", "currency", "pricing_model", "active",
] as const);

/** Validate projection names without duplicating provider or pricing rules. */
export const validCatalogReadFields = (value: unknown): value is readonly typeof catalogReadFields[number][] =>
  Array.isArray(value) && value.length <= catalogReadFields.length
  && value.every((field: unknown) => catalogReadFields.some((known) => known === field));

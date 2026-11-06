/**
 * Whether a parsed JSON value is an object with keys, not null or an array.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// The error list `validateGenome` returns. The phase 2 repair round feeds it back to the LLM,
// so each error names the JSON path of the value it's about (decision 0005).

/** @typedef {{ path: string, message: string }} ValidationError */

/**
 * A value as an error message quotes it.
 * @param {unknown} value
 */
export const show = (value) => (typeof value === "number" ? String(value) : JSON.stringify(value));

/**
 * Pushes an error for each key of `fields` that `known` doesn't accept.
 * @param {Record<string, unknown>} fields
 * @param {(key: string) => boolean} known
 * @param {string} path
 * @param {ValidationError[]} errors
 */
export function checkKeys(fields, known, path, errors) {
  for (const key of Object.keys(fields)) {
    if (!known(key)) errors.push({ path: `${path}.${key}`, message: "unknown key" });
  }
}

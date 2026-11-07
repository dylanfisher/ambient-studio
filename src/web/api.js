// The studio's JSON API, as the pages call it (decision 0027). Every POST sends a JSON body,
// `{}` when the route takes no fields, because the server answers only JSON bodies (0025). A
// reply that isn't a 2xx throws with the server's message, for the page to show.

/**
 * @param {string} method
 * @param {string} path
 * @param {RequestInit} init
 * @returns {Promise<any>} the parsed reply
 */
async function send(method, path, init) {
  const response = await fetch(path, { ...init, method });
  const text = await response.text();
  /** @type {any} */
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${method} ${path}: ${response.status}, and the reply isn't JSON: ${text}`, {
      cause: error,
    });
  }
  if (!response.ok) throw new Error(value?.error ?? `${method} ${path}: ${response.status}`);
  return value;
}

/** The vibes route; a vibe's own routes are under it. */
export const VIBES_PATH = "/api/vibes";

/**
 * @param {string} path
 * @returns {Promise<any>}
 */
export const getJson = (path) => send("GET", path, {});

/**
 * @param {string} path
 * @param {Record<string, unknown>} body `{}` when the route takes no fields
 * @returns {Promise<any>}
 */
export const postJson = (path, body) =>
  send("POST", path, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

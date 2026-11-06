// How the server matches a request to a route and reads and writes JSON (decision 0025). The
// app's table is in routes.js; main.js dispatches.
/** @import { IncomingMessage, ServerResponse } from "node:http" */
/** @import { Config } from "../config/config.js" */
/** @import { Paths } from "../config/paths.js" */
/** @import { Store } from "./store.js" */

/**
 * What every handler can reach. A step that adds a long-lived part (the job runner) adds it here
 * and to `startServer`.
 * @typedef {object} App
 * @property {Config} config
 * @property {Paths} paths
 * @property {Store} store
 * @property {(line: string) => void} log
 */

/**
 * @typedef {object} RouteContext
 * @property {IncomingMessage} request
 * @property {ServerResponse} response
 * @property {Record<string, string>} params the path's `:name` segments, percent-decoded
 * @property {URLSearchParams} query
 * @property {() => Promise<unknown>} body the request body parsed as JSON; throws an
 *   `HttpError` (400, 413 or 415) when it can't be
 * @property {App} app
 */

/**
 * Returns the value to send as a 200 JSON body, or `undefined` once it has sent its own
 * response (a stream, another status). Throws an `HttpError` for a 4xx.
 * @typedef {(context: RouteContext) => unknown} Handler
 */

/**
 * `path` is literal segments and `:name` segments, such as `/audio/:renderId`. A GET route also
 * answers HEAD; Node drops the body of a HEAD response.
 * @typedef {object} Route
 * @property {"GET" | "POST" | "PUT" | "DELETE"} method
 * @property {string} path
 * @property {Handler} handle
 */

/** The largest request body read, in bytes. Briefs, constraints and ratings are a few kB. */
export const MAX_BODY_BYTES = 1 << 20;

/** A response with a 4xx status, sent as `{ error: message }`. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * The request path's segments, each percent-decoded, or undefined when a segment is empty, `.`
 * or `..`, or decodes to one with `/`, `\` or NUL in it. The raw path is used, not one a URL
 * parser normalized, so `/%2e%2e/x` is refused rather than read as `/x`.
 * @param {string} target the request line's target, `request.url`
 * @returns {{ segments: string[], query: URLSearchParams } | undefined}
 */
export function parseTarget(target) {
  const queryAt = target.indexOf("?");
  const path = queryAt === -1 ? target : target.slice(0, queryAt);
  const query = new URLSearchParams(queryAt === -1 ? "" : target.slice(queryAt + 1));
  if (path === "/") return { segments: [], query };
  if (!path.startsWith("/")) return undefined;
  const segments = [];
  for (const raw of path.slice(1).split("/")) {
    /** @type {string} */
    let segment;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return undefined; // a bad percent-escape names no file and no route
    }
    if (segment === "" || segment === "." || segment === "..") return undefined;
    if (/[/\\\0]/.test(segment)) return undefined;
    segments.push(segment);
  }
  return { segments, query };
}

/**
 * The route whose path matches `segments`, with its params, or the methods the path allows when
 * only the method differs, or undefined when no path matches.
 * @param {Route[]} routes
 * @param {string} method
 * @param {string[]} segments
 * @returns {{ route: Route, params: Record<string, string> } | { allow: string[] } | undefined}
 */
export function matchRoute(routes, method, segments) {
  /** @type {string[]} */
  const allow = [];
  for (const route of routes) {
    const params = matchPath(route.path, segments);
    if (!params) continue;
    const methods = route.method === "GET" ? ["GET", "HEAD"] : [route.method];
    if (methods.includes(method)) return { route, params };
    allow.push(...methods);
  }
  return allow.length === 0 ? undefined : { allow };
}

/**
 * @param {string} pattern
 * @param {string[]} segments
 * @returns {Record<string, string> | undefined}
 */
function matchPath(pattern, segments) {
  const parts = pattern === "/" ? [] : pattern.slice(1).split("/");
  if (parts.length !== segments.length) return undefined;
  /** @type {Record<string, string>} */
  const params = {};
  for (const [index, part] of parts.entries()) {
    const segment = /** @type {string} */ (segments[index]);
    if (part.startsWith(":")) params[part.slice(1)] = segment;
    else if (part !== segment) return undefined;
  }
  return params;
}

/**
 * Reads the request body as JSON, at most `MAX_BODY_BYTES`.
 * @param {IncomingMessage} request
 * @returns {Promise<unknown>}
 */
export async function readJson(request) {
  const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    throw new HttpError(
      415,
      `the request body must be application/json, not ${type ?? "unlabeled"}`,
    );
  }
  const tooBig = new HttpError(413, `the request body is over the ${MAX_BODY_BYTES}-byte limit`);
  // Past the limit the rest of the body is read and dropped, not left unread: closing the
  // connection on a client still sending resets it, and the client loses the 413.
  if (Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
    request.resume();
    throw tooBig;
  }
  /** @type {Buffer[]} */
  const chunks = [];
  let length = 0;
  await new Promise((resolve, reject) => {
    request.on("data", (/** @type {Buffer} */ chunk) => {
      length += chunk.length;
      if (length <= MAX_BODY_BYTES) chunks.push(chunk);
      else reject(tooBig); // only the first call counts; later chunks are dropped
    });
    request.once("end", resolve);
    request.once("error", reject);
  });
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new HttpError(
      400,
      `the request body is not valid JSON: ${/** @type {Error} */ (error).message}`,
    );
  }
}

/**
 * @param {ServerResponse} response
 * @param {number} status
 * @param {unknown} value
 */
export function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
  });
  response.end(body);
}

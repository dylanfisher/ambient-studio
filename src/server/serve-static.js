// Static files (decision 0025): src/web at `/`, and the browser-loadable tiers at `/engine/` and
// `/domain/`, so a web module's `../engine/x.js` import resolves. Files only, by extension, and
// never a path whose real location is outside its folder.
/** @import { IncomingMessage, ServerResponse } from "node:http" */
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileInside, isMissing } from "./file-inside.js";

const SRC = join(import.meta.dirname, "..");

/** Module types are `text/javascript` because Safari refuses a module served as anything else. */
const MODULE_TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
};

/** @type {Record<string, string>} */
const WEB_TYPES = {
  ...MODULE_TYPES,
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

/**
 * @typedef {object} Mount
 * @property {string} folder
 * @property {Record<string, string>} types content type by extension; any other is a 404
 */

/** @type {Record<string, Mount>} the tiers served under their own name */
const TIERS = {
  engine: { folder: join(SRC, "engine"), types: MODULE_TYPES },
  domain: { folder: join(SRC, "domain"), types: MODULE_TYPES },
};
const WEB = { folder: join(SRC, "web"), types: WEB_TYPES };
const INDEX = "index.html";

/**
 * Sends the static file `segments` names, for a GET or a HEAD. Returns false, having sent
 * nothing, when there is none.
 * @param {IncomingMessage} request
 * @param {ServerResponse} response
 * @param {string[]} segments the request path's, from `parseTarget`
 * @returns {Promise<boolean>}
 */
export async function serveStatic(request, response, segments) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const first = segments[0];
  const tier = first !== undefined && Object.hasOwn(TIERS, first) ? TIERS[first] : undefined;
  const { folder, types } = tier ?? WEB;
  const rest = tier ? segments.slice(1) : segments.length === 0 ? [INDEX] : segments;
  const type = types[extname(rest.at(-1) ?? "")];
  if (rest.length === 0 || type === undefined) return false;
  const file = await fileInside(folder, rest);
  if (!file) return false;
  /** @type {Buffer} */
  let body;
  try {
    body = await readFile(file.path);
  } catch (error) {
    if (isMissing(error)) return false; // removed or made unreadable since fileInside looked
    throw error;
  }
  response.writeHead(200, {
    "content-type": type,
    "content-length": body.length,
    "x-content-type-options": "nosniff",
    // The files change while `./scripts/dev` runs; a reload fetches them again.
    "cache-control": "no-cache",
  });
  response.end(request.method === "HEAD" ? undefined : body);
  return true;
}

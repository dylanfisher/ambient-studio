// GET /audio/:renderId (decision 0025): a render-cache MP3 (0048) by renders row id, with
// single byte ranges as RFC 9110 §14 defines them. Safari's <audio> asks for ranges and won't
// seek without them.
/** @import { RouteContext } from "./routing.js" */
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { fileInside } from "./file-inside.js";
import { getRender } from "./render-store.js";
import { HttpError } from "./routing.js";
import { MP3_EXTENSION } from "./write-mp3.js";

/**
 * What a Range header asks of a file: all of it, one inclusive byte span, or nothing it has.
 * @typedef {{ kind: "whole" } | { kind: "span", first: number, last: number } | { kind: "unsatisfiable" }} RangeRequest
 */

const WHOLE = /** @type {const} */ ({ kind: "whole" });
const UNSATISFIABLE = /** @type {const} */ ({ kind: "unsatisfiable" });

/**
 * What a stream into a response the listener has already closed fails with: closed partway,
 * or closed before the stream began.
 */
const LISTENER_GONE = new Set([
  "ERR_STREAM_PREMATURE_CLOSE",
  "ERR_STREAM_UNABLE_TO_PIPE",
  "ERR_STREAM_CANNOT_PIPE",
]);

/**
 * Reads a Range header for a file of `size` bytes. A header in another unit or that doesn't
 * parse is ignored (§14.2), and so is one with several ranges: the RFC lets a server send the
 * whole file instead, and <audio> asks for one range at a time.
 * @param {string | undefined} header
 * @param {number} size
 * @returns {RangeRequest}
 */
function readRange(header, size) {
  const match = /^\s*bytes\s*=\s*(\d*)-(\d*)\s*$/i.exec(header ?? "");
  if (!match) return WHOLE;
  const [, from = "", to = ""] = match;
  if (from === "") {
    if (to === "") return WHOLE;
    const suffix = Number(to);
    if (suffix === 0 || size === 0) return UNSATISFIABLE;
    return { kind: "span", first: Math.max(0, size - suffix), last: size - 1 };
  }
  const first = Number(from);
  if (to !== "" && Number(to) < first) return WHOLE;
  if (first >= size) return UNSATISFIABLE;
  return { kind: "span", first, last: to === "" ? size - 1 : Math.min(Number(to), size - 1) };
}

/**
 * @param {RouteContext} context
 * @returns {Promise<undefined>}
 */
export async function serveAudio({ request, response, params, app }) {
  const id = params.renderId ?? "";
  const render = /^[1-9]\d{0,15}$/.test(id) ? getRender(app.store, Number(id)) : undefined;
  if (!render) throw new HttpError(404, `no render ${id}`);
  // A WAV cached before excerpts were MP3s is rendered again before it is played.
  if (!render.file.endsWith(MP3_EXTENSION)) {
    throw new HttpError(404, `render ${id} is not an MP3; render the excerpt again`);
  }
  const file = await fileInside(app.paths.renderCache, [render.file]);
  if (!file) throw new HttpError(404, `render ${id} has no file in the render cache`);
  const { size } = file;
  // Without validators (ETag, Last-Modified) the server can't tell whether If-Range matches,
  // so it sends the whole file, as RFC 9110 §13.1.5 requires when it doesn't.
  const range =
    request.headers["if-range"] === undefined ? readRange(request.headers.range, size) : WHOLE;
  const headers = { "content-type": "audio/mpeg", "accept-ranges": "bytes" };
  if (range.kind === "unsatisfiable") {
    response.writeHead(416, { ...headers, "content-range": `bytes */${size}` });
    response.end();
    return undefined;
  }
  const { first, last } = range.kind === "span" ? range : { first: 0, last: size - 1 };
  response.writeHead(range.kind === "span" ? 206 : 200, {
    ...headers,
    "content-length": last - first + 1,
    ...(range.kind === "span" && { "content-range": `bytes ${first}-${last}/${size}` }),
  });
  if (request.method === "HEAD" || size === 0) {
    response.end();
    return undefined;
  }
  try {
    await pipeline(createReadStream(file.path, { start: first, end: last }), response);
  } catch (error) {
    // <audio> drops a range request when it seeks or has buffered enough, and a client that
    // sent an unread body with Connection: close can be gone before the stream starts; neither
    // is a fault.
    const code = /** @type {NodeJS.ErrnoException} */ (error).code ?? "";
    if (!LISTENER_GONE.has(code) || !response.destroyed) throw error;
  }
  return undefined;
}

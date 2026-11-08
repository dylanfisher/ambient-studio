// The reference routes (decision 0050): upload a recording, list and read the kept ones, their
// peak strips and the MP3 of a span, and add, replace and remove regions. An upload's own name
// is stored as text only: the kept file is named by its hash, with the extension of the format
// ffprobe found, and no text the owner sent reaches a path or a CLI argument.
/** @import { RegionFields } from "../domain/reference-region.js" */
/** @import { Store } from "./store.js" */
/** @import { Route } from "./routing.js" */
/** @import { ReferenceFile } from "./reference-store.js" */
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { regionProblem } from "../domain/reference-region.js";
import { FILE_NAME_HEADER } from "../domain/reference-upload.js";
import { probeReference } from "./probe-reference.js";
import { receiveUpload } from "./receive-upload.js";
import { keepPeaks, measurePeaks, readPeaks } from "./reference-peaks.js";
import {
  addReferenceFile,
  addRegion,
  findReferenceFile,
  getReferenceFile,
  getRegion,
  listReferenceFiles,
  listRegions,
  removeReferenceFile,
  removeRegion,
  replaceRegion,
} from "./reference-store.js";
import { regionMp3 } from "./region-mp3.js";
import { fields, finite, idParam, MAX_CHARS, text } from "./request-fields.js";
import { HttpError } from "./routing.js";
import { sendMp3 } from "./send-mp3.js";

/** The body fields of a region. */
const REGION_FIELDS = Object.freeze(["startSeconds", "endSeconds", "label", "note"]);

/** DEL; it and the C0 controls below it are what a name shown on the page can't hold. */
const DEL = 0x7f;

/** @param {string} name */
const hasControl = (name) =>
  [...name].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === DEL);

/**
 * The upload's file name from its header, or a 400.
 * @param {string | string[] | undefined} header
 * @returns {string}
 */
function uploadName(header) {
  if (typeof header !== "string" || header === "") {
    throw new HttpError(400, `an upload names its file in the ${FILE_NAME_HEADER} header`);
  }
  /** @type {string} */
  let name;
  try {
    name = decodeURIComponent(header);
  } catch {
    throw new HttpError(400, `the ${FILE_NAME_HEADER} header isn't percent-encoded UTF-8`);
  }
  if (name.trim() === "" || name.length > MAX_CHARS.name || hasControl(name)) {
    throw new HttpError(
      400,
      `the file name must be 1 to ${MAX_CHARS.name} characters with no control characters`,
    );
  }
  return name;
}

/**
 * The live reference the path names, or a 404.
 * @param {Store} store
 * @param {Record<string, string>} params
 * @returns {ReferenceFile}
 */
function requireReference(store, params) {
  const id = idParam(params, "referenceId");
  const reference = getReferenceFile(store, id);
  if (!reference) throw new HttpError(404, `there is no reference ${id}`);
  if (reference.removedAt !== null) throw new HttpError(404, `reference ${id} was removed`);
  return reference;
}

/**
 * A region's fields from a body, checked against the file's length, or a 400.
 * @param {unknown} body
 * @param {ReferenceFile} reference
 * @returns {RegionFields}
 */
function regionFields(body, reference) {
  const given = fields(body, REGION_FIELDS);
  const bounds = { min: 0, max: reference.durationSeconds };
  const unbounded = { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY };
  const startSeconds = finite(given, "startSeconds", bounds);
  const endSeconds = finite(given, "endSeconds", unbounded);
  const problem = regionProblem(startSeconds, endSeconds, reference.durationSeconds);
  if (problem) throw new HttpError(400, problem);
  return {
    startSeconds,
    endSeconds,
    label: text(given, "label", MAX_CHARS.name).trim(),
    note: text(given, "note", MAX_CHARS.note, { allowEmpty: true }).trim(),
  };
}

/**
 * The live region the path names and its live file, or a 404 or 400.
 * @param {Store} store
 * @param {Record<string, string>} params
 */
function requireRegion(store, params) {
  const id = idParam(params, "regionId");
  const region = getRegion(store, id);
  if (!region) throw new HttpError(404, `there is no region ${id}`);
  if (region.removedAt !== null) {
    throw new HttpError(400, `region ${id} was ${region.removedReason}`);
  }
  const reference = /** @type {ReferenceFile} */ (getReferenceFile(store, region.referenceFileId));
  return { region, reference };
}

/** A time in a query, as plain decimal seconds. */
const QUERY_SECONDS = /^\d{1,7}(\.\d{1,6})?$/;

/**
 * A query's time in seconds, or a 400.
 * @param {URLSearchParams} query
 * @param {string} key
 */
function querySeconds(query, key) {
  const value = query.get(key) ?? "";
  if (!QUERY_SECONDS.test(value)) {
    throw new HttpError(400, `${key} must be a time in seconds, such as 12.5, got "${value}"`);
  }
  return Number(value);
}

/** @type {Route[]} */
export const REFERENCE_ROUTES = [
  {
    method: "GET",
    path: "/api/references",
    handle: ({ app }) => ({ references: listReferenceFiles(app.store) }),
  },
  {
    method: "POST",
    path: "/api/references",
    handle: async ({ app, request }) => {
      /** @type {string} */
      let fileName;
      try {
        fileName = uploadName(request.headers[FILE_NAME_HEADER]);
      } catch (error) {
        // Read and drop the body, so the client gets the 400 instead of a reset connection.
        request.resume();
        throw error;
      }
      const upload = await receiveUpload(request, app.paths.referenceCache);
      try {
        const known = findReferenceFile(app.store, upload.sha256);
        if (known) return { reference: known, added: false };
        const probe = await probeReference(upload.path);
        if (!probe.ok) throw new HttpError(400, probe.reason);
        const { format, extension, durationSeconds, channels, sampleRate } = probe.probed;
        // Measuring the strip decodes the whole file, so a file ffmpeg can't decode to its end
        // is refused here rather than on the page.
        let peaks;
        try {
          peaks = await measurePeaks(upload.path, durationSeconds);
        } catch (error) {
          // ffmpeg's message names a server path, so it goes to the log only.
          app.log(`measuring an upload's peaks: ${/** @type {Error} */ (error).message}`);
          throw new HttpError(400, "ffmpeg couldn't decode the whole file; it may be damaged.");
        }
        const file = `${upload.sha256}${extension}`;
        await mkdir(app.paths.references, { recursive: true });
        // A file removed earlier left these same bytes under this name; the rename replaces
        // them with themselves.
        await rename(upload.path, join(app.paths.references, file));
        const added = addReferenceFile(app.store, {
          sha256: upload.sha256,
          fileName,
          format,
          file,
          durationSeconds,
          channels,
          sampleRate,
          sizeBytes: upload.sizeBytes,
        });
        await keepPeaks(app.paths, added.reference, peaks);
        return added;
      } finally {
        await rm(upload.path, { force: true });
      }
    },
  },
  {
    method: "GET",
    path: "/api/references/:referenceId",
    handle: ({ app, params }) => {
      const reference = requireReference(app.store, params);
      return { reference, regions: listRegions(app.store, reference.id) };
    },
  },
  {
    method: "GET",
    path: "/api/references/:referenceId/peaks",
    handle: async ({ app, params }) => ({
      peaks: await readPeaks(app.paths, requireReference(app.store, params)),
    }),
  },
  {
    method: "GET",
    path: "/api/references/:referenceId/audio",
    handle: async ({ app, params, query, request, response }) => {
      const reference = requireReference(app.store, params);
      const start = querySeconds(query, "start");
      const end = querySeconds(query, "end");
      const problem = regionProblem(start, end, reference.durationSeconds);
      if (problem) throw new HttpError(400, problem);
      const path = await regionMp3(app.paths, reference, start, end);
      await sendMp3(request, response, { path, size: (await stat(path)).size });
      return undefined;
    },
  },
  {
    method: "POST",
    path: "/api/references/:referenceId/remove",
    handle: async ({ app, params, body }) => {
      const reference = requireReference(app.store, params);
      fields(await body(), []);
      removeReferenceFile(app.store, reference.id);
      return { reference: getReferenceFile(app.store, reference.id) };
    },
  },
  {
    method: "POST",
    path: "/api/references/:referenceId/regions",
    handle: async ({ app, params, body }) => {
      const reference = requireReference(app.store, params);
      const region = regionFields(await body(), reference);
      return { region: addRegion(app.store, { ...region, referenceFileId: reference.id }) };
    },
  },
  {
    method: "POST",
    path: "/api/reference-regions/:regionId/replace",
    handle: async ({ app, params, body }) => {
      const { region, reference } = requireRegion(app.store, params);
      const fieldsGiven = regionFields(await body(), reference);
      return { region: replaceRegion(app.store, region.id, fieldsGiven) };
    },
  },
  {
    method: "POST",
    path: "/api/reference-regions/:regionId/remove",
    handle: async ({ app, params, body }) => {
      const { region } = requireRegion(app.store, params);
      fields(await body(), []);
      removeRegion(app.store, region.id);
      return { region: getRegion(app.store, region.id) };
    },
  },
];

// Receives a reference upload's body (decision 0050): an application/octet-stream body is
// streamed to a temp file and hashed on the way, at most `MAX_UPLOAD_BYTES`. It is the one
// request body that isn't JSON (0025). Its type is still not one a cross-site form or a plain
// fetch can send without a CORS preflight, which the server never answers.
/** @import { Readable } from "node:stream" */
/** @import { IncomingHttpHeaders } from "node:http" */
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { UPLOAD_TYPE } from "../domain/reference-upload.js";
import { HttpError, wrongType } from "./routing.js";
import { newSha256 } from "./sha256-hex.js";

/** The largest upload, 1 GiB: an hour of 16-bit 48 kHz stereo WAV is 691 MB. */
export const MAX_UPLOAD_BYTES = 2 ** 30;

/**
 * @typedef {object} Upload
 * @property {string} path the temp file; the caller moves or removes it
 * @property {string} sha256 of the body
 * @property {number} sizeBytes
 */

/**
 * Streams the body to a new file in `folder`, creating the folder. Throws a 415 for another
 * content type, a 413 past `maxBytes` (declared or sent), and a 400 for an empty body; each
 * leaves no file. Past the limit the rest of the body is read and dropped, as `readJson` does,
 * so the client gets the 413 instead of a reset connection.
 * @param {Readable & { headers: IncomingHttpHeaders }} request
 * @param {string} folder
 * @param {number} [maxBytes]
 * @returns {Promise<Upload>}
 */
export async function receiveUpload(request, folder, maxBytes = MAX_UPLOAD_BYTES) {
  const refused = wrongType(request, UPLOAD_TYPE);
  if (refused) {
    request.resume();
    throw refused;
  }
  const tooBig = new HttpError(413, `the file is over the ${maxBytes / 2 ** 20} MiB limit`);
  if (Number(request.headers["content-length"] ?? 0) > maxBytes) {
    request.resume();
    throw tooBig;
  }
  await mkdir(folder, { recursive: true });
  const path = join(folder, `upload-${randomUUID()}`);
  const file = createWriteStream(path, { flags: "wx" });
  const hash = newSha256();
  let sizeBytes = 0;
  try {
    await new Promise((resolve, reject) => {
      request.on("data", (/** @type {Buffer} */ chunk) => {
        if (sizeBytes > maxBytes) return; // over the limit: dropped while the rest drains
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes) {
          request.resume();
          reject(tooBig);
          return;
        }
        hash.update(chunk);
        if (!file.write(chunk)) {
          request.pause();
          file.once("drain", () => request.resume());
        }
      });
      request.once("end", resolve);
      request.once("error", reject);
      file.once("error", reject);
    });
    file.end();
    await finished(file);
  } catch (error) {
    // A request paused for a slow disk would otherwise never finish sending.
    request.resume();
    file.destroy();
    // The file opens asynchronously, and a destroy before the open finishes leaves the file to
    // be created afterward. Wait for the close so `rm` sees it. The destroy's own error, already
    // in `error` or rethrown below, is dropped here so it can't replace the one being thrown.
    await finished(file).catch(() => {});
    await rm(path, { force: true });
    throw error;
  }
  if (sizeBytes === 0) {
    await rm(path);
    throw new HttpError(400, "the upload is empty");
  }
  return { path, sha256: hash.digest("hex"), sizeBytes };
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FLAC } from "./write-flac.js";

const run = promisify(execFile);

/**
 * Decodes a FLAC with the `flac` CLI to raw interleaved little-endian signed PCM at the file's
 * own bit depth: for the 24-bit FLACs `writeFlac` writes, the bytes `encodePcm24` made. A failed
 * decode throws with flac's stderr.
 * @param {string} path
 * @returns {Promise<Uint8Array>}
 */
export async function readFlacPcm(path) {
  const args = ["-d", "--silent", "--stdout", "--force-raw-format", "--endian=little"];
  const { stdout } = await run(FLAC, [...args, "--sign=signed", path], {
    encoding: "buffer",
    maxBuffer: Number.POSITIVE_INFINITY,
  });
  return stdout;
}

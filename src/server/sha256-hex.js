import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** A new SHA-256 hash to feed chunk by chunk, for bytes that arrive as a stream. */
export const newSha256 = () => createHash("sha256");

/**
 * The SHA-256 of `data` in lowercase hex, the form genome and PCM hashes are stored in.
 * @param {string | Uint8Array} data
 * @returns {string}
 */
export function sha256Hex(data) {
  return newSha256().update(data).digest("hex");
}

/**
 * The SHA-256 of a file in lowercase hex, read as a stream, so a file of any size hashes;
 * `readFile` refuses one over 2 GiB.
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function sha256HexOfFile(path) {
  const hash = newSha256();
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

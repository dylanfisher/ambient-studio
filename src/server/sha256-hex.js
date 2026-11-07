import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * The SHA-256 of `data` in lowercase hex, the form genome and PCM hashes are stored in.
 * @param {string | Uint8Array} data
 * @returns {string}
 */
export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * The SHA-256 of a file in lowercase hex, read as a stream, so a file of any size hashes;
 * `readFile` refuses one over 2 GiB.
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function sha256HexOfFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

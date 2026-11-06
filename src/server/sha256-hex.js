import { createHash } from "node:crypto";

/**
 * The SHA-256 of `data` in lowercase hex, the form genome and PCM hashes are stored in.
 * @param {string | Uint8Array} data
 * @returns {string}
 */
export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

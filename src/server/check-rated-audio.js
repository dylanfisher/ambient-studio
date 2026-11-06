// Checks the rated excerpts against their rows (decision 0021). They are the only copy of what
// the owner heard once the engine version moves on (0009).
/** @import { Store } from "./store.js" */
import { existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { listRatedAudio } from "./rating-store.js";
import { readFlacPcm } from "./read-flac-pcm.js";
import { sha256Hex } from "./sha256-hex.js";

/**
 * The PCM hash of a rated excerpt: SHA-256 hex of its decoded interleaved 24-bit little-endian
 * PCM, the same bytes an export's `pcmSha256` covers (0015).
 * @param {string} flacPath
 * @returns {Promise<string>}
 */
async function pcmHash(flacPath) {
  return sha256Hex(await readFlacPcm(flacPath));
}

/**
 * @param {string} folder
 * @param {string} file
 * @returns {string} the absolute path, which must sit inside `folder`
 */
function inside(folder, file) {
  const path = resolve(folder, file);
  const from = relative(folder, path);
  if (from === "" || from.startsWith(`..${sep}`) || from === "..") {
    throw new Error(`${file} would sit outside ${folder}`);
  }
  return path;
}

/**
 * Checks that every rated-audio row's FLAC exists in `folder` and decodes to the PCM its row
 * hashes, and throws listing every one that doesn't.
 * @param {Store} store
 * @param {string} folder the rated-audio folder
 * @returns {Promise<number>} how many files were checked
 */
export async function checkRatedAudio(store, folder) {
  const rows = listRatedAudio(store);
  /** @type {string[]} */
  const problems = [];
  for (const row of rows) {
    try {
      const path = inside(folder, row.file);
      if (!existsSync(path)) throw new Error(`${row.file} is missing`);
      const actual = await pcmHash(path);
      if (actual !== row.pcmSha256) {
        throw new Error(`${row.file}'s PCM hashes to ${actual}, its row says ${row.pcmSha256}`);
      }
    } catch (error) {
      problems.push(`rated_audio ${row.id}: ${/** @type {Error} */ (error).message}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `${problems.length} of ${rows.length} rated excerpts fail:\n${problems.join("\n")}`,
    );
  }
  return rows.length;
}

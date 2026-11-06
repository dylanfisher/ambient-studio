// Where a path really is, symlinks followed, when that is inside a given folder (decision 0025).
import { realpath } from "node:fs/promises";
import { join, sep } from "node:path";

/**
 * The real path of `segments` under `folder`, or undefined when it doesn't exist or its real
 * path, symlinks followed, is outside `folder`.
 * @param {string} folder
 * @param {string[]} segments joined onto `folder`; a `..` or an absolute one is caught by the
 *   containment check
 * @returns {Promise<string | undefined>}
 */
export async function realPathInside(folder, segments) {
  /** @type {string} */
  let real;
  try {
    real = await realpath(join(folder, ...segments));
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
  return real.startsWith((await realpath(folder)) + sep) ? real : undefined;
}

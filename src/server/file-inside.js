// A regular file at a path whose real location, symlinks followed, is inside a given folder
// (decision 0025). Every way a request's path can name no such file is "not found", so a
// client can't turn a bad name into a 500 that shows a server path.
import { realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";

/**
 * The error codes that mean a request's path names no file it may have: missing, a file where
 * a folder should be, too long, a symlink loop, unreadable, or a NUL in the name.
 */
const MISSING = new Set([
  "ENOENT",
  "ENOTDIR",
  "ENAMETOOLONG",
  "ELOOP",
  "EACCES",
  "ERR_INVALID_ARG_VALUE",
]);

/**
 * Whether a file-system error means the requested file isn't there for the client, as opposed
 * to a fault in the server.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isMissing(error) {
  return MISSING.has(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? "");
}

/**
 * The real path and size of the regular file `segments` names under `folder`, or undefined when
 * there is none or its real path is outside `folder`.
 * @param {string} folder
 * @param {string[]} segments joined onto `folder`; a `..` or an absolute one is caught by the
 *   containment check
 * @returns {Promise<{ path: string, size: number } | undefined>}
 */
export async function fileInside(folder, segments) {
  try {
    const path = await realpath(join(folder, ...segments));
    if (!path.startsWith((await realpath(folder)) + sep)) return undefined;
    const info = await stat(path);
    return info.isFile() ? { path, size: info.size } : undefined;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

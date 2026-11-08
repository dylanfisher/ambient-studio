// A backup is a dated folder under the backups folder holding a VACUUM INTO copy of the
// database and copies of the rated-audio and references folders (decisions 0021 and 0050).
/** @import { Paths } from "../config/paths.js" */
import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { backupDatabase } from "./store.js";

/**
 * @typedef {object} Backup
 * @property {string} folder
 * @property {string} database
 * @property {string} ratedAudio
 * @property {string} references
 */

/**
 * The backup folder's name for `when`: its UTC time to the second, `2026-11-06T21-04-05Z`,
 * without the colons macOS Finder shows as slashes.
 * @param {Date} when
 */
const folderName = (when) => `${when.toISOString().slice(0, 19).replaceAll(":", "-")}Z`;

/**
 * Copies a folder that is only ever added to, or makes an empty one when it doesn't exist yet:
 * nothing has been rated or uploaded until it does.
 * @param {string} from
 * @param {string} to must not exist
 */
async function copyFolder(from, to) {
  if (existsSync(from)) {
    await cp(from, to, { recursive: true, errorOnExist: true, force: false });
  } else {
    await mkdir(to);
  }
}

/**
 * Writes a backup. The database is copied first, from a read-only connection, so writers carry
 * on; rated audio and references are only ever added, so a file written after that copy is
 * extra, never missing. Throws when a backup with the same name exists.
 * @param {Paths} dataPaths
 * @param {Date} when
 * @returns {Promise<Backup>}
 */
export async function backup(dataPaths, when) {
  const folder = join(dataPaths.backups, folderName(when));
  await mkdir(dataPaths.backups, { recursive: true });
  await mkdir(folder);
  const made = {
    folder,
    database: join(folder, basename(dataPaths.database)),
    ratedAudio: join(folder, basename(dataPaths.ratedAudio)),
    references: join(folder, basename(dataPaths.references)),
  };
  backupDatabase(dataPaths.database, made.database);
  await copyFolder(dataPaths.ratedAudio, made.ratedAudio);
  await copyFolder(dataPaths.references, made.references);
  return made;
}

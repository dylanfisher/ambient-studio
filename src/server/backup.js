// A backup is a dated folder under the backups folder holding a VACUUM INTO copy of the
// database and a copy of the rated-audio folder (decision 0021).
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
 */

/**
 * The backup folder's name for `when`: its UTC time to the second, `2026-11-06T21-04-05Z`,
 * without the colons macOS Finder shows as slashes.
 * @param {Date} when
 */
const folderName = (when) => `${when.toISOString().slice(0, 19).replaceAll(":", "-")}Z`;

/**
 * Writes a backup. The database is copied first, from a read-only connection, so writers carry
 * on; rated audio is only ever added, so a file written after that copy is extra, never
 * missing. Throws when a backup with the same name exists.
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
  };
  backupDatabase(dataPaths.database, made.database);
  // Nothing has been rated until the folder exists.
  if (existsSync(dataPaths.ratedAudio)) {
    await cp(dataPaths.ratedAudio, made.ratedAudio, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  } else {
    await mkdir(made.ratedAudio);
  }
  return made;
}

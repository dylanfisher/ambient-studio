// The index of the field-recordings folder (decision 0029): every WAV, FLAC and AIFF file in it
// and its subfolders, with the SHA-256 that genomes name it by and the shape its header gives.
// It runs when a caller asks; nothing watches the folder.
/** @import { RecordingListing } from "../domain/recordings-text.js" */
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { readAudioHeader } from "./audio-header.js";
import { sha256Hex } from "./sha256-hex.js";

/** Extensions the index reads, lowercase. */
const EXTENSIONS = Object.freeze([".wav", ".flac", ".aif", ".aiff"]);

/**
 * @typedef {RecordingListing & { path: string; size: number; mtimeMs: number }} RecordingEntry
 *   `path` absolute; `size` and `mtimeMs` tell a later index the file is unchanged
 */

/**
 * @param {string} file relative to the folder
 * @returns {boolean}
 */
const listed = (file) =>
  EXTENSIONS.includes(extname(file).toLowerCase()) &&
  !file.split(sep).some((part) => part.startsWith("."));

/**
 * Indexes `folder`. An entry of `previous` whose file has the same size and modification time
 * is kept without reading the file again; every other file is read, hashed and its header
 * parsed, one at a time. Hidden files and folders are skipped. Throws, naming the file, on one
 * whose header can't be read.
 * @param {string} folder absolute
 * @param {readonly RecordingEntry[]} [previous] an earlier index of the same folder
 * @returns {Promise<RecordingEntry[]>} sorted by file
 */
export async function indexRecordings(folder, previous = []) {
  const known = new Map(previous.map((entry) => [entry.path, entry]));
  const found = await readdir(folder, { recursive: true, withFileTypes: true });
  const files = found
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)))
    .filter(listed)
    .sort();
  /** @type {RecordingEntry[]} */
  const entries = [];
  for (const file of files) {
    const path = join(folder, file);
    const { size, mtimeMs } = await stat(path);
    const old = known.get(path);
    if (old && old.size === size && old.mtimeMs === mtimeMs) {
      entries.push(old);
      continue;
    }
    const bytes = await readFile(path);
    const { channels, sampleRate, frames } = readAudioHeader(bytes, path);
    entries.push({
      file,
      hash: sha256Hex(bytes),
      duration: frames / sampleRate,
      channels,
      sampleRate,
      path,
      size,
      mtimeMs,
    });
  }
  return entries;
}

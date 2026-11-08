// The playback MP3 of a span of a reference (decision 0050), made from `decodeWithFfmpeg`'s
// samples by 4i's `writeMp3` (0048), so what the owner hears is what the analysis reads. Derived:
// kept in the reference cache, named by the file's hash and the span in milliseconds.
/** @import { Paths } from "../config/paths.js" */
/** @import { ReferenceFile } from "./reference-store.js" */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { regionSeconds } from "../domain/reference-region.js";
import { decodeWithFfmpeg } from "./decode-with-ffmpeg.js";
import { encodePcm24 } from "./encode-pcm24.js";
import { MP3_EXTENSION, writeMp3 } from "./write-mp3.js";

/** Milliseconds in a second; a span is named, and decoded, to the millisecond. */
const MS = 1000;

/** The MP3s being made, by path, so two requests for one span share one decode. */
const making = new Map();

/**
 * The cached MP3 of `start` to `end` seconds of the file, made first when it isn't there. The
 * bounds are rounded to the millisecond before decoding, so a name always holds the audio of
 * exactly the span it names.
 * @param {Paths} dataPaths
 * @param {ReferenceFile} reference
 * @param {number} start seconds, checked by the caller
 * @param {number} end
 * @returns {Promise<string>} the MP3's path
 */
export async function regionMp3(dataPaths, reference, start, end) {
  const [from, to] = [regionSeconds(start), regionSeconds(end)];
  const path = join(
    dataPaths.referenceCache,
    `${reference.sha256}-${Math.round(from * MS)}-${Math.round(to * MS)}${MP3_EXTENSION}`,
  );
  if (existsSync(path)) return path;
  const pending = making.get(path);
  if (pending) return pending;
  const made = makeMp3(join(dataPaths.references, reference.file), from, to, dataPaths, path);
  making.set(path, made);
  try {
    return await made;
  } finally {
    making.delete(path);
  }
}

/**
 * Decodes the span and encodes it to `path`, through a temp file and a rename.
 * @param {string} source
 * @param {number} from seconds
 * @param {number} to
 * @param {Paths} dataPaths
 * @param {string} path
 * @returns {Promise<string>}
 */
async function makeMp3(source, from, to, dataPaths, path) {
  const decoded = await decodeWithFfmpeg(source, from, to);
  await mkdir(dataPaths.referenceCache, { recursive: true });
  const temp = join(dataPaths.referenceCache, `mp3-${randomUUID()}${MP3_EXTENSION}`);
  try {
    await writeMp3(temp, encodePcm24(decoded.channels), {
      channelCount: decoded.channels.length,
      sampleRate: decoded.sampleRate,
    });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return path;
}

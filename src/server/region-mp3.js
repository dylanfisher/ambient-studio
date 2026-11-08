// The playback MP3 of a span of a reference (decision 0050), made from `decodeWithFfmpeg`'s
// samples by 4i's `writeMp3` (0048), so what the owner hears is what the analysis reads. Derived:
// kept in the reference cache, named by the file's hash and the span in milliseconds.
/** @import { Paths } from "../config/paths.js" */
/** @import { ReferenceFile } from "./reference-store.js" */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { decodeWithFfmpeg } from "./decode-with-ffmpeg.js";
import { encodePcm24 } from "./encode-pcm24.js";
import { MP3_EXTENSION, writeMp3 } from "./write-mp3.js";

/** Milliseconds in a second; a span is named, and decoded, to the millisecond. */
const MS = 1000;

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
  const [from, to] = [Math.round(start * MS), Math.round(end * MS)];
  const path = join(dataPaths.referenceCache, `${reference.sha256}-${from}-${to}${MP3_EXTENSION}`);
  if (existsSync(path)) return path;
  const decoded = await decodeWithFfmpeg(
    join(dataPaths.references, reference.file),
    from / MS,
    to / MS,
  );
  await mkdir(dataPaths.referenceCache, { recursive: true });
  // Two requests for one span can both get here; each writes its own file and the rename keeps
  // one, so neither reads half a file.
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

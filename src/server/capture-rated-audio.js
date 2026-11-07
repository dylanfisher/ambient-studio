// Keeps a heard excerpt as rated audio (decisions 0021, 0026). Renders are derived and get
// replaced, so a rating needs its own copy of what was heard: a FLAC under the rated-audio
// folder, with the PCM hash `checkRatedAudio` verifies and the gain applied. The render cache
// holds only the playback MP3, so the exact PCM comes from rendering the excerpt again (0048).
/** @import { Paths } from "../config/paths.js" */
/** @import { RatedAudio } from "./rating-store.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { Store } from "./store.js" */
import { link, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { pcmHash } from "./check-rated-audio.js";
import { encodePcm24 } from "./encode-pcm24.js";
import { PRODUCER } from "./producer.js";
import { addRatedAudio, findRatedAudio } from "./rating-store.js";
import { renderHeardAgain } from "./render-excerpt.js";
import { getRender } from "./render-store.js";
import { writeFlac } from "./write-flac.js";
import { writeWav } from "./write-wav.js";

/**
 * The rated-audio row for the excerpt render `renderId` holds, written with its FLAC the first
 * time and reused after. Throws for a render made under another producer: its audio may not be
 * what this engine version renders, and the row would say it is.
 * @param {Store} store
 * @param {Pick<Paths, "ratedAudio">} paths
 * @param {number} renderId
 * @param {() => Promise<readonly RecordingEntry[]>} recordings the recordings folder's index,
 *   read only when the excerpt is rendered again
 * @returns {Promise<RatedAudio>}
 */
export async function captureRatedAudio(store, { ratedAudio }, renderId, recordings) {
  const render = getRender(store, renderId);
  if (!render) throw new Error(`there is no render ${renderId} to capture`);
  if (render.producer !== PRODUCER) {
    throw new Error(
      `render ${renderId} was made under producer ${render.producer}, and this server is ${PRODUCER}; render the excerpt again before rating it`,
    );
  }
  const { genomeId, seed, offset, duration, target } = render;
  const heard = { genomeId, seed, offset, duration, engineVersion: ENGINE_VERSION, target };
  const found = findRatedAudio(store, heard);
  if (found) return found;

  const { channels, sampleRate, gainDb } = await renderHeardAgain(
    store,
    render,
    await recordings(),
  );
  const file = `${genomeId}-seed${seed}-${duration}s-engine${ENGINE_VERSION}-${target}LUFS.flac`;
  await mkdir(ratedAudio, { recursive: true });
  const temp = await mkdtemp(join(ratedAudio, ".capture-"));
  const keep = async () => {
    const staged = join(temp, file);
    const wav = join(temp, "heard.wav");
    await writeWav(wav, encodePcm24(channels), { channelCount: channels.length, sampleRate });
    await writeFlac(wav, staged);
    const pcmSha256 = await pcmHash(staged);
    // link, not rename: it refuses a name that's taken, and a rated file is never replaced.
    try {
      await link(staged, join(ratedAudio, file));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
      // Another capture of this excerpt, running at the same time, linked first and wrote its row.
      const written = findRatedAudio(store, heard);
      if (written) return written;
      throw new Error(
        `${file} is already in ${ratedAudio} with no rated_audio row; move it aside to capture this excerpt`,
        { cause: error },
      );
    }
    return addRatedAudio(store, { ...heard, file, pcmSha256, gainDb });
  };
  /** @type {RatedAudio} */
  let kept;
  try {
    kept = await keep();
  } catch (error) {
    // A cleanup that fails too is reported with the capture's own error, which it must not hide.
    await rm(temp, { recursive: true }).catch((/** @type {Error} */ cleanup) => {
      throw new Error(
        `${/** @type {Error} */ (error).message}; removing ${temp} afterwards failed too: ${cleanup.message}`,
        { cause: error },
      );
    });
    throw error;
  }
  await rm(temp, { recursive: true });
  return kept;
}

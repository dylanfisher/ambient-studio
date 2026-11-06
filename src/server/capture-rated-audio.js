// Keeps a heard excerpt as rated audio (decisions 0021, 0026). Renders are derived and get
// replaced, so a rating needs its own copy of what was heard: the cached WAV as a FLAC under the
// rated-audio folder, with the PCM hash `checkRatedAudio` verifies and the gain applied.
/** @import { Paths } from "../config/paths.js" */
/** @import { Features } from "../domain/extract-features.js" */
/** @import { RatedAudio } from "./rating-store.js" */
/** @import { Store } from "./store.js" */
import { link, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { pcmHash } from "./check-rated-audio.js";
import { PRODUCER } from "./producer.js";
import { addRatedAudio, findRatedAudio } from "./rating-store.js";
import { getRender } from "./render-store.js";
import { writeFlac } from "./write-flac.js";

/**
 * The rated-audio row for the excerpt render `renderId` holds, written with its FLAC the first
 * time and reused after. Throws for a render made under another producer: its audio may not be
 * what this engine version renders, and the row would say it is.
 * @param {Store} store
 * @param {Pick<Paths, "renderCache" | "ratedAudio">} paths
 * @param {number} renderId
 * @returns {Promise<RatedAudio>}
 */
export async function captureRatedAudio(store, { renderCache, ratedAudio }, renderId) {
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

  // A render normalize couldn't lift is cached as rendered, so no gain was applied (0026).
  const gainDb = /** @type {Features} */ (render.features).heard?.gainDb ?? 0;
  const file = `${genomeId}-seed${seed}-${duration}s-engine${ENGINE_VERSION}-${target}LUFS.flac`;
  await mkdir(ratedAudio, { recursive: true });
  const temp = await mkdtemp(join(ratedAudio, ".capture-"));
  try {
    const staged = join(temp, file);
    await writeFlac(join(renderCache, render.file), staged);
    const pcmSha256 = await pcmHash(staged);
    // link, not rename: it refuses a name that's taken, and a rated file is never replaced.
    try {
      await link(staged, join(ratedAudio, file));
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
      throw new Error(
        `${file} is already in ${ratedAudio} with no rated_audio row; move it aside to capture this excerpt`,
        { cause: error },
      );
    }
    return addRatedAudio(store, { ...heard, file, pcmSha256, gainDb });
  } finally {
    await rm(temp, { recursive: true });
  }
}

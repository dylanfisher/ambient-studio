// The owner-started embed job (decision 0042): fetches the CLAP checkpoint when it is missing,
// drops every embedding made under another producer, and embeds every live rated audio and
// every excerpt render under this server's producer that has no embedding; a render of another
// window, such as a track section's, is left out (0061). Nothing else starts it.
/** @import { EmbeddingSource } from "./embedding-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isExcerptWindow } from "./candidate-excerpt.js";
import { embedAudio, readEmbedder } from "./embed-audio.js";
import { dropOtherEmbeddings, findEmbedding } from "./embedding-store.js";
import { JOB_STEP } from "./job-steps.js";
import { PRODUCER } from "./producer.js";
import { listRatedAudio } from "./rating-store.js";
import { listRenders } from "./render-store.js";

/**
 * @typedef {object} EmbedJobResult
 * @property {string} producer the embeddings' producer
 * @property {number} dropped rows deleted because another producer made them
 * @property {number} embedded rows written
 */

/**
 * Every live rated audio and excerpt render with no embedding under `producer`, and each rated
 * audio whose file is missing. `producer` is null when no embedding exists yet, so the sidecar
 * isn't asked for one: then every excerpt is wanted. The job and the Model test page's status
 * both count from here.
 * @param {App} app
 * @param {string | null} producer
 */
export function excerptsToEmbed(app, producer) {
  /** @param {EmbeddingSource} source */
  const embedded = (source) =>
    producer !== null && findEmbedding(app.store, source, producer) !== undefined;
  /** @type {{ source: EmbeddingSource, file: string }[]} */
  const wanted = [];
  /** @type {string[]} */
  const failed = [];
  for (const row of listRatedAudio(app.store)) {
    if (row.removedAt !== null) continue;
    const file = join(app.paths.ratedAudio, row.file);
    const source = { ratedAudioId: row.id, renderId: null };
    if (embedded(source)) continue;
    // Rated audio is irreplaceable, so a missing file is a failure, not a skip.
    if (existsSync(file)) wanted.push({ source, file });
    else failed.push(`${file} is missing`);
  }
  for (const row of listRenders(app.store, PRODUCER)) {
    if (!isExcerptWindow(app.store, row)) continue;
    const file = join(app.paths.renderCache, row.file);
    const source = { ratedAudioId: null, renderId: row.id };
    // A render whose file is gone is rendered again on its next request, under a new id.
    if (existsSync(file) && !embedded(source)) wanted.push({ source, file });
  }
  return { wanted, failed };
}

/**
 * The job. A rated-audio file that is missing, or a file the sidecar fails on, doesn't stop
 * the rest: the job embeds every other file, then fails naming each file that failed, so the
 * owner sees every one and the rows written stay. A cancel stops it at once.
 * @param {App} app
 * @returns {(job: JobContext) => Promise<EmbedJobResult>}
 */
export function embedJob(app) {
  return async ({ signal, progress }) => {
    progress(0, 0, JOB_STEP.fetchingEmbedder);
    const embedder = await readEmbedder(app, { fetch: true, signal });
    if (typeof embedder === "string") throw new Error(embedder);
    const { producer } = embedder;
    const dropped = dropOtherEmbeddings(app.store, producer);

    const { wanted, failed } = excerptsToEmbed(app, producer);

    let embedded = 0;
    for (const [index, { source, file }] of wanted.entries()) {
      progress(index, wanted.length, JOB_STEP.embeddingExcerpt(index + 1, wanted.length));
      signal.throwIfAborted();
      try {
        await embedAudio(app, embedder, source, file, signal);
        embedded++;
      } catch (error) {
        if (signal.aborted) throw error;
        failed.push(/** @type {Error} */ (error).message);
      }
    }
    progress(wanted.length, wanted.length, null);
    if (failed.length > 0) {
      throw new Error(
        `embedded ${embedded} excerpts, and ${failed.length} failed:\n${failed.join("\n")}`,
      );
    }
    return { producer, dropped, embedded };
  };
}

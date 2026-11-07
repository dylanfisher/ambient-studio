// The owner-started embed job (decision 0042): fetches the CLAP checkpoint when it is missing,
// drops every embedding made under another producer, and embeds every live rated audio and
// every render under this server's producer that has no embedding. Nothing else starts it.
/** @import { EmbeddingSource } from "./embedding-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
import { existsSync } from "node:fs";
import { join } from "node:path";
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
 * The job. A failure stops it with the file named, and the rows written before it stay.
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

    /** @type {{ source: EmbeddingSource, file: string }[]} */
    const wanted = [];
    for (const row of listRatedAudio(app.store)) {
      if (row.removedAt !== null) continue;
      const source = { ratedAudioId: row.id, renderId: null };
      if (!findEmbedding(app.store, source, producer)) {
        wanted.push({ source, file: join(app.paths.ratedAudio, row.file) });
      }
    }
    for (const row of listRenders(app.store, PRODUCER)) {
      const file = join(app.paths.renderCache, row.file);
      const source = { ratedAudioId: null, renderId: row.id };
      // A render whose file is gone is rendered again on its next request, under a new id.
      if (existsSync(file) && !findEmbedding(app.store, source, producer)) {
        wanted.push({ source, file });
      }
    }

    for (const [index, { source, file }] of wanted.entries()) {
      progress(index, wanted.length, JOB_STEP.embeddingExcerpt(index + 1, wanted.length));
      signal.throwIfAborted();
      await embedAudio(app, embedder, source, file, signal);
    }
    progress(wanted.length, wanted.length, null);
    return { producer, dropped, embedded: wanted.length };
  };
}

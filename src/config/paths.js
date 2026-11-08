// Where the app keeps its data, all under the config's `dataRoot` (decision 0019).
import { join } from "node:path";

/**
 * @typedef {object} Paths
 * @property {string} database the SQLite file
 * @property {string} renderCache cached excerpt renders
 * @property {string} ratedAudio the excerpts the owner rated, kept as heard
 * @property {string} backups
 * @property {string} models preference models, derived, each named by its model key
 * @property {string} rankings each session's ranking under its taste model, derived, by session id
 * @property {string} textEmbeddings CLAP embeddings of vibe briefs, derived, each named by the
 *   hash of its producer and text
 */

/**
 * @param {string} dataRoot absolute
 * @returns {Paths}
 */
export function paths(dataRoot) {
  return {
    database: join(dataRoot, "studio.db"),
    renderCache: join(dataRoot, "renders"),
    ratedAudio: join(dataRoot, "rated_audio"),
    backups: join(dataRoot, "backups"),
    models: join(dataRoot, "models"),
    rankings: join(dataRoot, "rankings"),
    textEmbeddings: join(dataRoot, "text-embeddings"),
  };
}

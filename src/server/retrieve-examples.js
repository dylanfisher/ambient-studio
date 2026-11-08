// The rated genomes a generation prompt shows the model (decision 0024): the liked and disliked
// nearest the vibe's brief in CLAP text-to-audio similarity when their rated audio has
// embeddings, and the newest otherwise. The method's name is logged with each generation, so
// one method's results can be told from another's.
/** @import { PromptExample } from "../domain/build-prompt.js" */
/** @import { RatedGenome } from "./rating-store.js" */
/** @import { Store } from "./store.js" */
import { meanSimilarity } from "../domain/mean-similarity.js";
import { ratedAudioEmbeddings } from "./embedding-store.js";
import { getGenome } from "./generation-store.js";
import { listRatedGenomes } from "./rating-store.js";

/** How the examples were chosen, stored as each generation's `retrievalMethod`. */
export const RETRIEVAL_METHOD = Object.freeze({
  ratingRecency: "rating-recency",
  clapSimilarity: "clap-similarity",
  /** A prompt that shows no rated genomes, as a proposal's (decision 0067). */
  none: "none",
});

/** The most liked, and the most disliked, examples one prompt shows. */
export const EXAMPLES_PER_SIDE = 3;

/**
 * Embeds a text under `producer`, the producer of the audio embeddings it is compared with.
 * `what` names the text in an error.
 * @typedef {object} TextEmbedder
 * @property {string} producer
 * @property {(text: string, what: string) => Promise<Float32Array>} embedText
 */

/**
 * `rated`, recency order kept, with the genomes in `similarity` moved to the front, nearest
 * first.
 * @param {RatedGenome[]} rated
 * @param {Map<number, number>} similarity by genome id
 */
function nearestFirst(rated, similarity) {
  const embedded = rated.filter((r) => similarity.has(r.genomeId));
  const rest = rated.filter((r) => !similarity.has(r.genomeId));
  const of = (/** @type {RatedGenome} */ r) => /** @type {number} */ (similarity.get(r.genomeId));
  // The sort is stable, so genomes equally near keep their recency order.
  return [...embedded.sort((a, b) => of(b) - of(a)), ...rest];
}

/**
 * Up to `EXAMPLES_PER_SIDE` liked and disliked genomes, alternating and liked first, so trimming
 * the prompt from the end drops the furthest of both sides. With `embedder`, and any liked or
 * disliked genome whose rated audio has an embedding under its producer, the brief is embedded
 * and those genomes come first on their side, nearest first, by the mean of their rated audio's
 * embeddings; the rest follow, newest first. Otherwise every genome is in recency order and the
 * brief isn't embedded.
 * @param {Store} store
 * @param {number} vibeId
 * @param {string} brief
 * @param {TextEmbedder | null} embedder null when the sidecar has no checkpoint
 * @returns {Promise<{ method: string, examples: PromptExample[] }>}
 */
export async function retrieveExamples(store, vibeId, brief, embedder) {
  const rated = listRatedGenomes(store, vibeId);
  let liked = rated.filter((r) => r.score > 0);
  let disliked = rated.filter((r) => r.score < 0);
  /** @type {string} */
  let method = RETRIEVAL_METHOD.ratingRecency;
  if (embedder) {
    /** @type {Map<number, Float32Array[]>} */
    const audio = new Map();
    for (const { genomeId } of [...liked, ...disliked]) {
      const vectors = ratedAudioEmbeddings(store, genomeId, embedder.producer);
      if (vectors.length > 0) audio.set(genomeId, vectors);
    }
    if (audio.size > 0) {
      const text = await embedder.embedText(brief, "the vibe's brief");
      const similarity = new Map(
        [...audio].map(([genomeId, vectors]) => [genomeId, meanSimilarity(vectors, text)]),
      );
      liked = nearestFirst(liked, similarity);
      disliked = nearestFirst(disliked, similarity);
      method = RETRIEVAL_METHOD.clapSimilarity;
    }
  }
  liked = liked.slice(0, EXAMPLES_PER_SIDE);
  disliked = disliked.slice(0, EXAMPLES_PER_SIDE);
  /** @type {PromptExample[]} */
  const examples = [];
  for (let i = 0; i < EXAMPLES_PER_SIDE; i++) {
    for (const [side, isLiked] of /** @type {const} */ ([
      [liked, true],
      [disliked, false],
    ])) {
      const pick = side[i];
      if (pick === undefined) continue;
      const row = getGenome(store, pick.genomeId);
      if (!row) throw new Error(`rated genome ${pick.genomeId} has no row`);
      examples.push({ id: row.id, liked: isLiked, genome: row.genome });
    }
  }
  return { method, examples };
}

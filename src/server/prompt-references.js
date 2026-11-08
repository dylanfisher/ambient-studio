// The regions attached to a vibe as its first prompt reads them (decision 0052): each region's
// windows from its analysis at the brief's loudness, and the vocabulary's words nearest its sound
// when it was embedded under the sidecar's checkpoint. The words' text embeddings come through
// `embedText`'s cache, so the sidecar embeds each word once per checkpoint.
/** @import { PromptReference } from "../domain/references-text.js" */
/** @import { TextEmbedder } from "./retrieve-examples.js" */
/** @import { Store } from "./store.js" */
import { ATTACHMENT_KIND } from "../domain/attachment-kind.js";
import { nearestWords, REFERENCE_WORDS } from "../domain/reference-words.js";
import { listAttachments } from "./attachment-store.js";
import { vectorFloats } from "./embedding-store.js";
import { currentRevision } from "./generate-candidates.js";
import { PRODUCER } from "./producer.js";
import { getRegion } from "./reference-store.js";
import { findRegionAnalysis } from "./region-analysis-store.js";
import { vibeLoudness } from "./render-excerpt.js";

/**
 * The vocabulary's text embeddings under the embedder's producer, in the vocabulary's order.
 * @param {TextEmbedder} embedder
 * @returns {Promise<Map<string, Float32Array>>}
 */
async function wordVectors(embedder) {
  /** @type {Map<string, Float32Array>} */
  const vectors = new Map();
  for (const word of REFERENCE_WORDS) {
    vectors.set(word, await embedder.embedText(word, `the word "${word}"`));
  }
  return vectors;
}

/**
 * The vibe's live reference attachments, oldest first. Throws, naming the region, when one has
 * no analysis at the current revision's loudness under this server's producer: the prompt would
 * otherwise go without measurements the owner attached.
 * @param {Store} store
 * @param {number} vibeId
 * @param {TextEmbedder | null} embedder null when the sidecar has no checkpoint; the regions
 *   then have no words
 * @returns {Promise<PromptReference[]>}
 */
export async function promptReferences(store, vibeId, embedder) {
  const attachments = listAttachments(store, vibeId, ATTACHMENT_KIND.reference);
  if (attachments.length === 0) return [];
  const target = vibeLoudness(currentRevision(store, vibeId).constraints);
  /** @type {Map<string, Float32Array> | null} */
  let words = null;
  /** @type {PromptReference[]} */
  const references = [];
  for (const { id, regionId } of attachments) {
    const region = getRegion(store, /** @type {number} */ (regionId));
    if (!region) throw new Error(`attachment ${id} names region ${regionId}, which has no row`);
    const analysis = findRegionAnalysis(store, { regionId: region.id, target, producer: PRODUCER });
    if (!analysis) {
      throw new Error(
        `region ${region.id} (${JSON.stringify(region.label)}), attached to this brief, isn't analyzed at its loudness, ${target} LUFS; analyze it again from the brief page, or detach it`,
      );
    }
    const embedded =
      embedder !== null &&
      analysis.embedding !== null &&
      analysis.embeddingProducer === embedder.producer;
    if (embedded) words ??= await wordVectors(embedder);
    references.push({
      id,
      label: region.label,
      note: region.note,
      windows: analysis.windows.map((window) => window.features),
      words:
        embedded && words !== null
          ? nearestWords(vectorFloats(/** @type {Uint8Array} */ (analysis.embedding)), words)
          : [],
    });
  }
  return references;
}

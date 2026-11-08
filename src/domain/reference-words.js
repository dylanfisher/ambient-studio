// The plain words a reference region is described by in the prompt (decision 0052): each is
// embedded as text by CLAP, and a region gets the few nearest its own embedding, so the words
// are measured rather than written by hand. Changing the list changes which words a region can
// get; the cached embeddings of the words kept stay valid.
import { meanSimilarity } from "./mean-similarity.js";

/** The fixed vocabulary, about 60 words a listener would use. */
export const REFERENCE_WORDS = Object.freeze([
  "dark",
  "bright",
  "warm",
  "cold",
  "airy",
  "dense",
  "sparse",
  "soft",
  "harsh",
  "smooth",
  "rough",
  "gritty",
  "clear",
  "muddy",
  "hazy",
  "glassy",
  "metallic",
  "wooden",
  "breathy",
  "hollow",
  "deep",
  "thin",
  "low",
  "piercing",
  "droning",
  "pulsing",
  "rhythmic",
  "still",
  "slow",
  "drifting",
  "swelling",
  "fading",
  "shimmering",
  "sparkling",
  "rumbling",
  "hissing",
  "crackling",
  "humming",
  "ringing",
  "watery",
  "underwater",
  "windy",
  "rainy",
  "distant",
  "intimate",
  "wide",
  "narrow",
  "spacious",
  "reverberant",
  "dry",
  "calm",
  "tense",
  "eerie",
  "sad",
  "peaceful",
  "dreamy",
  "ominous",
  "noisy",
  "tonal",
  "mechanical",
]);

/** The most words one region is described by. */
export const WORDS_PER_REFERENCE = 5;

/**
 * The `WORDS_PER_REFERENCE` words whose text embedding is nearest `sound` by cosine, nearest
 * first; words equally near keep their order in `words`.
 * @param {Float32Array} sound the region's embedding
 * @param {ReadonlyMap<string, Float32Array>} words each word's text embedding, in one space
 *   with `sound`
 * @returns {string[]}
 */
export function nearestWords(sound, words) {
  return [...words]
    .map(([word, vector]) => ({ word, similarity: meanSimilarity([vector], sound) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, WORDS_PER_REFERENCE)
    .map(({ word }) => word);
}

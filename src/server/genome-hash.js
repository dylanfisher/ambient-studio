import { canonicalGenome } from "../engine/canonical-genome.js";
import { sha256Hex } from "./sha256-hex.js";

/**
 * SHA-256 of the canonical genome, in hex, which tells when two sources produced the same
 * genome (decision 0005). Throws on an invalid genome.
 * @param {unknown} genome
 * @returns {string}
 */
export function genomeHash(genome) {
  return sha256Hex(canonicalGenome(genome));
}

// The one text form of a genome, which src/server hashes to find duplicates (decision 0005).
import { isObject } from "./is-object.js";
import { validateGenome } from "./validate-genome.js";

/**
 * JSON with object keys sorted at every level; arrays keep their order. JSON.stringify already
 * writes numbers in shortest round-trip form, and -0 as 0.
 * @param {unknown} value
 * @returns {string}
 */
function sortedJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (isObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${sortedJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The normalized genome as canonical JSON: defaults written out, keys sorted, voices sorted by
 * id. Two genomes that differ only in key order, voice order or omitted defaults give the same
 * text. Throws on an invalid genome.
 * @param {unknown} genome
 */
export function canonicalGenome(genome) {
  const result = validateGenome(genome);
  if (!result.ok) {
    const list = result.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`can't canonicalize an invalid genome: ${list}`);
  }
  const voices = [...result.genome.voices].sort((a, b) => (a.id < b.id ? -1 : 1));
  return sortedJson({ ...result.genome, voices });
}

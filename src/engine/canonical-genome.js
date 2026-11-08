// The one text form of a genome, which src/server hashes to find duplicates (decision 0005), and
// the shorter form the prompt shows (decision 0072).
/** @import { DescriptorTable } from "./descriptor.js" */
import { GLOBAL_PARAMS, MACROS } from "./genome-schema.js";
import { isObject } from "./is-object.js";
import { requireGenome } from "./validate-genome.js";
import { voiceParams } from "./voice-registry.js";

/**
 * JSON with object keys sorted at every level; arrays keep their order. JSON.stringify already
 * writes numbers in shortest round-trip form, and -0 as 0.
 * @param {unknown} value
 * @returns {string}
 */
export function sortedJson(value) {
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
  const normalized = requireGenome(genome, "can't canonicalize an invalid genome");
  const voices = [...normalized.voices].sort((a, b) => (a.id < b.id ? -1 : 1));
  return sortedJson({ ...normalized, voices });
}

/**
 * `values` without the entries `table` gives a default that they equal. A trajectory is an
 * object, so it is never equal to a default and always stays.
 * @param {Readonly<Record<string, unknown>>} values
 * @param {DescriptorTable} table
 */
const withoutDefaults = (values, table) =>
  Object.fromEntries(
    Object.entries(values).filter(([key, value]) => {
      const descriptor = table[key];
      return !(descriptor && "default" in descriptor && value === descriptor.default);
    }),
  );

/**
 * The normalized genome as canonical JSON with every value at its default left out, and
 * `macros` with it when every macro is. Validating it gives the genome back. The prompt shows
 * genomes this way, since its schema text gives each default (decision 0072). Throws on an
 * invalid genome.
 * @param {unknown} genome
 */
export function conciseGenome(genome) {
  const { macros, voices, ...globals } = requireGenome(genome, "can't write an invalid genome");
  const changed = withoutDefaults(macros, MACROS);
  return sortedJson({
    ...withoutDefaults(globals, GLOBAL_PARAMS),
    ...(Object.keys(changed).length > 0 && { macros: changed }),
    voices: [...voices]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((voice) => withoutDefaults(voice, voiceParams(voice.type))),
  });
}

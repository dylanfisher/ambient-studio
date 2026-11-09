// What changed from a parent genome to its child (decision 0078), by the paths locks use (0035):
// a global (`reverbDecay`), a macro (`macros.space`), a voice's parameter (`voices.pad.hold`) or
// a whole voice added or removed (`voices.pad`). A trajectory is compared whole. A lineage
// reading groups them in words.
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
import { sortedJson } from "../engine/canonical-genome.js";
import { isChoice, isNumeric } from "../engine/descriptor.js";
import { GENOME_KEY, GLOBAL_PARAMS, MACROS } from "../engine/genome-schema.js";
import { voiceParams } from "../engine/voice-registry.js";
import { moveText, paramText } from "./param-text.js";

/** What happened at a path: a whole voice came or went, or a value changed. */
const CHANGE_KIND = Object.freeze(
  /** @type {const} */ ({ added: "added", removed: "removed", changed: "changed" }),
);

/**
 * A change; one on a voice's parameter names the voice's type, which says the parameter's unit.
 * @typedef {{ kind: typeof CHANGE_KIND.added | typeof CHANGE_KIND.removed, path: string, type: string }
 *   | { kind: typeof CHANGE_KIND.changed, path: string, type?: string, from: unknown, to: unknown }} GenomeChange
 */

/**
 * @param {Readonly<Record<string, Descriptor>>} table
 * @param {string} name
 */
function requireDescriptor(table, name) {
  const descriptor = table[name];
  if (!descriptor) throw new Error(`there is no parameter ${name} to write a change of`);
  return descriptor;
}

/**
 * The changed entries of one table between two holders, in the table's order.
 * @param {Readonly<Record<string, Descriptor>>} table
 * @param {Record<string, unknown>} from
 * @param {Record<string, unknown>} to
 * @param {string} prefix the path before each name, with its dot; "" for a global
 * @param {string} [type] the voice's, for a voice's parameters
 * @returns {GenomeChange[]}
 */
const changedIn = (table, from, to, prefix, type) =>
  Object.keys(table)
    .filter((name) => sortedJson(from[name]) !== sortedJson(to[name]))
    .map((name) => ({
      kind: CHANGE_KIND.changed,
      path: `${prefix}${name}`,
      ...(type !== undefined && { type }),
      from: from[name],
      to: to[name],
    }));

/**
 * Every path that differs, globals first, then macros, then the parent's voices that went, then
 * the child's voices in order, each changed or added. A voice that keeps its id but changes its
 * type is removed and added.
 * @param {Genome} parent normalized
 * @param {Genome} child normalized
 * @returns {GenomeChange[]}
 */
export function genomeChanges(parent, child) {
  /** @type {Record<string, unknown>} */
  const before = /** @type {any} */ (parent);
  /** @type {Record<string, unknown>} */
  const after = /** @type {any} */ (child);
  const voicePath = (/** @type {string} */ id) => `${GENOME_KEY.voices}.${id}`;
  const kept = (/** @type {{ id: string, type: string }} */ voice) =>
    parent.voices.find((v) => v.id === voice.id && v.type === voice.type);
  /** @type {GenomeChange[]} */
  const removed = parent.voices
    .filter((voice) => !child.voices.some((v) => v.id === voice.id && v.type === voice.type))
    .map(({ id, type }) => ({ kind: CHANGE_KIND.removed, path: voicePath(id), type }));
  return [
    ...changedIn(GLOBAL_PARAMS, before, after, ""),
    ...changedIn(MACROS, parent.macros, child.macros, `${GENOME_KEY.macros}.`),
    ...removed,
    ...child.voices.flatMap((voice) => {
      const earlier = kept(voice);
      /** @type {GenomeChange[]} */
      const added = [{ kind: CHANGE_KIND.added, path: voicePath(voice.id), type: voice.type }];
      if (!earlier) return added;
      return changedIn(
        voiceParams(voice.type),
        earlier,
        voice,
        `${voicePath(voice.id)}.`,
        voice.type,
      );
    }),
  ];
}

/** A voice's type as a reading names it, as in `a drone`. */
export const typeWords = (/** @type {string} */ type) => `a ${type}`;

/**
 * One changed parameter: a choice as `scale dorian → aeolian`, anything else with its numbers in
 * parentheses, as `root (37 → 55 Hz)`, or only its name without `values`.
 * @param {string} name
 * @param {Descriptor} descriptor
 * @param {{ from: unknown, to: unknown }} change
 * @param {boolean} values
 */
function paramChange(name, descriptor, { from, to }, values) {
  if (!values) return name;
  const words =
    typeof from === "number" && typeof to === "number" && isNumeric(descriptor)
      ? moveText(from, to, descriptor.unit)
      : `${paramText(from, descriptor)} → ${paramText(to, descriptor)}`;
  return isChoice(descriptor) ? `${name} ${words}` : `${name} (${words})`;
}

/**
 * The changes in words, grouped: the piece's, then `macros: …`, then each voice's as
 * `voice drone: …`, with voices added and removed named with their type. At most `limit`
 * changes are written, then `and N more`.
 * @param {readonly GenomeChange[]} changes from `genomeChanges`, in its order
 * @param {{ limit?: number, values?: boolean }} [options] `values` false writes only what
 *   changed, not from what to what
 * @returns {string} "" when there are none
 */
export function changesText(changes, { limit = Number.POSITIVE_INFINITY, values = true } = {}) {
  /** @type {Map<string, string[]>} group → phrases; a group's key is its heading, or the path */
  const groups = new Map();
  /** @type {Set<string>} the groups written after a heading */
  const headed = new Set();
  /**
   * @param {string} group
   * @param {string} phrase
   * @param {boolean} [heading] whether the group's key is written before its phrases
   */
  const add = (group, phrase, heading = true) => {
    groups.set(group, [...(groups.get(group) ?? []), phrase]);
    if (heading) headed.add(group);
  };
  for (const change of changes.slice(0, limit)) {
    const [head = "", second = "", name = ""] = change.path.split(".");
    if (change.kind !== CHANGE_KIND.changed) {
      add(change.path, `${change.kind} voice ${second}, ${typeWords(change.type)}`, false);
    } else if (head === GENOME_KEY.macros) {
      // Every macro shares one descriptor (0006).
      add(GENOME_KEY.macros, paramChange(second, MACROS.brightness, change, values));
    } else if (head === GENOME_KEY.voices) {
      const table = voiceParams(/** @type {string} */ (change.type));
      add(`voice ${second}`, paramChange(name, requireDescriptor(table, name), change, values));
    } else {
      add("", paramChange(head, requireDescriptor(GLOBAL_PARAMS, head), change, values), false);
    }
  }
  const more = changes.length - Math.min(limit, changes.length);
  return [
    ...[...groups].map(([group, phrases]) =>
      headed.has(group) ? `${group}: ${phrases.join(", ")}` : phrases.join(", "),
    ),
    ...(more > 0 ? [`and ${more} more`] : []),
  ].join("; ");
}

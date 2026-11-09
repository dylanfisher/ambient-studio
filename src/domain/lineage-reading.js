// How a sketch was made, as short lines the model and the owner both read (decision 0078): from
// its first ancestor to the sketch, each step's operator in the lineage page's words (0039),
// what it was asked (an explore's direction, a steer's settings, a breed's parents), its intent,
// and what changed against the step before. Over its cap, the oldest steps lose their values
// first, then the steps between the first ancestor and the newest are left out, oldest first.
/** @import { Genome } from "../engine/genome-schema.js" */
import { BREED_STAGE } from "./breed-settings.js";
import { fitReading } from "./fit-reading.js";
import { changesText, genomeChanges } from "./genome-changes.js";
import { OPERATOR } from "./operator.js";
import { operatorLabel } from "./operator-label.js";
import { numberText } from "./param-text.js";
import { quoted } from "./references-text.js";

/**
 * The most tokens the reading of a lineage takes, beside the reading of its sketch in the
 * develop prompt of step TD.3 (0078 has the arithmetic).
 */
export const LINEAGE_READING_TOKENS = 500;

/** The most changes one step lists before it says how many more. */
const MAX_LISTED_CHANGES = 8;

/** A cut step's level: its changes without values, then left out. */
const LEVEL_OF = Object.freeze({ full: 0, paths: 1, left: 2 });

/**
 * One candidate of the chain, as the route reads it from the store.
 * @typedef {object} LineageStep
 * @property {number} id the candidate's
 * @property {string | null} operator
 * @property {any} operatorParams
 * @property {readonly unknown[]} parentIds
 * @property {string | null} intent
 * @property {Genome} genome normalized
 */

/**
 * The chain from the first ancestor stored to the sketch's own candidate, with an unchanged
 * revision folded into its first try (0039).
 * @typedef {object} Lineage
 * @property {LineageStep[]} steps oldest first, at least one
 * @property {number | null} missingParentId the first step's parent when it isn't stored
 */

/** @param {unknown} id */
const candidate = (id) => `candidate ${id}`;

/**
 * What a steer chose: each direction with its slider's setting, then each region.
 * @param {any} params the step's
 * @param {(attachmentId: number) => string | null} nameOf
 */
function steerText(params, nameOf) {
  const { directions = [], regions = [] } = params?.steer ?? {};
  return [
    ...directions.map(
      (/** @type {{ id: number, setting: number }} */ { id, setting }) =>
        `, along ${nameOf(id) ?? `direction ${id}, no longer attached`} (setting ${numberText(setting, "")})`,
    ),
    ...regions.map(
      (/** @type {number} */ id) =>
        `, toward ${nameOf(id) ?? `region attachment ${id}, no longer attached`}`,
    ),
  ].join("");
}

/**
 * How the step was made from the one before, after its operator's label.
 * @param {LineageStep} step
 * @param {unknown} from the step before's id, or the missing parent's
 * @param {(attachmentId: number) => string | null} nameOf
 */
function howText({ operator, operatorParams: params, parentIds }, from, nameOf) {
  const parent = candidate(from);
  if (operator === null) return "";
  if (operator === OPERATOR.explore) {
    const toward =
      typeof params?.direction === "string" ? `, toward ${quoted(params.direction)}` : "";
    const trimmed = params?.baseTrimmed
      ? ", though the model never read it: it didn't fit in the model's context"
      : "";
    return ` of ${parent}${toward}${trimmed}`;
  }
  if (operator === OPERATOR.revise) {
    return ` from ${parent}, after its excerpt missed a range or a check`;
  }
  if (operator === OPERATOR.nudge || operator === OPERATOR.elite) {
    return ` from ${parent}, a ${params?.stepSize} step`;
  }
  if (operator === OPERATOR.optimize) return ` from ${parent}, scored by the taste model`;
  if (operator === OPERATOR.optimizeEar) {
    return ` from ${parent}, chosen by the owner over the best so far`;
  }
  if (operator === OPERATOR.steer) return ` from ${parent}${steerText(params, nameOf)}`;
  if (operator === OPERATOR.breed) {
    if (params?.stage === BREED_STAGE.mutation) return `, a ${params.stepSize} nudge of ${parent}`;
    const other = parentIds[1];
    return other === undefined
      ? ` from ${parent} alone, since the other sketch didn't fit in the model's context`
      : ` from ${parent} and ${candidate(other)}`;
  }
  throw new Error(`a lineage reading has no words for the operator ${operator}`);
}

/**
 * @param {readonly number[]} left the indexes of the steps left out, rising
 */
function leftOutLine(left) {
  const first = /** @type {number} */ (left[0]) + 1;
  const last = /** @type {number} */ (left.at(-1)) + 1;
  return first === last
    ? `Step ${first} left out for room.`
    : `Steps ${first}–${last} left out for room.`;
}

/**
 * @param {Lineage} lineage
 * @param {(attachmentId: number) => string | null} nameOf a steer's direction or region in
 *   words, or null when the attachment isn't stored
 * @param {number} [budgetTokens]
 * @returns {string[]}
 */
export function lineageReading(
  { steps, missingParentId },
  nameOf,
  budgetTokens = LINEAGE_READING_TOKENS,
) {
  const [first] = steps;
  if (!first) throw new Error("a lineage has at least the sketch's own step");
  const count = steps.length === 1 ? "one step" : `${steps.length} steps`;
  const header =
    missingParentId === null
      ? `How the sketch was made, from its first ancestor, in ${count}:`
      : `How the sketch was made, from ${candidate(first.id)}, in ${count}: ${candidate(first.id)}'s parent, ${candidate(missingParentId)}, isn't in the studio, so the chain stops there and what ${candidate(first.id)} changed isn't known.`;
  const changes = steps.map((step, i) => {
    const before = steps[i - 1];
    return before === undefined ? null : genomeChanges(before.genome, step.genome);
  });
  /**
   * @param {LineageStep} step
   * @param {number} i
   * @param {number} level
   */
  const stepLine = (step, i, level) => {
    const from = steps[i - 1]?.id ?? step.parentIds[0];
    const intent = step.intent === null ? "" : `: ${quoted(step.intent)}`;
    const changed = changes[i];
    let what = "";
    if (changed && changed.length === 0) what = " Nothing changed.";
    else if (changed) {
      const values = level === LEVEL_OF.full;
      what = ` Changed: ${changesText(changed, { limit: MAX_LISTED_CHANGES, values })}.`;
    }
    const how = howText(step, from, nameOf);
    return `Step ${i + 1}, ${candidate(step.id)}, ${operatorLabel(step.operator)}${how}${intent}.${what}`;
  };
  /** @param {readonly number[]} levels */
  const write = (levels) => {
    const left = steps.flatMap((_, i) => (levels[i] === LEVEL_OF.left ? [i] : []));
    const lines = steps.flatMap((step, i) => {
      if (levels[i] !== LEVEL_OF.left)
        return [stepLine(step, i, /** @type {number} */ (levels[i]))];
      return i === left[0] ? [leftOutLine(left)] : [];
    });
    return [header, ...lines];
  };
  // The first ancestor and the sketch itself are never left out.
  const oldestFirst = steps.map((_, i) => i).slice(1);
  /** @type {[number, number][]} */
  const cuts = [
    ...oldestFirst.map((i) => /** @type {[number, number]} */ ([i, LEVEL_OF.paths])),
    ...oldestFirst.slice(0, -1).map((i) => /** @type {[number, number]} */ ([i, LEVEL_OF.left])),
  ];
  return fitReading(steps.length, write, cuts, budgetTokens);
}

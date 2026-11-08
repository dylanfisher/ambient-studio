// How a candidate was made, in words, for its card and its lineage node (decision 0039): its
// operator and parent, an explore's direction, a search or steer point's place in its run (0054,
// 0056), a breed's two parents (0058), and why
// a rejected one was rejected. A nudge child or search point has no intent, and its rejected
// draws are no model answer, so neither reads as one. No DOM: the page sets these with
// `textContent`, so a direction is never read as HTML.
import { BREED_STAGE } from "../domain/breed-settings.js";
import { OPERATOR } from "../domain/operator.js";
import { REJECT_REASON } from "../domain/reject-reason.js";

/**
 * The parts of a candidate this reads, as the candidates and lineage routes give them.
 * @typedef {object} Origin
 * @property {string | null} operator
 * @property {any} operatorParams
 * @property {readonly unknown[]} parentIds
 * @property {string | null} intent
 * @property {string | null} rejectReason
 * @property {{ shown: boolean, score: number | null } | null} [search] a search point's place,
 *   as the candidates route gives it
 */

/** What each reject reason says about the answer or draw it names. */
const REJECTED = Object.freeze({
  [REJECT_REASON.truncated]: "that was cut off at the length limit",
  [REJECT_REASON.noJson]: "with no JSON in it",
  [REJECT_REASON.invalidJson]: "whose JSON didn't parse",
  [REJECT_REASON.severalObjects]: "with more than one JSON object in it",
  [REJECT_REASON.schemaErrors]: "that broke the genome's format",
  [REJECT_REASON.lintErrors]: "that broke the brief's rules",
  [REJECT_REASON.requestFailed]: "that never came, since the request to the model failed",
  [REJECT_REASON.repeated]: "that landed on a genome already made",
});

/**
 * A breed's mutation: one nudge of its crossover child, drawn as a nudge's children are.
 * @param {Origin} candidate
 */
const isMutation = ({ operator, operatorParams }) =>
  operator === OPERATOR.breed && operatorParams?.stage === BREED_STAGE.mutation;

/**
 * A crossover child, from the parents its prompt held: both, parent A alone when B didn't fit,
 * or none.
 * @param {readonly unknown[]} parentIds
 * @param {(id: number) => string} nameOf
 */
function crossoverText(parentIds, nameOf) {
  const [a, b] = parentIds.map((id) => nameOf(/** @type {number} */ (id)));
  if (b !== undefined) return `The model's child of ${a} and ${b}, taking parts of both.`;
  if (a !== undefined) {
    return `The model's variation of ${a}, bred with a second sketch that didn't fit in the model's context, so the model never read it.`;
  }
  return "A plain first try from a breed: neither sketch fit in the model's context, so the model read neither.";
}

/**
 * @param {Origin} candidate
 * @param {(id: number) => string} nameOf how the page names another candidate, as `candidate 3`
 * @returns {string}
 */
export function originText({ operator, operatorParams, parentIds, search }, nameOf) {
  if (operator === null) return "A first try from the model.";
  const parent = nameOf(/** @type {number} */ (parentIds[0]));
  if (operator === OPERATOR.revise) {
    return `The model's revision of ${parent}, after its excerpt missed a range or a check.`;
  }
  if (operator === OPERATOR.nudge) {
    return `A ${operatorParams.stepSize} nudge of ${parent}: its numbers moved, with no model request.`;
  }
  if (operator === OPERATOR.explore) {
    const { direction, baseTrimmed } = operatorParams;
    const toward = typeof direction === "string" ? `, toward “${direction}”` : "";
    const trimmed = baseTrimmed
      ? " The base didn't fit in the model's context, so the model never read it: this is a plain first try."
      : "";
    return `The model's variation of ${parent}${toward}.${trimmed}`;
  }
  if (operator === OPERATOR.optimize) {
    const { generation, point } = operatorParams;
    const shown =
      search?.shown && search.score !== null
        ? ` Shown as one of the search's best: search score ${search.score.toFixed(2)}.`
        : "";
    return `Point ${point + 1} of generation ${generation + 1} of a search from ${parent}, scored by your taste model with no model request.${shown}`;
  }
  if (operator === OPERATOR.steer) {
    const { generation, point } = operatorParams;
    const shown =
      search?.shown && search.score !== null
        ? ` Shown as one of the steer's best: steer score ${search.score.toFixed(2)}.`
        : "";
    return `Point ${point + 1} of generation ${generation + 1} of a steer from ${parent}, scored by where it sits on the sliders and regions chosen, with no model request.${shown}`;
  }
  if (operator === OPERATOR.breed) {
    if (operatorParams.stage === BREED_STAGE.mutation) {
      return `A ${operatorParams.stepSize} nudge of the bred child ${parent}: its numbers moved, with no model request.`;
    }
    return crossoverText(parentIds, nameOf);
  }
  if (operator === OPERATOR.optimizeEar) {
    const best = search?.shown ? " Shown as the search's best: the one you chose last." : "";
    return `Pair ${operatorParams.query + 1} of a search by ear from ${parent}: you compared it with the best so far.${best}`;
  }
  if (operator === OPERATOR.elite) {
    return `A ${operatorParams.stepSize} nudge of ${parent}, the best in a cell beside an empty one on the brief's map, made by filling the map with no model request.`;
  }
  throw new Error(`the page doesn't know the operator ${operator}`);
}

/** Each operator as a node's badge reads; a first try's is under null. */
const OPERATOR_WORDS = Object.freeze({
  [OPERATOR.revise]: "revised",
  [OPERATOR.nudge]: "nudged",
  [OPERATOR.explore]: "variation",
  [OPERATOR.optimize]: "searched",
  [OPERATOR.optimizeEar]: "searched by ear",
  [OPERATOR.steer]: "steered",
  [OPERATOR.breed]: "bred",
  [OPERATOR.elite]: "map fill",
});

/**
 * @param {string | null} operator
 * @returns {string} a word or two for a badge
 */
export function operatorLabel(operator) {
  if (operator === null) return "first try";
  const words = OPERATOR_WORDS[/** @type {keyof typeof OPERATOR_WORDS} */ (operator)];
  if (words === undefined) throw new Error(`the page doesn't know the operator ${operator}`);
  return words;
}

/**
 * The card's intent line: the model's intent, or why there is none.
 * @param {Origin} candidate
 * @returns {string}
 */
export function intentText(candidate) {
  const { intent, operator } = candidate;
  if (intent !== null) return intent;
  if (operator === OPERATOR.nudge || operator === OPERATOR.elite || isMutation(candidate)) {
    return "A nudge has no intent of its own: it is its base with some numbers moved.";
  }
  if (
    operator === OPERATOR.optimize ||
    operator === OPERATOR.optimizeEar ||
    operator === OPERATOR.steer
  ) {
    return "A search point has no intent of its own: it is its base with some numbers moved.";
  }
  return "The model gave no intent.";
}

/**
 * Why a rejected candidate was rejected, as a phrase: a nudge's draw or a model's answer.
 * @param {Origin} candidate
 * @returns {string}
 */
export function rejectText(candidate) {
  const { operator, rejectReason } = candidate;
  const why = REJECTED[/** @type {keyof typeof REJECTED} */ (rejectReason)];
  if (why === undefined) throw new Error(`the page doesn't know the reject reason ${rejectReason}`);
  if (operator === OPERATOR.nudge || operator === OPERATOR.elite || isMutation(candidate)) {
    return `a nudge draw ${why}, so it was drawn again`;
  }
  if (operator === OPERATOR.optimize || operator === OPERATOR.steer) {
    return `a search point ${why}, so it was told a low score`;
  }
  if (operator === OPERATOR.optimizeEar) {
    return `a search-by-ear point ${why}, so it was told as a loss and never played`;
  }
  return `a model answer ${why}`;
}

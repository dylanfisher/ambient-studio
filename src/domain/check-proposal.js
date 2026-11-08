// Checks the model's proposed arrangement (decision 0067): the one JSON object in its response,
// holding only sections, transitions and lanes, filled out with the owner's length and arc and
// checked by `validateArrangement`, then held to the length asked for within
// `LENGTH_TOLERANCE`. A section may name a listed elite by `eliteId` in place of `sketchId`; it
// is checked against the elite's duration, and the caller keeps the elite as a sketch before the
// arrangement is stored.
/** @import { Arrangement } from "./arrangement-schema.js" */
/** @import { QuotedError } from "./build-repair-prompt.js" */
/** @import { RejectReason } from "./reject-reason.js" */
/** @import { ArrangementContext, ArrangementSketch } from "./validate-arrangement.js" */
import { isObject } from "../engine/is-object.js";
import { show } from "../engine/validation-error.js";
import { ANSWER_KEYS, ELITE_KEY, LENGTH_RULE, LENGTH_TOLERANCE } from "./arrange-prompt.js";
import { arrangementLength } from "./arrangement-length.js";
import { ARRANGEMENT_KEY, SECTION_KEY } from "./arrangement-schema.js";
import { extractObject } from "./extract-genome.js";
import { ANSWER_RULE } from "./lint-result.js";
import { REJECT_REASON } from "./reject-reason.js";
import { validateArrangement } from "./validate-arrangement.js";

/** The rule each kind of finding quotes in the repair. */
export const PROPOSAL_RULE = Object.freeze({
  /** The answer's own shape: its keys, or how a section names its material. */
  answer: ANSWER_RULE,
  /** `validateArrangement`'s errors. */
  arrangement: "arrangement",
  /** The track plays more than `LENGTH_TOLERANCE` away from the length asked for. */
  length: "length",
});

/**
 * `elites` maps each section that names an elite, by index, to the elite's candidate id. A
 * rejected answer that parsed keeps `answer`, for the repair to quote; one that never parsed has
 * null, and gets no repair (0024).
 * @typedef {{ ok: true, arrangement: Arrangement, elites: Map<number, number> }
 *   | { ok: false, reason: RejectReason, errors: QuotedError[], answer: Record<string, unknown> | null }} ProposalVerdict
 */

/**
 * @typedef {object} ProposalAsk
 * @property {ArrangementContext} context the track's vibe and its sketches
 * @property {ReadonlyMap<number, number>} elites each listed elite's duration, by candidate id
 * @property {number} length the owner's, in seconds
 * @property {string} arc the owner's
 */

/**
 * Ids no sketch has: an elite's section is validated under one of these, counted down from the
 * largest safe integer, so it never meets a real sketch's id.
 * @param {number} index
 */
const standIn = (index) => Number.MAX_SAFE_INTEGER - index;

/**
 * The answer's sections with each elite's swapped for a stand-in sketch id, and what each
 * stand-in stands for.
 * @param {unknown} sections as the answer gives them
 * @param {ProposalAsk} ask
 * @param {QuotedError[]} errors
 */
function standInSections(sections, { elites, context }, errors) {
  /** @type {Map<number, number>} */
  const named = new Map();
  /** @type {Map<number, ArrangementSketch>} */
  const standIns = new Map();
  if (!Array.isArray(sections)) return { sections, named, standIns };
  const swapped = sections.map((section, i) => {
    if (!isObject(section) || !Object.hasOwn(section, ELITE_KEY)) return section;
    const path = `$.${ARRANGEMENT_KEY.sections}[${i}]`;
    const { [ELITE_KEY]: eliteId, ...rest } = section;
    if (Object.hasOwn(section, SECTION_KEY.sketchId)) {
      errors.push({
        path,
        rule: PROPOSAL_RULE.answer,
        message: `names both a sketch and an elite; give ${JSON.stringify(SECTION_KEY.sketchId)} or ${JSON.stringify(ELITE_KEY)}, not both`,
      });
      return rest;
    }
    const duration = typeof eliteId === "number" ? elites.get(eliteId) : undefined;
    if (duration === undefined) {
      errors.push({
        path: `${path}.${ELITE_KEY}`,
        rule: PROPOSAL_RULE.answer,
        message: `there is no elite ${show(eliteId)} in the material; name a listed one`,
      });
    }
    const id = standIn(i);
    standIns.set(id, {
      vibeId: context.vibeId,
      removedReason: null,
      duration: duration ?? Infinity,
    });
    if (duration !== undefined) named.set(i, /** @type {number} */ (eliteId));
    return { ...rest, [SECTION_KEY.sketchId]: id };
  });
  return { sections: swapped, named, standIns };
}

/**
 * Checks a parsed answer, every finding with its path and rule.
 * @param {Record<string, unknown>} answer
 * @param {ProposalAsk} ask
 * @returns {ProposalVerdict}
 */
export function checkProposal(answer, ask) {
  /** @type {QuotedError[]} */
  const errors = [];
  for (const key of Object.keys(answer)) {
    if (!ANSWER_KEYS.includes(/** @type {any} */ (key))) {
      errors.push({
        path: "$",
        rule: PROPOSAL_RULE.answer,
        message: `the answer has ${JSON.stringify(key)}; give only ${ANSWER_KEYS.map((name) => JSON.stringify(name)).join(", ")}`,
      });
    }
  }
  const { sections, named, standIns } = standInSections(
    answer[ARRANGEMENT_KEY.sections],
    ask,
    errors,
  );
  const given = {
    [ARRANGEMENT_KEY.length]: ask.length,
    [ARRANGEMENT_KEY.arc]: ask.arc,
    [ARRANGEMENT_KEY.sections]: sections,
    [ARRANGEMENT_KEY.transitions]: answer[ARRANGEMENT_KEY.transitions],
    [ARRANGEMENT_KEY.lanes]: answer[ARRANGEMENT_KEY.lanes],
    [ARRANGEMENT_KEY.proposal]: null,
  };
  const checked = validateArrangement(given, {
    vibeId: ask.context.vibeId,
    sketch: (id) => standIns.get(id) ?? ask.context.sketch(id),
  });
  if (!checked.ok) {
    errors.push(...checked.errors.map((error) => ({ ...error, rule: PROPOSAL_RULE.arrangement })));
  } else {
    const played = arrangementLength(checked.arrangement);
    const spread = ask.length * LENGTH_TOLERANCE;
    if (Math.abs(played - ask.length) > spread) {
      errors.push({
        path: `$.${ARRANGEMENT_KEY.sections}`,
        rule: PROPOSAL_RULE.length,
        message: `the track plays ${played} s (${LENGTH_RULE}); the owner asked for ${ask.length} s, so it must play from ${ask.length - spread} to ${ask.length + spread} s`,
      });
    }
  }
  if (errors.length > 0 || !checked.ok) {
    return { ok: false, reason: REJECT_REASON.schemaErrors, errors, answer };
  }
  return { ok: true, arrangement: checked.arrangement, elites: named };
}

/**
 * The verdict on one response: cut off, no single JSON object, or the object checked.
 * @param {{ text: string, finishReason: string }} completion
 * @param {number} maxTokens the request's, named when the answer was cut off
 * @param {ProposalAsk} ask
 * @returns {ProposalVerdict}
 */
export function judgeProposal({ text, finishReason }, maxTokens, ask) {
  if (finishReason === "length") {
    const message = `the answer hit max_tokens (${maxTokens}) and was cut off`;
    return {
      ok: false,
      reason: REJECT_REASON.truncated,
      errors: [{ path: "$", rule: REJECT_REASON.truncated, message }],
      answer: null,
    };
  }
  const found = extractObject(text);
  if (!found.ok) {
    const { reason, message } = found;
    return { ok: false, reason, errors: [{ path: "$", rule: reason, message }], answer: null };
  }
  return checkProposal(found.answer, ask);
}

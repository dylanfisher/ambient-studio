// Checks the model's drafted brief (decision 0074): the one JSON object in its response, holding
// the four fields of a draft and no other, its name and description held to the save route's
// limits, its constraints checked by `validateConstraints` and its soft targets, the ranges alone,
// by `validateTargets`, the same validators Save uses.
/** @import { QuotedError } from "./build-repair-prompt.js" */
/** @import { BriefDraft, DraftLimits } from "./draft-brief-prompt.js" */
/** @import { RejectReason } from "./reject-reason.js" */
import { isObject } from "../engine/is-object.js";
import { MISSING, show } from "../engine/validation-error.js";
import { judgeAnswer } from "./judge-answer.js";
import { ANSWER_RULE } from "./lint-result.js";
import { REJECT_REASON } from "./reject-reason.js";
import { RANGES_KEY } from "./target-schema.js";
import { validateConstraints } from "./validate-constraints.js";
import { validateTargets } from "./validate-targets.js";
import { VIBE_DRAFT_FIELD } from "./vibe-draft.js";

/**
 * A rejected answer that parsed keeps `answer`, for the repair to quote; one that never parsed
 * has null, and gets no repair (0024).
 * @typedef {{ ok: true, draft: BriefDraft }
 *   | { ok: false, reason: RejectReason, errors: QuotedError[], answer: Record<string, unknown> | null }} DraftVerdict
 */

const FIELDS = /** @type {readonly string[]} */ (Object.values(VIBE_DRAFT_FIELD));

/**
 * A validator's errors as findings under the field, the field naming the rule.
 * @param {readonly { path: string, message: string }[]} errors paths from `$`
 * @param {string} field
 * @returns {QuotedError[]}
 */
const under = (errors, field) =>
  errors.map(({ path, message }) => ({ path: `$.${field}${path.slice(1)}`, rule: field, message }));

/**
 * A text field's finding: missing, not a string, blank, or over its limit; none when it passes.
 * @param {unknown} value
 * @param {string} field
 * @param {number} maxChars
 * @returns {QuotedError[]}
 */
function textErrors(value, field, maxChars) {
  const path = `$.${field}`;
  if (value === undefined) return [{ path, rule: field, message: MISSING }];
  if (typeof value !== "string" || value.trim() === "") {
    return [{ path, rule: field, message: `must be a non-empty string, got ${show(value)}` }];
  }
  if (value.length > maxChars) {
    return [
      {
        path,
        rule: field,
        message: `must be at most ${maxChars} characters, got ${value.length}`,
      },
    ];
  }
  return [];
}

/**
 * Checks a parsed answer, every finding with its path and rule.
 * @param {Record<string, unknown>} answer
 * @param {DraftLimits} limits
 * @returns {DraftVerdict}
 */
export function checkDraftBrief(answer, limits) {
  const { name, brief, constraints, softTargets } = VIBE_DRAFT_FIELD;
  /** @type {QuotedError[]} */
  const errors = [];
  for (const key of Object.keys(answer)) {
    if (!FIELDS.includes(key)) {
      errors.push({
        path: "$",
        rule: ANSWER_RULE,
        message: `the answer has ${JSON.stringify(key)}; give only ${FIELDS.map((field) => JSON.stringify(field)).join(", ")}`,
      });
    }
  }
  errors.push(...textErrors(answer[name], name, limits.name));
  errors.push(...textErrors(answer[brief], brief, limits.brief));
  const rules = validateConstraints(answer[constraints] ?? {});
  if (answer[constraints] === undefined) {
    errors.push({ path: `$.${constraints}`, rule: constraints, message: MISSING });
  } else if (!rules.ok) errors.push(...under(rules.errors, constraints));
  const given = answer[softTargets];
  const targets = validateTargets(given ?? {});
  if (given === undefined) {
    errors.push({ path: `$.${softTargets}`, rule: softTargets, message: MISSING });
  } else if (!targets.ok) errors.push(...under(targets.errors, softTargets));
  else if (isObject(given)) {
    for (const key of Object.keys(given).filter((key) => key !== RANGES_KEY)) {
      errors.push({
        path: `$.${softTargets}.${key}`,
        rule: softTargets,
        message: `unknown key; give only ${JSON.stringify(RANGES_KEY)}`,
      });
    }
  }
  if (errors.length > 0 || !rules.ok || !targets.ok) {
    return { ok: false, reason: REJECT_REASON.schemaErrors, errors, answer };
  }
  return {
    ok: true,
    draft: {
      name: /** @type {string} */ (answer[name]),
      brief: /** @type {string} */ (answer[brief]),
      constraints: rules.constraints,
      softTargets: { [RANGES_KEY]: targets.ranges },
    },
  };
}

/**
 * The verdict on one response: cut off, no single JSON object, or the object checked.
 * @param {{ text: string, finishReason: string }} completion
 * @param {number} maxTokens the request's, named when the answer was cut off
 * @param {DraftLimits} limits
 * @returns {DraftVerdict}
 */
export const judgeDraftBrief = (completion, maxTokens, limits) =>
  judgeAnswer(completion, maxTokens, (answer) => checkDraftBrief(answer, limits));

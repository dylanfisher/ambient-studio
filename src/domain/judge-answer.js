// The first steps of judging a model's answer that isn't a genome, a proposal's (decision 0067),
// a drafted brief's (0074) or the words operator's (0084): an answer cut off at `max_tokens`,
// with no JSON, invalid JSON or several objects is rejected with no answer to repair (0024); the
// one object found goes to the caller's check.
/** @import { QuotedError } from "./build-repair-prompt.js" */
/** @import { RejectReason } from "./reject-reason.js" */
import { extractObject } from "./extract-genome.js";
import { REJECT_REASON } from "./reject-reason.js";

/** @typedef {{ ok: false, reason: RejectReason, errors: QuotedError[], answer: null }} Unparsed */

/**
 * @template V
 * @param {{ text: string, finishReason: string }} completion
 * @param {number} maxTokens the request's, named when the answer was cut off
 * @param {(answer: Record<string, unknown>) => V} check
 * @returns {V | Unparsed}
 */
export function judgeAnswer({ text, finishReason }, maxTokens, check) {
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
  return check(found.answer);
}

/**
 * How an answer that ended invalid is described in its job's error.
 * @param {boolean} repaired whether it had its repair round
 */
export const invalidAfter = (repaired) =>
  repaired ? "still invalid after one repair" : "invalid, with nothing to repair";

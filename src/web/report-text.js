// A model test's numbers in plain words (decisions 0030 and 0032). No DOM here, so the wording
// is tested.
/** @import { Rate, ResponseFormatResult, Tally } from "../domain/evaluation-report.js" */
/** @import { Percentiles } from "../domain/percentiles.js" */
import { RESPONSE_FORMAT_RESULT } from "../domain/evaluation-report.js";
import { REJECT_REASON } from "../domain/reject-reason.js";

/** The share that counts as working well: phase 2 asks for 90% after one fix. */
const GOOD = 0.9;
/** Below this share first time, a high after-fix share means one repeated mistake. */
const LOW = 0.5;

/** @param {number} share from 0 to 1 */
const percent = (share) => `${Math.round(share * 100)}%`;

/** @param {number} ms */
const seconds = (ms) => `${Math.round(ms / 1000)} s`;

/**
 * @param {Rate | null} rate null when nothing was answered
 * @returns {string} such as `45 of 48 (94%)`
 */
export function rateText(rate) {
  if (rate === null) return "nothing answered";
  return `${rate.count} of ${rate.of} (${percent(rate.share)})`;
}

/**
 * The 95% Wilson interval, said as where the true rate probably lies.
 * @param {Rate | null} rate
 */
export function rangeText(rate) {
  if (rate === null) return "";
  return `With this few tries, the true rate is probably between ${percent(rate.low)} and ${percent(rate.high)}.`;
}

/**
 * Nearest-rank percentiles of request times, in words.
 * @param {Percentiles | null} found null when nothing was timed
 */
export function timeText(found) {
  if (found === null) return "None timed.";
  const { count, p50, p90, max } = found;
  return `Usually ${seconds(p50)} (half were quicker); 9 in 10 within ${seconds(p90)}; the slowest took ${seconds(max)}. ${count} timed.`;
}

/** What each reason for failing means, in the order the page lists them. */
const REASON_TEXT = Object.freeze({
  [REJECT_REASON.schemaErrors]: "used a field name or value the format doesn't allow",
  [REJECT_REASON.lintErrors]: "broke one of the brief's rules",
  [REJECT_REASON.noJson]: "had no JSON in it",
  [REJECT_REASON.invalidJson]: "had JSON that doesn't parse",
  [REJECT_REASON.severalObjects]: "had more than one answer in it",
});

/**
 * @param {Record<string, number>} counts by reason
 */
export function rejectsText(counts) {
  for (const reason of Object.keys(counts)) {
    if (!(reason in REASON_TEXT)) throw new Error(`no words for the reason ${reason}`);
  }
  const found = Object.entries(REASON_TEXT)
    .map(([reason, text]) => [counts[reason] ?? 0, text])
    .filter(([n]) => Number(n) > 0);
  return found.length === 0 ? "None." : `${found.map(([n, text]) => `${n} ${text}`).join("; ")}.`;
}

const ASKED = "Model was asked for JSON format:";

/** @type {Readonly<Record<ResponseFormatResult, string>>} */
const RESPONSE_FORMAT_TEXT = Object.freeze({
  [RESPONSE_FORMAT_RESULT.notSent]: `${ASKED} not sent. The studio didn't ask the model to answer in a fixed JSON shape (queue.sendResponseFormat is off in the config), so the model wrote the JSON freely.`,
  [RESPONSE_FORMAT_RESULT.accepted]: `${ASKED} accepted. The model was told the exact JSON shape to answer in, and took the request.`,
  [RESPONSE_FORMAT_RESULT.refused]: `${ASKED} refused. The model server turned down the request for a fixed JSON shape; turn queue.sendResponseFormat off in the config and test again.`,
  [RESPONSE_FORMAT_RESULT.noAnswer]: `${ASKED} no answer. It was asked, but no request was answered, so whether the model server takes it is still unknown.`,
});

/**
 * @param {ResponseFormatResult} result
 */
export function responseFormatText(result) {
  const text = RESPONSE_FORMAT_TEXT[result];
  if (text === undefined) throw new Error(`unknown response_format result ${result}`);
  return text;
}

/**
 * What a tally means for the owner, in a sentence or two.
 * @param {Tally} tally
 */
export function meaningText({ valid, schemaValid, truncated }) {
  const first = valid.beforeRepair;
  const fixed = valid.afterRepair;
  const format = schemaValid.afterRepair;
  if (first === null || fixed === null || format === null) {
    return "No answer came back, so there is nothing to judge. See why the test stopped above.";
  }
  /** @type {string} */
  let meaning;
  if (first.share >= GOOD) {
    meaning = "The model follows the brief well: almost every answer worked first time.";
  } else if (fixed.share >= GOOD && first.share < LOW) {
    meaning =
      "A low first-time rate with a high after-fix rate means the model understands the brief but keeps making a format mistake. The one fix catches it, at the cost of a second request each time.";
  } else if (fixed.share >= GOOD) {
    meaning = "Most answers work first time, and the one fix catches the rest.";
  } else if (format.share >= GOOD) {
    meaning =
      "The answers have the right format, but the model often breaks the brief's rules. Loosen the rules, or say more plainly in the description what you want.";
  } else {
    meaning =
      "Many answers stay in the wrong format even after a fix, so the model is struggling with the format itself.";
  }
  if (truncated > 0) {
    meaning += ` ${truncated} answer${truncated === 1 ? " was" : "s were"} cut off before finishing, which usually means the model spent its length limit before writing the answer.`;
  }
  return meaning;
}

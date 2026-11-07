// An evaluation report's numbers as the evaluation page shows them (decision 0030). No DOM here,
// so the wording is tested.
/** @import { Rate, ResponseFormatResult } from "../domain/evaluation-report.js" */
/** @import { Percentiles } from "../domain/percentiles.js" */
import { RESPONSE_FORMAT_RESULT } from "../domain/evaluation-report.js";

/** @param {number} share from 0 to 1 */
const percent = (share) => `${(share * 100).toFixed(1)}%`;

/** @param {number} ms */
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

/**
 * @param {Rate | null} rate null when nothing was answered
 * @returns {string} such as `45/48, 93.8% (95% CI 83.2–97.9%)`
 */
export function rateText(rate) {
  if (rate === null) return "nothing answered";
  const { count, of, share, low, high } = rate;
  return `${count}/${of}, ${percent(share)} (95% CI ${(low * 100).toFixed(1)}–${percent(high)})`;
}

/**
 * @param {Percentiles | null} found null when nothing was measured
 */
export function percentilesText(found) {
  if (found === null) return "nothing measured";
  const { count, p50, p90, p95, max } = found;
  return `p50 ${seconds(p50)}, p90 ${seconds(p90)}, p95 ${seconds(p95)}, max ${seconds(max)} (${count} measured)`;
}

/**
 * @param {Record<string, number>} counts by reject reason
 */
export function rejectsText(counts) {
  const found = Object.entries(counts).filter(([, n]) => n > 0);
  return found.length === 0
    ? "no rejects"
    : found.map(([reason, n]) => `${reason} ${n}`).join(", ");
}

/** @type {Readonly<Record<ResponseFormatResult, string>>} */
const RESPONSE_FORMAT_TEXT = Object.freeze({
  [RESPONSE_FORMAT_RESULT.accepted]: "omlx accepted the JSON-schema response_format.",
  [RESPONSE_FORMAT_RESULT.refused]:
    "omlx refused the JSON-schema response_format; set queue.sendResponseFormat to false.",
  [RESPONSE_FORMAT_RESULT.notSent]:
    "response_format was not sent (queue.sendResponseFormat is false).",
  [RESPONSE_FORMAT_RESULT.noAnswer]:
    "response_format was sent, but no request was answered, so whether omlx takes it is unknown.",
});

/**
 * @param {ResponseFormatResult} result
 */
export function responseFormatText(result) {
  const text = RESPONSE_FORMAT_TEXT[result];
  if (text === undefined) throw new Error(`unknown response_format result ${result}`);
  return text;
}

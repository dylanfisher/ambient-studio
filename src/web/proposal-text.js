// What a proposal costs, said in the brief page's confirm before it starts, and how the
// proposals so far came out (decision 0067). No DOM here, so the wording is tested.
import { MAX_MATERIAL_LINES } from "../domain/arrange-prompt.js";
import { clockTime } from "./excerpt-player.js";

/**
 * The requests one answer with a repair round takes: one, and one more when it needs fixing.
 * The brief's draft (0074) takes as many.
 */
export const REQUESTS = Object.freeze({ low: 1, high: 2 });

/**
 * How long `requests` take, from recent requests' times, as the confirm's last sentence.
 * @param {{ seconds: number | null, timed: number }} estimate the median seconds of the last
 *   `timed` requests the model answered; null seconds when none was timed
 * @param {{ low: number, high: number }} [requests] the fewest and the most: `REQUESTS`, or a
 *   bridge's two halves' (0081)
 * @returns {string}
 */
export function requestsTimeText({ seconds, timed }, requests = REQUESTS) {
  if (seconds === null) {
    return "No request to the model has been timed yet, so the time can't be estimated.";
  }
  /** @param {number} count */
  const minutes = (count) => Math.max(1, Math.round((count * seconds) / 60));
  const [low, high] = [minutes(requests.low), minutes(requests.high)];
  const span = low === high ? `${low} minute${low === 1 ? "" : "s"}` : `${low} to ${high} minutes`;
  const source =
    timed === 1
      ? "the one request timed so far"
      : `the median of the last ${timed} the model answered`;
  return `At ${Math.round(seconds)} s a request, ${source}, that is about ${span}, longer while the live site keeps the model busy.`;
}

/**
 * @param {number} length seconds asked for
 * @param {{ seconds: number | null, timed: number }} estimate as `requestsTimeText` takes it
 * @returns {string} the confirm's question and its cost
 */
export function proposeCostText(length, estimate) {
  const what =
    `Ask the model to propose a ${clockTime(length)} track? It reads the brief, your arc, and one line each for up to ${MAX_MATERIAL_LINES} sketches and map elites, sketches first. ` +
    `That is ${REQUESTS.low} or ${REQUESTS.high} requests to the model: one, and another when the answer needs fixing. ` +
    "Nothing is rendered: the proposal opens on the timeline as the track's first version, and any elite it places is kept as a sketch.";
  return `${what} ${requestsTimeText(estimate)}`;
}

/**
 * @param {{ asked: number, valid: number, firstTry: number, invalid: number, failed: number }} share
 * @returns {string} the line under Propose
 */
export function proposalShareText({ asked, valid, firstTry, invalid, failed }) {
  if (asked === 0) return "No track has been proposed yet.";
  const reached = asked - failed;
  const percent = reached === 0 ? null : Math.round((100 * valid) / reached);
  const lost =
    failed === 0
      ? ""
      : ` ${failed} more never got an answer from the model, and ${failed === 1 ? "isn't" : "aren't"} counted.`;
  return (
    `Proposals so far: ${valid} of ${reached} valid after at most one repair${percent === null ? "" : ` (${percent}%)`}, ` +
    `${firstTry} on the first try; ${invalid} still invalid.${lost}`
  );
}

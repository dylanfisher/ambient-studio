// An A/B rating's outcome in words, as the session and brief pages show it (decision 0032).
import { OUTCOMES } from "../domain/rating-values.js";

const [, , TIE, SKIP] = OUTCOMES;

/**
 * @param {{ outcome: string, leftSide: string }} rating `leftSide` is the side shown on the left
 * @returns {string} such as `left was better` or `about the same`
 */
export const outcomeText = ({ outcome, leftSide }) =>
  outcome === TIE
    ? "about the same"
    : outcome === SKIP
      ? "skipped"
      : `${outcome === leftSide ? "left" : "right"} was better`;

// What a model test costs, said in the confirm before it starts (decision 0040). No DOM here, so
// the wording is tested. The figures come from the logged model tests on mbp2021: about 55 s a
// request with thinking on, about 7 s with it off, and 1.3 to 2.5 s to render an excerpt.

/** Seconds a request takes, by whether the model thinks first. */
const REQUEST_SECONDS = Object.freeze({ thinking: 55, notThinking: 7 });
const RENDER_SECONDS = 2;

/**
 * Requests and renders per candidate, low and high. A plain test sends a first try and at most
 * one fix. A revision test with about half missing, as the seed ranges aim for, sends 2 to 3
 * and renders 1.5 to 2 excerpts; a candidate whose every answer needs a fix sends 6.
 */
const PER_CANDIDATE = Object.freeze({
  plain: { low: { requests: 1, renders: 0 }, high: { requests: 2, renders: 0 } },
  revise: { low: { requests: 2, renders: 1.5 }, high: { requests: 3, renders: 2 } },
});

/** @param {number} n @param {string} word */
const counted = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * @param {{ count: number, briefs: number, revise: boolean, thinking: boolean }} test
 * @returns {string} the confirm's question and its cost
 */
export function costText({ count, briefs, revise, thinking }) {
  const total = count * briefs;
  const seconds = thinking ? REQUEST_SECONDS.thinking : REQUEST_SECONDS.notThinking;
  const { low: fewest, high: most } = revise ? PER_CANDIDATE.revise : PER_CANDIDATE.plain;
  /** @param {{ requests: number, renders: number }} per */
  const minutesFor = ({ requests, renders }) =>
    Math.max(1, Math.round((total * (requests * seconds + renders * RENDER_SECONDS)) / 60));
  const [low, high] = [minutesFor(fewest), minutesFor(most)];
  const what = revise
    ? "With the revision test it also renders each answer and sends each one that misses back twice: usually 2 to 3 requests per candidate, at most 6 counting fixes."
    : "It sends 1 or 2 requests per candidate, a first try and at most one fix, and makes no audio.";
  const minutes = low === high ? counted(low, "minute") : `${low} to ${high} minutes`;
  return (
    `Ask the model for ${counted(total, "candidate")} (${count} for each of ${briefs} brief${briefs === 1 ? "" : "s"})? ${what} ` +
    `That is about ${minutes} at about ${seconds} s a request (thinking is ${thinking ? "on" : "off"}), longer while the live site keeps the model busy.`
  );
}

// What a breed costs, said in its confirm before it starts (decision 0058): the model requests
// each crossover child takes, a first try, a fix and a revision at most (0038), times the median
// of recent request times, plus each excerpt's render at the bench's seconds. No DOM here, so
// the wording is tested.
import { BENCH_SECONDS } from "./search-cost.js";

/** Requests per child, fewest and most, and the excerpts rendered with them. */
const PER_CHILD = Object.freeze({
  low: { requests: 1, renders: 2 },
  high: { requests: 3, renders: 3 },
});

/** @param {number} n @param {string} one @param {string} [many] */
const counted = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {number} children crossover children asked for
 * @param {{ seconds: number | null, timed: number }} estimate the median seconds of the last
 *   `timed` requests the model answered; null seconds when none was timed
 * @returns {string} the confirm's question and its cost
 */
export function breedCostText(children, { seconds, timed }) {
  const one = children === 1;
  const what =
    `Breed these two sketches into ${counted(children, "child", "children")}? ` +
    `The model writes ${one ? "the child" : "each child"} from both parents, and ${one ? "the child" : "each child"} is then nudged once with no model request. ` +
    `That is ${children * PER_CHILD.low.requests} to ${children * PER_CHILD.high.requests} requests to the model: one a child, another when an answer needs fixing, and another when a child misses a range and is revised.`;
  if (seconds === null) {
    return `${what} No request to the model has been timed yet, so the time can't be estimated.`;
  }
  const render = BENCH_SECONDS.render;
  /** @param {{ requests: number, renders: number }} per */
  const minutes = ({ requests, renders }) =>
    Math.max(1, Math.round((children * (requests * seconds + renders * render)) / 60));
  const [low, high] = [minutes(PER_CHILD.low), minutes(PER_CHILD.high)];
  const span = low === high ? counted(low, "minute") : `${low} to ${high} minutes`;
  const source =
    timed === 1
      ? "the last one the model answered"
      : `the median of the last ${timed} the model answered`;
  return (
    `${what} At ${Math.round(seconds)} s a request, ${source}, and ${render} s to render each excerpt, ` +
    `that is about ${span}, longer while the live site keeps the model busy.`
  );
}

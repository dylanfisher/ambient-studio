// The optimizer test's report in plain words (decisions 0032 and 0059). No DOM here, so the
// wording is tested. A brief's entry is the server's `OptimizerVibe` with the owner's choices
// on its spot-check pairs counted (`owner`), read as JSON.
import { OPTIMIZER_TEST, OWNER_INCONCLUSIVE, VERDICT } from "../domain/optimizer-report.js";

/** @param {number} share from 0 to 1 */
const percent = (share) => `${Math.round(share * 100)}%`;
/** @param {number} score a taste model score */
const points = (score) => score.toFixed(2);
/** @param {number} n @param {string} one @param {string} many */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** @param {number} seconds */
const minutes = (seconds) => plural(Math.max(1, Math.round(seconds / 60)), "minute", "minutes");

/** What each verdict says of the two arms. */
const SAYS = Object.freeze({
  [VERDICT.search]: "The search is better.",
  [VERDICT.control]: "The control's nudges are better.",
  [VERDICT.even]: "Neither is clearly better.",
});

/**
 * What the taste model's comparison found, or why it doesn't count.
 * @param {any} vibe
 */
export function modelText({ agreement, model, verdict, runs }) {
  if (!verdict.counts) {
    if (verdict.text === null) return "By your taste model: no search scored a point in both arms.";
    const why =
      agreement === null
        ? "there is no taste model test result for it yet; run Test your taste model above"
        : `its held-out agreement is probably between ${percent(agreement.low)} and ${percent(agreement.high)}, and must be above 50% at the low end`;
    return `By your taste model: ${verdict.text} (${why}).`;
  }
  const won = model.wins + model.ties / 2;
  return (
    `By your taste model, the search's best beat the control's in ${won} of ${model.compared} search${model.compared === 1 ? "" : "es"}` +
    (model.ties > 0 ? ", a tie counting half" : "") +
    (model.compared < runs.length
      ? ` (${runs.length - model.compared} had nothing to compare)`
      : "") +
    `. On average it scored ${points(model.meanDifference)} more, probably between ${points(model.low)} and ${points(model.high)}. ` +
    /** @type {Record<string, string>} */ (SAYS)[verdict.verdict]
  );
}

/**
 * What the owner's spot-check choices found, or that they are still too few.
 * @param {any} vibe
 */
export function ownerText({ owner, spotChecks }) {
  if (spotChecks.length === 0) return "By ear: there are no pairs to compare.";
  const { wins, decided, unrated, p, verdict } = owner;
  if (verdict === VERDICT.inconclusive) {
    return (
      `By ear: ${OWNER_INCONCLUSIVE}. You chose the search's side in ${wins} of ${decided} decided pairs, and the test needs ${OPTIMIZER_TEST.minimumPairs}` +
      (unrated > 0 ? `; ${plural(unrated, "pair is", "pairs are")} still to rate.` : ".")
    );
  }
  const shown =
    verdict === VERDICT.search
      ? "so the search is better by ear"
      : `which doesn't show the search is better (it needs p under ${OPTIMIZER_TEST.alpha})`;
  return `By ear, you chose the search's side in ${wins} of ${decided} pairs: p = ${p.toFixed(3)}, ${shown}.`;
}

/**
 * A brief's result in a sentence or two.
 * @param {any} vibe
 */
export function optimizerSummary(vibe) {
  if (vibe.leftOut !== null) return `Left out: ${vibe.leftOut}`;
  return `${modelText(vibe)} ${ownerText(vibe)}`;
}

/**
 * A brief's result as verdicts alone, the line its card opens with (decision 0086): the counts,
 * scores and p are in `optimizerSummary`, behind the numbers toggle.
 * @param {any} vibe
 */
export function optimizerVerdict(vibe) {
  if (vibe.leftOut !== null) return `Left out: ${vibe.leftOut}`;
  const { verdict, owner, spotChecks } = vibe;
  const says = /** @type {Record<string, string>} */ (SAYS)[verdict.verdict] ?? "";
  const byModel = verdict.counts
    ? `By your taste model, ${says.charAt(0).toLowerCase()}${says.slice(1)}`
    : verdict.text === null
      ? modelText(vibe)
      : `By your taste model: ${verdict.text}.`;
  /** @type {string} */
  let byEar;
  if (spotChecks.length === 0) byEar = ownerText(vibe);
  else if (owner.verdict === VERDICT.inconclusive) {
    byEar = `By ear: ${OWNER_INCONCLUSIVE}${owner.unrated > 0 ? "; rate the blind pairs" : ""}.`;
  } else if (owner.verdict === VERDICT.search) byEar = "By ear, the search is better.";
  else byEar = "By ear, it doesn't show the search is better.";
  return `${byModel} ${byEar}`;
}

/**
 * A tested brief's facts as term and value: each search, the map's coverage and the time.
 * @param {any} vibe
 * @returns {[string, string][]}
 */
export function optimizerFacts(vibe) {
  if (vibe.leftOut !== null) return [];
  /** @type {[string, string][]} */
  const facts = vibe.runs.map((/** @type {any} */ run, /** @type {number} */ i) => [
    `Search ${i + 1}`,
    `best ${run.search === null ? "nothing scored" : points(run.search.score)} against the control's ${run.control === null ? "nothing scored" : points(run.control.score)}, from candidate #${run.baseId} in session ${run.sessionId}`,
  ]);
  const { coverage, timings } = vibe;
  facts.push([
    "Map coverage",
    coverage === null
      ? "No fill of the map with a control has run for this brief yet."
      : `the last fill filled ${percent(coverage.coverage.fill)} of ${coverage.cells} cells, the same number of nudges ${percent(coverage.coverage.control)}, from ${percent(coverage.coverage.start)} at the start`,
  ]);
  const { estimate, took } = timings;
  const each =
    took.perEvaluation === null
      ? ""
      : `, at ${took.perEvaluation.render.toFixed(1)} s to render and ${took.perEvaluation.embed.toFixed(2)} s to analyze each`;
  facts.push([
    "Time",
    `${minutes(took.seconds)} for ${took.evaluations} excerpts${each}; the estimate was ${minutes(estimate.seconds)}`,
  ]);
  return facts;
}

/**
 * The candidate numbers typed in a brief's field: none for its top-ranked candidates.
 * @param {string} text such as "12, 15" or "#12 #15"
 * @param {string} brief the brief's name, for the error
 * @returns {number[]}
 */
export function baseIds(text, brief) {
  const words = text.split(/[\s,#]+/).filter((word) => word !== "");
  const ids = words.map((word) => {
    if (!/^[1-9]\d*$/.test(word)) {
      throw new Error(`${brief}: ${word} isn't a candidate number. Type numbers such as 12, 15.`);
    }
    return Number(word);
  });
  if (ids.length > OPTIMIZER_TEST.runs) {
    throw new Error(`${brief}: name at most ${OPTIMIZER_TEST.runs} candidates to start from.`);
  }
  return ids;
}

// A model test's numbers in plain words (decisions 0030 and 0032). No DOM here, so the wording
// is tested.
/** @import { Rate, ResponseFormatResult, RevisionModeTally, Tally } from "../domain/evaluation-report.js" */
/** @import { Percentiles } from "../domain/percentiles.js" */
/** @import { FeatureRanges } from "../domain/target-schema.js" */
import {
  RESPONSE_FORMAT_RESULT,
  REVISION_TEST,
  REVISION_VERDICT,
} from "../domain/evaluation-report.js";
import { REJECT_REASON } from "../domain/reject-reason.js";
import { rangeWords, TARGET_FEATURES } from "../domain/target-schema.js";

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
    meaning += ` ${truncated === 1 ? "One answer was" : "Some answers were"} cut off before finishing, which usually means the model spent its length limit before writing the answer.`;
  }
  return meaning;
}

/**
 * A tally's revision test, or null for one without: a run outside revision mode, and every
 * report stored before decision 0040, which has no `revision` field.
 * @param {Partial<RevisionModeTally>} tally
 */
const revisionOf = (tally) => tally.revision ?? null;

/** @param {number} p */
const pText = (p) => `p = ${p.toPrecision(2)}`;

/**
 * @param {Rate | null} rate
 * @returns {string} the count with its interval, or a dash when nothing was counted
 */
const shareText = (rate) => (rate === null ? "–" : `${rateText(rate)}. ${rangeText(rate)}`);

/**
 * @param {FeatureRanges} ranges
 * @returns {string} such as `low-end share at most 0.5`
 */
function rangesText(ranges) {
  const parts = Object.entries(TARGET_FEATURES).flatMap(([name, { feature }]) => {
    const range = ranges[name];
    return range === undefined ? [] : [`${feature.label} ${rangeWords(range, feature.unit)}`];
  });
  return parts.length === 0 ? "no ranges" : parts.join("; ");
}

/**
 * What the revision test says, in a sentence or two; null without one.
 * @param {Partial<RevisionModeTally>} tally the overall tally, whose verdict is the acceptance
 */
export function revisionVerdictText(tally) {
  const revision = revisionOf(tally);
  if (revision === null) return null;
  const { revised, verdict, p, afterTreatment } = revision;
  const fixed = `${afterTreatment?.count ?? 0} of ${revised}`;
  if (verdict === REVISION_VERDICT.inconclusive) {
    return `Inconclusive: only ${revised} first tries missed a range and were revised, and the test needs at least ${REVISION_TEST.minimumPairs}. Run it again with more candidates per brief.`;
  }
  const test = pText(/** @type {number} */ (p));
  if (verdict === REVISION_VERDICT.passes) {
    return `The measurements help: of ${revised} revised first tries, the revision that was told its measurements landed inside every range more often than the one that wasn't (${test}, under ${REVISION_TEST.alpha}).`;
  }
  if (verdict === REVISION_VERDICT.askingAgain) {
    return `The gain comes from asking again: the revision told its measurements fixed ${fixed} first tries, but not clearly more than the revision that wasn't told them (${test}). The measurements don't earn their place yet; decide whether to keep the revision step.`;
  }
  return `The revision step didn't help: the revision told its measurements fixed none of ${revised} first tries (${test}).`;
}

/** Each revision verdict in words alone (decision 0086): the counts and p are behind the toggle. */
const REVISION_WORDS = Object.freeze({
  [REVISION_VERDICT.inconclusive]:
    "Inconclusive: too few first tries missed a range to tell. Run it again with more candidates per brief.",
  [REVISION_VERDICT.passes]:
    "The measurements help: the revision that was told its measurements landed inside every range more often than the one that wasn't.",
  [REVISION_VERDICT.askingAgain]:
    "The gain comes from asking again: the revision told its measurements fixed some first tries, but not clearly more than the revision that wasn't told them. The measurements don't earn their place yet; decide whether to keep the revision step.",
  [REVISION_VERDICT.fails]:
    "The revision step didn't help: the revision told its measurements fixed none of the first tries.",
});

/**
 * The revision test's verdict in words, the line under its heading, or null without one.
 * @param {Partial<RevisionModeTally>} tally
 */
export function revisionVerdictWords(tally) {
  const revision = revisionOf(tally);
  if (revision === null) return null;
  const words = REVISION_WORDS[/** @type {keyof typeof REVISION_WORDS} */ (revision.verdict)];
  if (words === undefined) throw new Error(`there is no revision verdict ${revision.verdict}`);
  return words;
}

/**
 * @param {{ treatment: number, control: number }} counts
 */
const armsText = ({ treatment, control }) =>
  `${treatment} with the measurements, ${control} without`;

/**
 * The revision test's facts for one tally, as term and value, or null without one.
 * @param {Partial<RevisionModeTally & { ranges: FeatureRanges, revisionId: number }>} tally a
 *   brief's tally adds the ranges it used
 * @returns {[string, string][] | null}
 */
export function revisionFacts(tally) {
  const revision = revisionOf(tally);
  if (revision === null) return null;
  const { pairs, p } = revision;
  /** @type {[string, string][]} */
  const facts = [];
  if (tally.ranges !== undefined) {
    facts.push([
      "Ranges this test used",
      `${rangesText(tally.ranges)} (brief version ${tally.revisionId})`,
    ]);
  }
  facts.push(
    ["Inside every range, first tries", shareText(revision.firstTries)],
    ["Missed and revised twice", String(revision.revised)],
    ["Inside after revising with the measurements", shareText(revision.afterTreatment)],
    ["Inside after revising without them", shareText(revision.afterControl)],
    [
      "First tries inside, counting the revision with the measurements",
      shareText(revision.firstTriesAfterTreatment),
    ],
    [
      "Which revisions landed inside",
      `both: ${pairs.both}; only the one with the measurements: ${pairs.treatmentOnly}; only the one without: ${pairs.controlOnly}; neither: ${pairs.neither}.`,
    ],
    [
      "Paired test",
      p === null
        ? `inconclusive, fewer than ${REVISION_TEST.minimumPairs} revised`
        : `${pText(p)}: the chance of a split at least this lopsided toward the measurements if they made no difference`,
    ],
    ["Came back unchanged", armsText(revision.unchanged)],
    ["Too long to send", armsText(revision.overBudget)],
    ["Rejected", armsText(revision.rejected)],
  );
  return facts;
}

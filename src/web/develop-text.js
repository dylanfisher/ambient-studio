// Developing a section on the timeline (decision 0079) and bridging a join (0081), with no DOM:
// the confirm before the model is asked, why the button is off, what the chosen section says once
// developed, and where a finished development or bridge goes, by `steerSwap`'s rules for a
// timeline that changed during the run (0066).
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
/** @import { BridgePlan } from "../domain/bridge-plan.js" */
/** @import { SectionGenomes } from "../domain/section-genome.js" */
/** @import { DevelopPlan } from "../domain/develop-plan.js" */
import { arrangementLength } from "../domain/arrangement-length.js";
import { MAX_TRACK_SECONDS } from "../domain/arrangement-schema.js";
import { bridgedArrangement, bridgePlan } from "../domain/bridge-plan.js";
import { DEVELOP_PLAN } from "../domain/develop-plan.js";
import { DEVELOP_LEAST } from "../domain/develop-prompt.js";
import { listed } from "../domain/preference-text.js";
import { clockTime } from "./excerpt-player.js";
import { formatTime } from "./format-time.js";
import { SWAP, steerSwap } from "./material-actions.js";
import { REQUESTS, requestsTimeText } from "./proposal-text.js";
import { setDevelopment } from "./timeline-edits.js";

/**
 * @param {number} index the section's, from 0
 * @param {number} seconds its seconds
 * @param {{ seconds: number | null, timed: number }} estimate as `requestsTimeText` takes it
 * @returns {string} the confirm's question and its cost
 */
export function developCostText(index, seconds, estimate) {
  return (
    `Ask the model to develop section ${index + 1}? It reads your words for the section, the track's arc, the sketch with how it was made, and where the sections on either side meet it, and writes the section's own ${clockTime(seconds)}. ` +
    `That is ${REQUESTS.low} or ${REQUESTS.high} requests to the model: one, and another when the answer needs fixing. ` +
    `Nothing is rendered, and the sketch stays as it is: the development is saved as a new version of this track, with a way back to the plain sketch. ${requestsTimeText(estimate)}`
  );
}

/**
 * Why the chosen section can't be developed now, as the button's title, or null when it can.
 * @param {Section} section
 * @param {boolean} unsaved whether the timeline has changes not saved
 */
export function developRefusal({ seconds }, unsaved) {
  if (unsaved) return "Turned off until the timeline is saved: only a saved version is developed.";
  if (seconds < DEVELOP_LEAST) {
    return `Turned off: a section must play at least ${clockTime(DEVELOP_LEAST)} to be developed, and this one plays ${clockTime(seconds)}.`;
  }
  return null;
}

/**
 * What the chosen section says about the development it plays, or the bridge.
 * @param {{ id: number, text: string, createdAt: number, bridge: boolean } | undefined} development
 * @returns {string}
 */
export function developedText(development) {
  if (!development) return "It plays its sketch as it is.";
  const { id, text, createdAt, bridge } = development;
  const when = formatTime(createdAt);
  if (bridge) {
    const words = text === "" ? "with no words" : `from your words for the join “${text}”`;
    return `It plays bridge ${id}, written ${when} ${words}.`;
  }
  const words = text === "" ? "with no words" : `from your words “${text}”`;
  return `It plays development ${id} of its sketch, written ${when} ${words}.`;
}

/**
 * The bridge's confirm: what the model reads, what it writes, the requests and their time.
 * @param {number} index the transition's, from 0
 * @param {BridgePlan} plan
 * @param {{ seconds: number | null, timed: number }} estimate as `requestsTimeText` takes it
 * @returns {string}
 */
export function bridgeCostText(index, plan, estimate) {
  const [from, to] = [index + 1, index + 2];
  const seconds = plan.parts.reduce((sum, part) => sum + part.seconds, 0);
  const halves =
    plan.parts.length === 1
      ? ""
      : `The two differ in ${plan.differs.join(", ")}, which one genome can't change, so it writes two halves of ${plan.parts.map((part) => clockTime(part.seconds)).join(" and ")} with a ${plan.middle} s crossfade between them${plan.keyless ? ", over which only sounds with no pitch play" : ""}. `;
  const requests = { low: plan.parts.length, high: 2 * plan.parts.length };
  const count =
    requests.low === REQUESTS.low
      ? `${REQUESTS.low} or ${REQUESTS.high} requests to the model: one, and another when the answer needs fixing`
      : `${requests.low} to ${requests.high} requests to the model: one a half, and another for each answer that needs fixing`;
  return (
    `Ask the model to write a bridge between section ${from} and section ${to}? It reads your words for the join, the sketches with how they were made, and where the two sections meet, and writes ${clockTime(seconds)} that starts where section ${from} ends and ends where section ${to} starts, joined to each by a weave. ` +
    `${halves}That is ${count}. Nothing is rendered, and the sketches stay as they are: the bridge is saved as a new version of this track. ${requestsTimeText(estimate, requests)}`
  );
}

/**
 * Why the chosen section's transition can't be bridged now, as the button's title, or null when
 * it can.
 * @param {Arrangement} arrangement a valid one
 * @param {number | null} transition the chosen section's, or null with one section
 * @param {number} seconds the owner's
 * @param {boolean} unsaved whether the timeline has changes not saved
 * @param {SectionGenomes} genomes
 */
export function bridgeRefusal(arrangement, transition, seconds, unsaved, genomes) {
  if (transition === null) return "Turned off: the track has one section, so no join to bridge.";
  if (unsaved) return "Turned off until the timeline is saved: only a saved version is bridged.";
  if (!Number.isFinite(seconds)) return "Turned off: the bridge's seconds must be a number.";
  const plan = bridgePlan(arrangement, transition, seconds, genomes);
  return plan.ok ? null : `Turned off: ${plan.reason}.`;
}

/**
 * What to do with a finished bridge: save it between the two sections it joins, put it on the
 * unsaved timeline, or leave it and say why. The outgoing section is found by `steerSwap`; it and
 * the incoming one after it must still play the same windows of the same genomes, and the track
 * must still fit its longest with the bridge in.
 * @param {Parameters<typeof steerSwap>[0] & { into: Section }} state `from` is the outgoing
 *   section and `at` its place
 * @param {{ developmentIds: number[], plan: BridgePlan }} result the bridge job's
 * @param {string} text the words it was written from
 * @returns {{ kind: typeof SWAP.save | typeof SWAP.edit, index: number, arrangement: Arrangement }
 *   | { kind: typeof SWAP.skip, reason: string }}
 */
export function bridgeSwap({ into, ...state }, { developmentIds, plan }, text) {
  const swap = steerSwap(state);
  if (swap.kind === SWAP.skip) return swap;
  // The genome too, not only the window: the bridge's ends were checked against what each
  // neighbor played when it was written.
  const same = (/** @type {Section | undefined} */ section, /** @type {Section} */ was) =>
    section !== undefined &&
    section.sketchId === was.sketchId &&
    section.offset === was.offset &&
    section.seconds === was.seconds &&
    section.developmentId === was.developmentId;
  const { sections } = state.arrangement;
  if (!same(sections[swap.index], state.from) || !same(sections[swap.index + 1], into)) {
    return {
      kind: SWAP.skip,
      reason: "the two sections it joins have changed or been parted since",
    };
  }
  const arrangement = bridgedArrangement(state.arrangement, swap.index, plan, developmentIds, text);
  const length = arrangementLength(arrangement);
  if (length > MAX_TRACK_SECONDS) {
    return {
      kind: SWAP.skip,
      reason: `with it the track would now play ${length} s, and a track is at most ${MAX_TRACK_SECONDS} s`,
    };
  }
  return { ...swap, arrangement };
}

/**
 * What a skipped bridge's status says: the bridge, the join it was for, and why it isn't placed.
 * @param {number} index the transition's, from 0
 * @param {string} ids the bridge's development ids, listed
 * @param {string} reason `bridgeSwap`'s
 */
export const bridgeSkippedText = (index, ids, reason) =>
  `Kept bridge ${ids} for the join between sections ${index + 1} and ${index + 2} but didn't put it in the track: ${reason}. It is listed under Developments, to place by hand.`;

/**
 * The section numbers, from 1, of each section the plan gives `kind`.
 * @param {readonly DevelopPlan[]} plan
 * @param {DevelopPlan} kind
 */
const numbersOf = (plan, kind) => plan.flatMap((each, i) => (each === kind ? [String(i + 1)] : []));

/** @param {readonly string[]} numbers */
const sectionWords = (numbers) =>
  `section${numbers.length === 1 ? "" : "s"} ${listed([...numbers])}`;

/**
 * The confirm before every section is developed (decision 0082): what each request reads, the
 * sections it develops and their requests, those it keeps and skips, and the time.
 * @param {readonly DevelopPlan[]} plan `developPlan`'s, with a section to develop
 * @param {{ seconds: number | null, timed: number }} estimate as `requestsTimeText` takes it
 * @returns {string}
 */
export function developAllCostText(plan, estimate) {
  const developed = numbersOf(plan, DEVELOP_PLAN.develop);
  const requests = {
    low: developed.length * REQUESTS.low,
    high: developed.length * REQUESTS.high,
  };
  const count =
    developed.length === 1
      ? `${REQUESTS.low} or ${REQUESTS.high} requests to the model: one, and another when the answer needs fixing`
      : `${requests.low} to ${requests.high} requests to the model, one a section and another for each answer that needs fixing`;
  const kept = numbersOf(plan, DEVELOP_PLAN.kept);
  const bridges = numbersOf(plan, DEVELOP_PLAN.bridge);
  // The bridges first: the developed sections' part ends in a clause of its own.
  const keeps = [
    ...(bridges.length === 0
      ? []
      : [`bridge${bridges.length === 1 ? "" : "s"} ${listed([...bridges])}`]),
    ...(kept.length === 0
      ? []
      : [`${sectionWords(kept)}, which ${kept.length === 1 ? "is" : "are"} developed already`]),
  ];
  const short = numbersOf(plan, DEVELOP_PLAN.short);
  return [
    "Ask the model to develop every section of this version, in order? Each request reads your words for its section, the track's arc, the sketch with how it was made, and where the sections on either side meet it, the section before it as it was just developed.",
    `It develops ${sectionWords(developed)}: ${count}.`,
    ...(keeps.length === 0 ? [] : [`It keeps ${listed(keeps)}.`]),
    ...(short.length === 0
      ? []
      : [
          `It skips ${sectionWords(short)}, which ${short.length === 1 ? "is" : "are"} under ${clockTime(DEVELOP_LEAST)}.`,
        ]),
    "Nothing is rendered, and the sketches stay as they are: the developments are saved as one new version of this track. Each is stored as it is written, so a cancel keeps the sections already developed.",
    requestsTimeText(estimate, requests),
  ].join(" ");
}

/**
 * Why Develop every section is off, as the button's title, or null when it is on.
 * @param {readonly DevelopPlan[]} plan
 * @param {boolean} unsaved whether the timeline has changes not saved
 */
export function developAllRefusal(plan, unsaved) {
  if (unsaved) return "Turned off until the timeline is saved: only a saved version is developed.";
  if (!plan.includes(DEVELOP_PLAN.develop)) {
    return `Turned off: every section is developed already, a bridge, or under ${clockTime(DEVELOP_LEAST)}. Tick Develop the developed ones again to write them again.`;
  }
  return null;
}

/**
 * One development the run wrote, and the section it was written for as it was at the start.
 * @typedef {{ at: number, from: Section, developmentId: number }} RunDevelopment
 */

/**
 * The developments a Develop every section run wrote, each with its section: those listed now
 * that weren't before it started, oldest first, paired in order with the sections it develops.
 * The job writes one a section in that order and another develop or bridge job can't run beside
 * it, so the first new ones are the run's, however it ended; one of another sketch than its
 * section's stops the pairing, since it can't be the run's.
 * @param {readonly DevelopPlan[]} plan the run's
 * @param {readonly Section[]} sections the version's it ran on
 * @param {ReadonlySet<number>} known the development ids listed before the run
 * @param {readonly { id: number, sketchId: number }[]} developments listed now, oldest first
 * @returns {RunDevelopment[]}
 */
export function runDevelopments(plan, sections, known, developments) {
  const fresh = developments.filter(({ id }) => !known.has(id));
  const indices = plan.flatMap((kind, i) => (kind === DEVELOP_PLAN.develop ? [i] : []));
  /** @type {RunDevelopment[]} */
  const written = [];
  for (const [i, at] of indices.entries()) {
    const development = fresh[i];
    const from = /** @type {Section} */ (sections[at]);
    if (!development || development.sketchId !== from.sketchId) break;
    written.push({ at, from, developmentId: development.id });
  }
  return written;
}

/**
 * The developments a run wrote: the finished job's own ids, each with its section, or, when it
 * was cancelled or failed and has no result, the rows `runDevelopments` reads. The ids win
 * because a develop job started in another tab may store a row of the same sketch between the
 * page reading `known` and the run's first request.
 * @param {readonly DevelopPlan[]} plan the run's
 * @param {readonly Section[]} sections the version's it ran on
 * @param {{ developed: { index: number, developmentId: number }[] } | null} result the job's
 *   once done, else null
 * @param {ReadonlySet<number>} known the development ids listed just before the run
 * @param {readonly { id: number, sketchId: number }[]} developments listed now, oldest first
 * @returns {RunDevelopment[]}
 */
export function runWritten(plan, sections, result, known, developments) {
  if (result === null) return runDevelopments(plan, sections, known, developments);
  return result.developed.map(({ index, developmentId }) => {
    const from = sections[index];
    if (!from) throw new Error(`the run developed section ${index + 1}, which this version lacks`);
    return { at: index, from, developmentId };
  });
}

/**
 * Where a run's developments go: each into its section by `developSwap`'s rules, one after
 * another on the same timeline, saved as one version or put on the unsaved timeline; one whose
 * section changed is left out with its reason, and opening another version leaves out all.
 * @param {Omit<Parameters<typeof steerSwap>[0], "from" | "at">} state
 * @param {readonly RunDevelopment[]} written
 * @returns {{ kind: (typeof SWAP)[keyof typeof SWAP], arrangement: Arrangement,
 *   placed: { index: number, developmentId: number }[],
 *   skipped: { developmentId: number, reason: string }[] }}
 */
export function developAllSwap(state, written) {
  let { arrangement } = state;
  /** @type {{ index: number, developmentId: number }[]} */
  const placed = [];
  /** @type {{ developmentId: number, reason: string }[]} */
  const skipped = [];
  for (const { at, from, developmentId } of written) {
    const swap = developSwap({ ...state, arrangement, from, at }, developmentId);
    if (swap.kind === SWAP.skip) {
      skipped.push({ developmentId, reason: swap.reason });
      continue;
    }
    arrangement = swap.arrangement;
    placed.push({ index: swap.index, developmentId });
  }
  const kind = placed.length === 0 ? SWAP.skip : state.unsaved ? SWAP.edit : SWAP.save;
  return { kind, arrangement, placed, skipped };
}

/**
 * The note on the version a run's developments are saved as.
 * @param {readonly { index: number }[]} placed
 */
export const developAllNote = (placed) => {
  const numbers = placed.map(({ index }) => String(index + 1));
  const words = sectionWords(numbers);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} developed`;
};

/**
 * A development as the track's list and its select name it: its kind, its sketch, its length.
 * @param {{ id: number, sketchId: number, seconds: number, bridge: boolean }} development
 */
export const developmentName = ({ id, sketchId, seconds, bridge }) =>
  `${bridge ? "Bridge" : "Development"} ${id} of sketch ${sketchId}, ${clockTime(seconds)}`;

/**
 * One development in the track's list: its kind, its sketch, its length, its words, and the
 * sections that play it on the timeline now.
 * @param {{ id: number, sketchId: number, text: string, seconds: number, bridge: boolean }} development
 * @param {readonly number[]} playedIn the sections, from 0, that play it now
 */
export function developmentLine(development, playedIn) {
  const { text, bridge } = development;
  const what = developmentName(development);
  const words =
    text === "" ? "with no words" : `from your words${bridge ? " for the join" : ""} “${text}”`;
  const where =
    playedIn.length === 0
      ? "not in this version"
      : `plays in ${sectionWords(playedIn.map((index) => String(index + 1)))}`;
  return `${what}, ${words}: ${where}.`;
}

/**
 * What to do with a finished development: save it in its section's place, put it on the unsaved
 * timeline, or leave it and say why. The section is the one developed, found by `steerSwap`; it
 * then plays the development from its start.
 * @param {Parameters<typeof steerSwap>[0]} state
 * @param {number} developmentId
 * @returns {{ kind: typeof SWAP.save | typeof SWAP.edit, index: number, arrangement: Arrangement }
 *   | { kind: typeof SWAP.skip, reason: string }}
 */
export function developSwap(state, developmentId) {
  const swap = steerSwap(state);
  if (swap.kind === SWAP.skip) return swap;
  return {
    ...swap,
    arrangement: setDevelopment(state.arrangement, swap.index, developmentId, 0),
  };
}

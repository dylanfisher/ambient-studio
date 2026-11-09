// Developing a section on the timeline (decision 0079) and bridging a join (0081), with no DOM:
// the confirm before the model is asked, why the button is off, what the chosen section says once
// developed, and where a finished development or bridge goes, by `steerSwap`'s rules for a
// timeline that changed during the run (0066).
/** @import { Arrangement, Section } from "../domain/arrangement-schema.js" */
/** @import { BridgePlan } from "../domain/bridge-plan.js" */
/** @import { SectionGenomes } from "../domain/section-genome.js" */
import { arrangementLength } from "../domain/arrangement-length.js";
import { MAX_TRACK_SECONDS } from "../domain/arrangement-schema.js";
import { bridgedArrangement, bridgePlan } from "../domain/bridge-plan.js";
import { DEVELOP_LEAST } from "../domain/develop-prompt.js";
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

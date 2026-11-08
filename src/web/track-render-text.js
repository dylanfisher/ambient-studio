// What a track render costs, said in the timeline's confirm before it starts (decision 0062). No
// DOM here, so the wording is tested.
/** @import { TrackCost } from "../domain/track-cost.js" */
import { trackSeconds } from "../domain/track-cost.js";
import { COST_BUDGET } from "../engine/cost.js";
import { clockTime } from "./excerpt-player.js";

/**
 * @param {TrackCost} cost
 * @param {{ rate: number, measured: boolean }} speed node-seconds a wall second; `measured` when
 *   it is the last track render's, not the bench's
 * @returns {string} the confirm's question and its cost
 */
export function trackRenderText(cost, { rate, measured }) {
  const minutes = Math.max(1, Math.round(trackSeconds(cost, rate) / 60));
  const source = measured ? "the speed of the last track render" : "the speed the bench measured";
  const busy =
    cost.peak > COST_BUDGET
      ? ` During a crossfade both sections play, ${Math.round(cost.peak)} node-seconds a second at most, over the ${COST_BUDGET} one sketch may cost, which makes it slower, not wrong.`
      : "";
  return (
    `Render the whole track, ${clockTime(cost.length)} long? It takes about ${minutes} minute${minutes === 1 ? "" : "s"} at ${source}, and nothing else renders meanwhile.${busy} ` +
    "It makes the preview you can play here; Export then writes the files."
  );
}

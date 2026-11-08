// What a track render and a stems export cost, said in the timeline's confirms before they start
// (decisions 0062, 0063). No DOM here, so the wording is tested.
/** @import { TrackCost } from "../domain/track-cost.js" */
import { trackSeconds } from "../domain/track-cost.js";
import { COST_BUDGET } from "../engine/cost.js";
import { clockTime } from "./excerpt-player.js";

/** @param {boolean} measured whether the speed is the last track render's, not the bench's */
const speedSource = (measured) =>
  measured ? "the speed of the last track render" : "the speed the bench measured";

/**
 * @param {TrackCost} cost
 * @param {{ rate: number, measured: boolean }} speed node-seconds a wall second; `measured` when
 *   it is the last track render's, not the bench's
 * @returns {string} the confirm's question and its cost
 */
export function trackRenderText(cost, { rate, measured }) {
  const minutes = Math.max(1, Math.round(trackSeconds(cost, rate) / 60));
  const source = speedSource(measured);
  const busy =
    cost.peak > COST_BUDGET
      ? ` During a crossfade both sections play, ${Math.round(cost.peak)} node-seconds a second at most, over the ${COST_BUDGET} one sketch may cost, which makes it slower, not wrong.`
      : "";
  return (
    `Render the whole track, ${clockTime(cost.length)} long? It takes about ${minutes} minute${minutes === 1 ? "" : "s"} at ${source}, and nothing else renders meanwhile.${busy} ` +
    "It makes the preview you can play here; Export then writes the files."
  );
}

/**
 * @param {TrackCost} cost the mix's
 * @param {{ rate: number, measured: boolean }} speed as `trackRenderText` takes it
 * @param {readonly string[]} stems the voice ids, one stem each
 * @returns {string} the stems export's question and its time: about one track render a stem
 */
export function stemsText(cost, { rate, measured }, stems) {
  const minutes = Math.max(1, Math.round((trackSeconds(cost, rate) * stems.length) / 60));
  const source = speedSource(measured);
  const count = stems.length === 1 ? "1 stem" : `${stems.length} stems`;
  const voices = new Intl.ListFormat("en-US").format(stems);
  return (
    `Export the track with ${count}, one for each voice: ${voices}? Rendering ${stems.length === 1 ? "the stem" : "the stems"} takes about ${minutes} minute${minutes === 1 ? "" : "s"} at ${source}, about one track render per stem, and nothing else renders meanwhile. ` +
    "Each stem is a 32-bit float WAV at the mix's gain and never limited, so it can pass full scale, and the stems add up to the mix before its limiter."
  );
}

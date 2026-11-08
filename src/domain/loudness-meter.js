import { createKWeightedPower } from "./k-weighted-power.js";
import { powerToLufs } from "./power-to-lufs.js";
import { createWindowPowers } from "./window-powers.js";

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;

/**
 * @typedef {object} LoudnessMeter
 * @property {(channels: Float32Array[]) => void} push the next chunk of one or two channels of
 *   equal length; the channel count is fixed by the first push
 * @property {() => number} integratedLoudness of everything pushed, in LUFS; `-Infinity` when
 *   no block is above the absolute gate. Reading it doesn't end the stream.
 */

/**
 * BS.1770-4 gated integrated loudness over a stream read in chunks of any length, giving the
 * bits `integratedLoudness` gives for the whole stream (0060). It keeps the K-weighting state
 * and one power for each 400 ms gating block: the relative gate needs every block before it
 * can say which count, 80 kB an hour of audio.
 * @param {number} sampleRate must be 48000
 * @returns {LoudnessMeter}
 */
export function createLoudnessMeter(sampleRate) {
  const power = createKWeightedPower(sampleRate);
  // 40 sub-blocks of 10 ms is 400 ms; a hop of 10 is the 75% overlap.
  const gating = createWindowPowers(40, 10);
  /** @type {number[]} */
  const blocks = [];
  return {
    push(channels) {
      for (const block of gating.push(power.push(channels))) blocks.push(block);
    },
    integratedLoudness() {
      const relativeGate = powerToLufs(meanAbove(blocks, ABSOLUTE_GATE_LUFS)) + RELATIVE_GATE_LU;
      return powerToLufs(meanAbove(blocks, Math.max(ABSOLUTE_GATE_LUFS, relativeGate)));
    },
  };
}

/**
 * Mean power of the blocks whose loudness is above `gate`, or 0 when there are none.
 * @param {number[]} blocks
 * @param {number} gate LUFS
 */
function meanAbove(blocks, gate) {
  let sum = 0;
  let count = 0;
  for (const power of blocks) {
    if (powerToLufs(power) > gate) {
      sum += power;
      count++;
    }
  }
  return count === 0 ? 0 : sum / count;
}

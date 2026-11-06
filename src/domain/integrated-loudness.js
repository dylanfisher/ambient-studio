import { kWeightedPower } from "./k-weighted-power.js";
import { powerToLufs } from "./power-to-lufs.js";
import { windowPowers } from "./window-powers.js";

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;

/**
 * BS.1770-4 gated integrated loudness: 400 ms blocks at 75% overlap, the -70 LUFS absolute
 * gate, then the -10 LU relative gate.
 * @param {Float32Array[]} channels one or two channels of equal length
 * @param {number} sampleRate must be 48000
 * @returns {number} LUFS; `-Infinity` when no block is above the absolute gate, including
 *   silence and input shorter than 400 ms
 */
export function integratedLoudness(channels, sampleRate) {
  // 40 sub-blocks of 10 ms is 400 ms; a hop of 10 is the 75% overlap.
  const blocks = windowPowers(kWeightedPower(channels, sampleRate), 40, 10);
  const relativeGate = powerToLufs(meanAbove(blocks, ABSOLUTE_GATE_LUFS)) + RELATIVE_GATE_LU;
  return powerToLufs(meanAbove(blocks, Math.max(ABSOLUTE_GATE_LUFS, relativeGate)));
}

/**
 * Mean power of the blocks whose loudness is above `gate`, or 0 when there are none.
 * @param {Float64Array} blocks
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

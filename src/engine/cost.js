// A genome's render cost, computed from the genome alone, so the gate can keep renders fast
// without timing anything (decisions 0010, 0016).
import { masterBusCost } from "./master-bus.js";
import { requireGenome } from "./validate-genome.js";
import { requireVoiceType } from "./voice-registry.js";

/**
 * The most a genome may cost, in node-seconds alive per second of timeline. At the slowest
 * rate 1a and 1f measured per node-second, it renders at 11.5x real time (decision 0010).
 */
export const COST_BUDGET = 560;

/** `render()` follows every voice with a gate and a level gain. */
const VOICE_NODES = 2;

/**
 * Node-seconds alive per second of timeline: the master bus, plus every voice at its densest
 * as if all of them played at once, so it bounds every window of the render.
 * @param {unknown} genome
 * @returns {number}
 */
export function cost(genome) {
  const normalized = requireGenome(genome, "cost: invalid genome");
  return normalized.voices.reduce(
    (sum, voice) => sum + VOICE_NODES + requireVoiceType(voice.type).cost(voice, normalized),
    masterBusCost(normalized),
  );
}

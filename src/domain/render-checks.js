// Checks on a raw render, before normalize, for the faults a listener would hear or the render
// queue would pay for (decision 0023). They report and never repair.
/** @import { RenderResult } from "../engine/render-plan.js" */
/** @import { Finding, LintResult } from "./lint-result.js" */
import { COST_BUDGET, cost } from "../engine/cost.js";
import { integratedLoudness } from "./integrated-loudness.js";
import { lintResult } from "./lint-result.js";

/** The rule of a near-silence finding; the server reads it to tell why normalize threw. */
export const NEAR_SILENCE = "nearSilence";

/** A sample at or above full scale is clipping. */
const FULL_SCALE = 1;
/**
 * Under this a render is near-silent: normalize's 40 dB gain cap (0011) can't lift it to the
 * loudest target the schema allows, -10 LUFS.
 */
const NEAR_SILENCE_LUFS = -50;
/** A channel whose mean is further from 0 than this (-40 dBFS) has a DC offset. */
const DC_OFFSET = 0.01;

/** @param {number} value */
const round = (value) => Number(value.toPrecision(3));

/** @param {RenderResult} result @returns {Finding[]} */
function clipping({ channels }) {
  return channels.flatMap((channel, c) => {
    const peak = channel.reduce((a, x) => Math.max(a, Math.abs(x)), 0);
    if (peak < FULL_SCALE) return [];
    return [
      {
        path: "$",
        rule: "clipping",
        message: `channel ${c} reaches ${round(peak)} of full scale; lower a voice's level or the master gain`,
      },
    ];
  });
}

/** @param {RenderResult} result @returns {Finding[]} */
function nearSilence({ channels, sampleRate }) {
  const loudness = integratedLoudness(channels, sampleRate);
  if (loudness >= NEAR_SILENCE_LUFS) return [];
  const reads =
    loudness === -Infinity ? "has no measurable loudness" : `reads ${round(loudness)} LUFS`;
  return [
    {
      path: "$",
      rule: NEAR_SILENCE,
      message: `the render ${reads}, under ${NEAR_SILENCE_LUFS} LUFS; raise the voices' levels`,
    },
  ];
}

/** @param {RenderResult} result @returns {Finding[]} */
function dcOffset({ channels }) {
  return channels.flatMap((channel, c) => {
    const mean = channel.reduce((a, x) => a + x, 0) / channel.length;
    if (Math.abs(mean) <= DC_OFFSET) return [];
    return [
      {
        path: "$",
        rule: "dcOffset",
        message: `channel ${c} has a mean of ${round(mean)}, more than ${DC_OFFSET} from 0`,
      },
    ];
  });
}

/**
 * The engine's cost budget, which a render checks and a development's answer is held to (0079).
 * @param {unknown} genome
 * @returns {Finding[]}
 */
export function costBudget(genome) {
  const found = cost(genome);
  if (found <= COST_BUDGET) return [];
  return [
    {
      path: "$",
      rule: "costBudget",
      message: `costs ${round(found)} to render, over the engine's budget of ${COST_BUDGET}; drop a voice or lower a density`,
    },
  ];
}

/**
 * Clipping, near-silence, DC offset and the cost budget, in that order.
 * @param {RenderResult} result the raw render
 * @param {unknown} genome the genome that rendered it
 * @returns {LintResult}
 */
export function renderChecks(result, genome) {
  return lintResult([
    ...clipping(result),
    ...nearSilence(result),
    ...dcOffset(result),
    ...costBudget(genome),
  ]);
}

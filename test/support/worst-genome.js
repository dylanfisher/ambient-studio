// The largest genome the schema allows for a reading (decision 0078): the most voices, every
// voice type in turn, and every parameter that may be a trajectory written as one with the most
// points, globals and macros included. `variant` shifts the values, so two of them differ in
// every trajectory, as a long chain of nudges would.
/** @import { Descriptor } from "../../src/engine/descriptor.js" */
/** @import { Genome } from "../../src/engine/genome-schema.js" */
import { fixedParams } from "../../src/domain/morph-genome.js";
import { allowsTrajectory, isNumeric } from "../../src/engine/descriptor.js";
import { GLOBAL_PARAMS, MACROS, MAX_VOICES } from "../../src/engine/genome-schema.js";
import { MAX_DURATION } from "../../src/engine/timeline.js";
import { MAX_POINTS } from "../../src/engine/trajectory.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { voiceParams, voiceTypeIds } from "../../src/engine/voice-registry.js";

const RECORDING = "810ab2357cb6dd62882afd92502fc013609b1bb326a5ff50873513b125fb0d3f";

/**
 * A full trajectory over the whole timeline, swinging between the descriptor's ends.
 * @param {Descriptor} descriptor
 * @param {number} variant
 */
function fullTrajectory(descriptor, variant) {
  if (!isNumeric(descriptor)) throw new Error("only a number may be a trajectory");
  const { min, max } = descriptor;
  const step = MAX_DURATION / MAX_POINTS;
  const value = (/** @type {number} */ i) => {
    const share = ((i * 7 + variant * 3) % 10) / 10;
    return Math.round((min + share * (max - min)) * 1000) / 1000;
  };
  return {
    points: [
      [0, value(0)],
      ...Array.from({ length: MAX_POINTS - 1 }, (_, i) => [
        Math.round((i + 1) * step * 100) / 100,
        value(i + 1),
        "smooth",
      ]),
    ],
  };
}

/**
 * Every parameter of a table that may be a trajectory, as a full one.
 * @param {Readonly<Record<string, Descriptor>>} table
 * @param {number} variant
 */
const trajectories = (table, variant) =>
  Object.fromEntries(
    Object.entries(table)
      .filter(([, descriptor]) => allowsTrajectory(descriptor))
      .map(([name, descriptor]) => [name, fullTrajectory(descriptor, variant)]),
  );

/**
 * `genome` with 17-digit fixed settings on its first `count` voices: every number
 * `fixedParams` names, at a value no reading's three digits would write as it is, as a long
 * chain of nudges leaves them. A bridge's check compares these exactly (decision 0082).
 * @param {Genome} genome
 * @param {number} count
 * @returns {Genome}
 */
export function longSettings(genome, count) {
  return requireGenome(
    {
      ...genome,
      voices: genome.voices.map((voice, i) => {
        if (i >= count) return voice;
        const table = /** @type {Record<string, any>} */ (voiceParams(voice.type));
        const settings = fixedParams(voice.type)
          .filter((name) => isNumeric(table[name]))
          .map((name) => {
            const { min, max, kind } = table[name];
            const value = min + (max - min) * 0.123456789012345;
            return [name, kind === "int" ? Math.round(value) : value];
          });
        return { ...voice, ...Object.fromEntries(settings) };
      }),
    },
    "long settings",
  );
}

/**
 * @param {number} [variant] 0 or more
 * @returns {Genome}
 */
export function worstGenome(variant = 0) {
  const types = voiceTypeIds();
  const voices = Array.from({ length: MAX_VOICES }, (_, i) => {
    const type = /** @type {string} */ (types[i % types.length]);
    const voice = {
      id: `voice-${i + 1}`,
      type,
      start: i * 10,
      end: MAX_DURATION - i * 10,
      ...trajectories(voiceParams(type), variant + i),
    };
    return type === "recording" ? { ...voice, recording: RECORDING } : voice;
  });
  return requireGenome(
    {
      duration: MAX_DURATION,
      pulse: "beat",
      bpm: 140,
      ...trajectories(GLOBAL_PARAMS, variant),
      macros: trajectories(MACROS, variant),
      voices,
    },
    "the largest genome",
  );
}

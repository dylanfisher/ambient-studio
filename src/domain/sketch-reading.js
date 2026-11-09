// A sketch as short lines the model and the owner both read (decision 0078): the whole piece's
// tuning, scale, key and pulse, each voice, the macros and the excerpt's ranged features. Each
// raw number sits in parentheses after the words that name it, so the page can hide numbers
// and the words still read. Over its cap the last voices lose their detail first, then are
// left out.
/** @import { Genome, Voice } from "../engine/genome-schema.js" */
/** @import { Trajectory } from "../engine/trajectory.js" */
/** @import { Features } from "./extract-features.js" */
import { isChoice, isNumeric } from "../engine/descriptor.js";
import { GLOBAL_PARAMS, MACROS, VOICE_PARAMS } from "../engine/genome-schema.js";
import { isObject } from "../engine/is-object.js";
import { requireVoiceType, voiceParams } from "../engine/voice-registry.js";
import { featureText, featureValue } from "./feature-names.js";
import { fitReading } from "./fit-reading.js";
import { typeWords } from "./genome-changes.js";
import { macroWords } from "./macro-words.js";
import { numberText, trajectoryText } from "./param-text.js";
import { TARGET_FEATURES } from "./target-schema.js";

/**
 * The most tokens the reading of a sketch takes. The develop prompt of step TD.3 holds it beside
 * the lineage reading, the brief, the arc, the section text and three genomes (0078 has the
 * arithmetic).
 */
export const SKETCH_READING_TOKENS = 800;

/** The parameter that sets a voice's pitch where its type has one; others follow the key. */
const PITCH = "root";
/** Every macro shares one descriptor (0006), whose default is neutral. */
const MACRO = MACROS.brightness;
const { level: LEVEL, start: START } = VOICE_PARAMS;

/** A cut voice's level: written with less, then left out. */
const LEVEL_OF = Object.freeze({ full: 0, brief: 1, left: 2 });

/** @param {Genome} genome */
function pieceLine({ duration, tuning, scale, key, pulse, bpm }) {
  const parts = [
    `duration (${numberText(duration, GLOBAL_PARAMS.duration.unit)})`,
    `tuning ${tuning}`,
    `scale ${scale}`,
    ...(key === undefined ? [] : [`key (${key})`]),
    bpm === undefined
      ? `pulse ${pulse}`
      : `pulse ${pulse} (${numberText(bpm, GLOBAL_PARAMS.bpm.unit)})`,
  ];
  return `Whole piece: ${parts.join(", ")}.`;
}

/** @param {Genome} genome */
function movingGlobalsLine(genome) {
  /** @type {Record<string, unknown>} */
  const values = /** @type {any} */ (genome);
  const moving = Object.entries(GLOBAL_PARAMS)
    .filter(([name]) => isObject(values[name]))
    .map(
      ([name, d]) =>
        `${name}, ${d.description} (${trajectoryText(/** @type {Trajectory} */ (values[name]), d)})`,
    );
  return moving.length === 0 ? [] : [`Moves across the piece: ${moving.join("; ")}.`];
}

/**
 * When the voice plays, in words, its times in parentheses.
 * @param {Voice} voice
 * @param {number} duration the genome's
 */
function spanText({ start, end }, duration) {
  const enters = start > 0 ? `${START.description} (${numberText(start, START.unit)})` : null;
  const leaves = end < duration ? `leaves (${numberText(end, START.unit)})` : null;
  if (enters && leaves) return `${enters}, ${leaves}`;
  if (enters) return `${enters}, plays to the end`;
  if (leaves) return `plays from the start, ${leaves}`;
  return "plays throughout";
}

/**
 * One voice in full, or brief: without its type's description, pitch, choices and the numbers
 * of what moves.
 * @param {Voice} voice
 * @param {number} duration
 * @param {boolean} full
 */
function voiceLine(voice, duration, full) {
  const { description, params } = requireVoiceType(voice.type);
  const table = voiceParams(voice.type);
  /** @type {Record<string, unknown>} */
  const held = voice;
  // A parameter every voice has is named by its description, a type's own by its name.
  /** @param {string} name */
  const named = (name) =>
    Object.hasOwn(VOICE_PARAMS, name)
      ? /** @type {{ description: string }} */ (table[name]).description
      : `${name}, ${table[name]?.description}`;
  const parts = [];
  if (!isObject(voice.level)) {
    parts.push(`${LEVEL.description} (${numberText(voice.level, LEVEL.unit)})`);
  }
  parts.push(spanText(voice, duration));
  const pitch = held[PITCH];
  const pitchDescriptor = table[PITCH];
  if (full && typeof pitch === "number" && pitchDescriptor && isNumeric(pitchDescriptor)) {
    parts.push(`${named(PITCH)} (${numberText(pitch, pitchDescriptor.unit)})`);
  }
  const choices = Object.entries(params)
    .filter(([, d]) => isChoice(d))
    .map(([name]) => `${name} ${held[name]}`);
  if (full && choices.length > 0) parts.push(choices.join(", "));
  const moving = Object.entries(table)
    .filter(([name]) => isObject(held[name]))
    .map(([name, d]) =>
      full ? `${named(name)} (${trajectoryText(/** @type {Trajectory} */ (held[name]), d)})` : name,
    );
  // A full entry holds commas of its own, so full entries are set apart by semicolons.
  if (moving.length > 0) parts.push(`moves: ${moving.join(full ? "; " : ", ")}`);
  const type = full ? `${typeWords(voice.type)} [${description}]` : typeWords(voice.type);
  return `Voice ${voice.id}, ${type}: ${parts.join("; ")}.`;
}

/**
 * A macro's value in its own words, as `brighter`, or `neutral` at its default.
 * @param {string} macro
 * @param {number} value
 */
function macroWord(macro, value) {
  if (value === MACRO.default) return "neutral";
  const { more, less } = macroWords(macro);
  return value > MACRO.default ? more : less;
}

/** @param {Genome} genome */
function macrosLine({ macros }) {
  /** @type {string[]} */
  const set = [];
  /** @type {string[]} */
  const neutral = [];
  for (const [macro, value] of Object.entries(macros)) {
    if (isObject(value)) {
      const { points } = /** @type {Trajectory} */ (value);
      const first = macroWord(macro, points[0][1]);
      const last = macroWord(macro, /** @type {[number, number]} */ (points.at(-1))[1]);
      const motion = trajectoryText(/** @type {Trajectory} */ (value), MACRO);
      set.push(
        first === last
          ? `${macro} ${first}, moving (${motion})`
          : `${macro} from ${first} to ${last} (${motion})`,
      );
    } else if (value === MACRO.default) {
      neutral.push(macro);
    } else {
      set.push(`${macro} ${macroWord(macro, value)} (${numberText(value, MACRO.unit)})`);
    }
  }
  if (set.length === 0) set.push("all neutral");
  else if (neutral.length > 0) set.push(`the rest neutral: ${neutral.join(", ")}`);
  return `Macros (${MACRO.description}): ${set.join("; ")}.`;
}

/** @param {Features | null} features */
function featuresLine(features) {
  if (features === null) return "The sketch hasn't been measured yet, so no features are given.";
  const named = Object.values(TARGET_FEATURES).map(
    ({ feature }) =>
      `${feature.label} (${featureText(featureValue(features, feature), feature.digits, feature.unit)})`,
  );
  return `Its excerpt, measured: ${named.join(", ")}.`;
}

/** @param {string[]} ids */
const leftOutLine = (ids) =>
  `Left out for room: ${ids.length === 1 ? "one voice" : `${ids.length} voices`}, ${ids.join(", ")}.`;

/**
 * @param {Genome} genome normalized
 * @param {Features | null} features its excerpt's, or null when it hasn't been measured
 * @param {number} [budgetTokens]
 * @returns {string[]}
 */
export function sketchReading(genome, features, budgetTokens = SKETCH_READING_TOKENS) {
  const { voices, duration } = genome;
  const head = [pieceLine(genome), ...movingGlobalsLine(genome)];
  const tail = [macrosLine(genome), featuresLine(features)];
  /** @param {readonly number[]} levels */
  const write = (levels) => {
    const left = voices.filter((_, i) => levels[i] === LEVEL_OF.left).map(({ id }) => id);
    const kept = voices.flatMap((voice, i) =>
      levels[i] === LEVEL_OF.left ? [] : [voiceLine(voice, duration, levels[i] === LEVEL_OF.full)],
    );
    return [...head, ...kept, ...(left.length > 0 ? [leftOutLine(left)] : []), ...tail];
  };
  const lastFirst = voices.map((_, i) => voices.length - 1 - i);
  /** @type {[number, number][]} */
  const cuts = [
    ...lastFirst.map((i) => /** @type {[number, number]} */ ([i, LEVEL_OF.brief])),
    ...lastFirst.map((i) => /** @type {[number, number]} */ ([i, LEVEL_OF.left])),
  ];
  return fitReading(voices.length, write, cuts, budgetTokens);
}

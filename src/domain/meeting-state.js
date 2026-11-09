// Where a neighboring section meets the one being developed (decision 0079): the previous
// section's genome at its end, or the next one's at its start, as the develop prompt reads it.
// What a morph or a weave needs to match is first: tuning, scale, key, pulse and bpm, then the
// macros and each voice sounding there with its values at that moment. Over its cap the last
// voices lose their values first, then are named only.
/** @import { Genome, Voice } from "../engine/genome-schema.js" */
/** @import { Trajectory } from "../engine/trajectory.js" */
/** @import { Descriptor } from "../engine/descriptor.js" */
import { isNumeric } from "../engine/descriptor.js";
import { GLOBAL_PARAMS, MACROS, VOICE_PARAMS } from "../engine/genome-schema.js";
import { isObject } from "../engine/is-object.js";
import { valueAt } from "../engine/trajectory.js";
import { voiceParams } from "../engine/voice-registry.js";
import { fitReading } from "./fit-reading.js";
import { fixedParams } from "./morph-genome.js";
import { exactText, numberText } from "./param-text.js";
import { PITCH } from "./sketch-reading.js";

/**
 * The most tokens one neighbor's state takes, as 0078's arithmetic budgets it beside the
 * sketch's genome.
 */
export const MEETING_STATE_TOKENS = 180;

/**
 * The most tokens one end of a bridge's state takes, with each voice's settings that can't move
 * (decision 0081): a bridge's prompt can leave out the lineage's reading for the room.
 */
export const BRIDGE_STATE_TOKENS = 270;

/** Which edge of its section a neighbor meets the developed one at. */
export const MEETING_EDGE = Object.freeze(/** @type {const} */ ({ end: "end", start: "start" }));

/** @typedef {(typeof MEETING_EDGE)[keyof typeof MEETING_EDGE]} MeetingEdge */

const MACRO = MACROS.brightness;
const { level: LEVEL } = VOICE_PARAMS;

/** A voice's level of detail: its values, its level alone, or its id among those left out. */
const DETAIL = Object.freeze({ full: 0, level: 1, named: 2 });

/**
 * A value as it stands at `at`: a trajectory read there on its scale, a number as it is.
 * @param {unknown} value
 * @param {number} at
 * @param {import("../engine/descriptor.js").Descriptor | undefined} descriptor
 */
function valueThere(value, at, descriptor) {
  if (!descriptor || !isNumeric(descriptor)) return null;
  const number = isObject(value)
    ? valueAt(/** @type {Trajectory} */ (value), at, descriptor.scale)
    : value;
  return typeof number === "number" ? numberText(number, descriptor.unit) : null;
}

/**
 * Whether the voice sounds where the sections meet: playing up to the end, or from the start.
 * @param {Voice} voice
 * @param {number} at
 * @param {MeetingEdge} edge
 */
export const sounds = ({ start, end }, at, edge) =>
  edge === MEETING_EDGE.end ? start < at && end >= at : start <= at && end > at;

/**
 * A setting that can't move, as the prompt writes it: a number with its unit and every digit,
 * since a bridge's check compares it exactly, and anything else as it is.
 * @param {unknown} value
 * @param {Descriptor} descriptor
 */
const settingText = (value, descriptor) =>
  isNumeric(descriptor) && typeof value === "number"
    ? exactText(value, descriptor.unit)
    : String(value);

/**
 * One voice at `at`: its id and type, its level, and in full its pitch and every parameter that
 * moves, each as it stands there, and with `fixed` every setting that can't move and isn't its
 * default.
 * @param {Voice} voice
 * @param {number} at
 * @param {boolean} full
 * @param {boolean} fixed
 */
function voiceLine(voice, at, full, fixed) {
  const table = voiceParams(voice.type);
  /** @type {Record<string, unknown>} */
  const held = voice;
  const exact = fixed ? fixedParams(voice.type) : [];
  const parts = [`level ${valueThere(voice.level, at, LEVEL)}`];
  if (full) {
    const pitch = valueThere(held[PITCH], at, table[PITCH]);
    // A fixed pitch a bridge must copy is written with the other settings, at every digit.
    if (pitch !== null && !isObject(held[PITCH]) && !exact.includes(PITCH)) {
      parts.push(`${PITCH} ${pitch}`);
    }
    for (const [name, descriptor] of Object.entries(table)) {
      if (descriptor === LEVEL || !isObject(held[name])) continue;
      parts.push(`${name} ${valueThere(held[name], at, descriptor)}`);
    }
  }
  if (full) {
    for (const name of exact) {
      const descriptor = /** @type {Descriptor} */ (table[name]);
      const value = held[name];
      // A recording has no default, so its hash is always written.
      const { default: fallback } = /** @type {{ default?: unknown }} */ (descriptor);
      if (value === undefined || value === fallback) continue;
      parts.push(`${name} ${settingText(value, descriptor)}`);
    }
  }
  return `${voice.id} (${voice.type}): ${parts.join(", ")}`;
}

/**
 * The genome where it meets the developed section, in short lines, at most
 * `MEETING_STATE_TOKENS`.
 * @param {Genome} genome the neighbor's, fitted to its section
 * @param {number} at seconds on that genome's timeline: the section's end or start
 * @param {MeetingEdge} edge
 * @param {number} [budgetTokens]
 * @param {{ fixed?: boolean }} [options] `fixed` adds each voice's settings that can't move,
 *   which a bridge copies (decision 0081)
 * @returns {string[]}
 */
export function meetingState(
  genome,
  at,
  edge,
  budgetTokens = MEETING_STATE_TOKENS,
  { fixed = false } = {},
) {
  const { tuning, scale, key, pulse, bpm } = genome;
  const globals = [
    `tuning ${tuning}`,
    `scale ${scale}`,
    ...(key === undefined ? [] : [`key ${key}`]),
    bpm === undefined
      ? `pulse ${pulse}`
      : `pulse ${pulse} at ${numberText(bpm, GLOBAL_PARAMS.bpm.unit)}`,
  ];
  const macros = Object.entries(genome.macros)
    .map(([name, value]) => [name, valueThere(value, at, MACRO)])
    .filter(([, value]) => value !== numberText(MACRO.default, MACRO.unit))
    .map(([name, value]) => `${name} ${value}`);
  const head = [
    `Globals: ${globals.join(", ")}; macros ${macros.length === 0 ? "all neutral" : `${macros.join(", ")}, the rest neutral`}.`,
  ];
  const voices = genome.voices.filter((voice) => sounds(voice, at, edge));
  if (voices.length === 0) return [...head, "No voice sounds here."];
  /** @param {readonly number[]} levels */
  const write = (levels) => {
    const named = voices.filter((_, i) => levels[i] === DETAIL.named).map(({ id }) => id);
    const lines = voices.flatMap((voice, i) =>
      levels[i] === DETAIL.named ? [] : [voiceLine(voice, at, levels[i] === DETAIL.full, fixed)],
    );
    return [
      ...head,
      `Voices sounding: ${lines.join("; ")}${named.length === 0 ? "" : `; and ${named.join(", ")}`}.`,
    ];
  };
  const lastFirst = voices.map((_, i) => voices.length - 1 - i);
  /** @type {[number, number][]} */
  const cuts = [
    ...lastFirst.map((i) => /** @type {[number, number]} */ ([i, DETAIL.level])),
    ...lastFirst.map((i) => /** @type {[number, number]} */ ([i, DETAIL.named])),
  ];
  return fitReading(voices.length, write, cuts, budgetTokens);
}

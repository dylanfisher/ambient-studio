// The genome's own descriptor tables: global settings, macros, and the parameters every voice
// has. Each voice type adds its own table through the voice registry (decision 0005). Ranges
// and defaults for the master bus, fades and loudness come from step 1r and decision 0018.
/** @import { ValuesOf } from "./descriptor.js" */
/** @import { Trajectory } from "./trajectory.js" */
/** @import { VoiceType } from "./voice-registry.js" */
import { choice, int, number } from "./descriptor.js";
import { MAX_DURATION } from "./timeline.js";
import { isAbsolute } from "./tuning.js";
import { DEFAULT_TUNING, getTuning, tuningIds } from "./tuning-registry.js";

/** Bumped, with a migration from the previous version, whenever the genome's shape changes. */
export const SCHEMA_VERSION = 1;

/** Voice ids are part of every PRNG key, and draws not tied to a voice use "" (decision 0003). */
export const VOICE_ID = /^[a-z][a-z0-9-]{0,15}$/;

/** The genome's keys besides its global parameters; vector paths use the last two as prefixes. */
export const GENOME_KEY = Object.freeze({
  schemaVersion: "schemaVersion",
  macros: "macros",
  voices: "voices",
});

/** The keys every voice has besides its parameters. */
export const VOICE_KEYS = Object.freeze(["id", "type"]);

/** Most voices a genome may hold; a cap added later would invalidate stored genomes. */
export const MAX_VOICES = 16;

const allScales = [
  ...new Set(tuningIds().flatMap((id) => Object.keys(getTuning(id).scales))),
].sort();
const mostDegrees = Math.max(
  ...tuningIds().map((id) => {
    const tuning = getTuning(id);
    return isAbsolute(tuning) ? 1 : tuning.degrees.length;
  }),
);

export const GLOBAL_PARAMS = Object.freeze({
  duration: number({
    min: 60,
    max: MAX_DURATION,
    default: 300,
    unit: "s",
    description: "timeline length",
  }),
  tuning: choice({ values: tuningIds(), default: DEFAULT_TUNING, description: "tuning" }),
  scale: choice({ values: allScales, default: "aeolian", description: "scale of the tuning" }),
  key: int({
    min: 0,
    max: mostDegrees - 1,
    default: 9,
    unit: "",
    description: "root degree",
    when: {
      // `tuning` holds a checked id, or is absent when it was invalid.
      applies: ({ tuning }) =>
        tuning === undefined ? undefined : !isAbsolute(getTuning(/** @type {string} */ (tuning))),
      text: "with a relative tuning",
    },
  }),
  pulse: choice({
    values: ["none", "beat"],
    default: "none",
    description: "beat grid",
  }),
  bpm: int({
    min: 40,
    max: 140,
    default: 60,
    unit: "bpm",
    description: "pulse tempo",
    when: {
      applies: (values) => (values.pulse === undefined ? undefined : values.pulse !== "none"),
      text: 'when pulse isn\'t "none"',
    },
  }),
  loudness: number({
    min: -30,
    max: -9,
    default: -16,
    unit: "LUFS",
    description: "export loudness",
  }),
  ceiling: number({
    min: -3,
    max: -0.3,
    default: -1,
    unit: "dBTP",
    description: "export peak",
  }),
  width: number({
    min: -12,
    max: 0,
    default: -3,
    unit: "dB",
    description: "stereo side/mid",
  }),
  fadeIn: number({ min: 0, max: 60, default: 4, unit: "s", description: "master fade-in" }),
  fadeOut: number({
    min: 0,
    max: 90,
    default: 20,
    unit: "s",
    description: "master fade-out",
  }),
  reverbDecay: number({
    min: 1,
    max: 20,
    default: 8,
    unit: "s",
    scale: "log",
    description: "reverb RT60",
  }),
  reverbLevel: number({
    min: -30,
    max: -6,
    default: -12,
    unit: "dB",
    trajectory: true,
    description: "reverb wet level",
  }),
  delayTime: number({
    min: 0.1,
    max: 2,
    default: 0.75,
    unit: "s",
    scale: "log",
    description: "echo spacing",
  }),
  delayFeedback: number({
    min: 0,
    max: 0.75,
    default: 0.35,
    unit: "",
    trajectory: true,
    safe: [0, 0.6],
    description: "echo feedback",
  }),
  delayLevel: number({
    min: -40,
    max: -6,
    default: -24,
    unit: "dB",
    trajectory: true,
    description: "echo wet level",
  }),
});

// Every macro has the same range (decision 0006), so the schema text gives it once. What each
// macro moves is the mapping table's (step 1d).
const MACRO = number({
  min: 0,
  max: 1,
  default: 0.5,
  unit: "",
  trajectory: true,
  description: "0.5 is neutral",
});

export const MACROS = Object.freeze({
  brightness: MACRO,
  density: MACRO,
  motion: MACRO,
  space: MACRO,
  warmth: MACRO,
  tension: MACRO,
});

export const VOICE_PARAMS = Object.freeze({
  start: number({
    min: 0,
    max: MAX_DURATION,
    default: 0,
    unit: "s",
    description: "enters",
  }),
  end: number({
    min: 0,
    max: MAX_DURATION,
    default: MAX_DURATION,
    unit: "s",
    description: "leaves, after start",
  }),
  level: number({
    min: -60,
    max: 0,
    default: -12,
    unit: "dB",
    trajectory: true,
    safe: [-36, -6],
    description: "voice level",
  }),
  detune: number({
    min: 0,
    max: 12,
    default: 3,
    unit: "cents",
    description: "notes detuned ±this",
  }),
});

/** @typedef {number | boolean | string | Trajectory} ParamValue */

/**
 * A voice as stored: its id and type, the parameters every voice has, and its type's own.
 * @typedef {ValuesOf<typeof VOICE_PARAMS> & { id: string; type: string; [param: string]: ParamValue }} Voice
 */

/**
 * A voice of one known type, with its own parameters typed, for that voice's module.
 * @template {VoiceType} V
 * @typedef {ValuesOf<typeof VOICE_PARAMS> & { id: string; type: V["type"] } & ValuesOf<V["params"]>} VoiceOf
 */

/**
 * A normalized genome, as `validateGenome` returns it.
 * @typedef {ValuesOf<typeof GLOBAL_PARAMS> & {
 *   schemaVersion: number;
 *   macros: ValuesOf<typeof MACROS>;
 *   voices: Voice[];
 * }} Genome
 */

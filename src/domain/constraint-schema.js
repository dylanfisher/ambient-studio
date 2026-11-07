// A vibe's hard constraints, one entry per kind, in the descriptor style of decision 0005: the
// validator, the prompt's text and the linter all read this table (decision 0020). Every kind is
// optional; a kind the vibe leaves out constrains nothing.
/** @import { Descriptor, NumberDescriptor } from "../engine/descriptor.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Trajectory } from "../engine/trajectory.js" */
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { VoiceType } from "../engine/voice-registry.js" */
import { bell } from "../engine/bell.js";
import { COST_BUDGET, cost } from "../engine/cost.js";
import { isNumeric, number } from "../engine/descriptor.js";
import { GLOBAL_PARAMS, MACROS } from "../engine/genome-schema.js";
import { granularCloud } from "../engine/granular-cloud.js";
import { highestValue } from "../engine/highest-value.js";
import { pad } from "../engine/pad.js";
import { isAbsolute } from "../engine/tuning.js";
import { getTuning } from "../engine/tuning-registry.js";
import { show } from "../engine/validation-error.js";
import { paramName } from "./param-name.js";
import { valueRange } from "./value-range.js";

const SECONDS_PER_MINUTE = 60;

/**
 * How a kind constrains the genome: a value it must equal, a range it must stay in, a most it
 * may reach, or a list of voice types. The validator checks a kind's value by its form.
 */
export const FORM = Object.freeze({
  fixed: "fixed",
  range: "range",
  ceiling: "ceiling",
  voices: "voices",
});

/** @typedef {{ min: number, max: number }} Range both ends included */

/**
 * One kind of constraint. `lint` returns a violation for each place the genome breaks it; the
 * linter adds the kind's name as the rule.
 * @template T the constraint's value
 * @typedef {object} ConstraintKind
 * @property {keyof typeof FORM} form
 * @property {Descriptor} [value] what a fixed value, a range's ends or a ceiling may be; a
 *   voice list has none
 * @property {(constraint: T, others: Readonly<Record<string, unknown>>) => string[]} [across]
 *   errors against the set's other kinds, given only the ones that passed their own checks
 * @property {(constraint: T) => string} text the constraint as one line of the prompt
 * @property {(genome: Genome, constraint: T) => ValidationError[]} lint
 */

/**
 * The global parameters that are plain numbers, never trajectories.
 * @typedef {{ [K in keyof typeof GLOBAL_PARAMS]: (typeof GLOBAL_PARAMS)[K] extends NumberDescriptor & { trajectory: false } ? K : never }[keyof typeof GLOBAL_PARAMS]} FixedNumber
 */

/**
 * A number shown to three significant figures, for values the linter derives.
 * @param {number} value
 */
const round = (value) => Number(value.toPrecision(3));

/**
 * A value with its descriptor's unit, as in `-16 LUFS`.
 * @param {unknown} value
 * @param {Descriptor} descriptor
 */
const withUnit = (value, descriptor) =>
  isNumeric(descriptor) && descriptor.unit ? `${value} ${descriptor.unit}` : String(value);

/**
 * The descriptor with trajectories refused: a constraint is a plain number.
 * @param {NumberDescriptor} descriptor
 * @returns {NumberDescriptor}
 */
const still = (descriptor) => Object.freeze({ ...descriptor, trajectory: false });

/**
 * @param {Descriptor} descriptor
 * @returns {Descriptor}
 */
const plain = (descriptor) => (isNumeric(descriptor) ? still(descriptor) : descriptor);

/**
 * A global parameter the genome must equal. A fixed value is checked, never written into the
 * genome, so the model sees the violation and repairs it.
 * @template {keyof typeof GLOBAL_PARAMS} K
 * @param {K} name
 * @param {ConstraintKind<Exclude<Genome[K], Trajectory | undefined>>["across"]} [across]
 * @returns {ConstraintKind<Exclude<Genome[K], Trajectory | undefined>>}
 */
function fixed(name, across) {
  const value = plain(GLOBAL_PARAMS[name]);
  return {
    form: FORM.fixed,
    value,
    ...(across && { across }),
    text: (constraint) => `${name} = ${withUnit(constraint, value)}`,
    lint: (genome, constraint) => {
      const found = genome[name];
      if (found === constraint) return [];
      const got = found === undefined ? `no ${name}` : withUnit(found, value);
      return [
        {
          path: `$.${name}`,
          message: `must be ${withUnit(constraint, value)}, which the vibe fixes; got ${got}`,
        },
      ];
    },
  };
}

/**
 * A global number the genome must keep inside a range. A genome without the parameter (`bpm`
 * with no beat) passes; the `pulse` kind is what requires a beat.
 * @param {FixedNumber} name
 * @param {ConstraintKind<Range>["across"]} [across]
 * @returns {ConstraintKind<Range>}
 */
function range(name, across) {
  const value = still(GLOBAL_PARAMS[name]);
  const span = (/** @type {Range} */ { min, max }) => `from ${min} to ${withUnit(max, value)}`;
  return {
    form: FORM.range,
    value,
    ...(across && { across }),
    text: (constraint) => `${name} ${span(constraint)}`,
    lint: (genome, constraint) => {
      const found = /** @type {number | undefined} */ (genome[name]);
      if (found === undefined || (found >= constraint.min && found <= constraint.max)) return [];
      return [
        {
          path: `$.${name}`,
          message: `must be ${span(constraint)}, which the vibe allows; got ${withUnit(found, value)}`,
        },
      ];
    },
  };
}

/**
 * The voice types a genome may hold (`allowed`) or may not.
 * @param {boolean} allowed
 * @param {ConstraintKind<string[]>["across"]} [across]
 * @returns {ConstraintKind<string[]>}
 */
function voiceList(allowed, across) {
  return {
    form: FORM.voices,
    ...(across && { across }),
    text: (types) => `voice types ${allowed ? "only" : "never"} ${types.join("|")}`,
    lint: (genome, types) =>
      genome.voices.flatMap((voice, i) =>
        types.includes(voice.type) === allowed
          ? []
          : [
              {
                path: `$.voices[${i}].type`,
                message: allowed
                  ? `${show(voice.type)} is not a voice type the vibe allows; use ${types.join("|")}`
                  : `${show(voice.type)} is a voice type the vibe bans`,
              },
            ],
      ),
  };
}

/**
 * The most a voice type's density parameter may reach anywhere on the timeline, the macros'
 * offsets included, read the way the cost reads it (decision 0010).
 * @param {VoiceType} voiceType
 * @param {NumberDescriptor} density the voice type's density descriptor
 * @returns {ConstraintKind<number>}
 */
function densityCeiling(voiceType, density) {
  const value = still(density);
  const name = paramName(voiceType.params, density);
  return {
    form: FORM.ceiling,
    value,
    text: (ceiling) =>
      `${voiceType.type} ${name} at most ${withUnit(ceiling, value)}, macro offsets included`,
    lint: (genome, ceiling) =>
      genome.voices.flatMap((voice, i) => {
        if (voice.type !== voiceType.type) return [];
        const reached = highestValue(genome, voice, name, density, voiceType.macros);
        if (reached <= ceiling) return [];
        return [
          {
            path: `$.voices[${i}].${name}`,
            message: `reaches ${withUnit(round(reached), value)} with macro offsets; the vibe allows at most ${ceiling}`,
          },
        ];
      }),
  };
}

const { hold } = pad.params;

/** The pad starts a chord every `hold` seconds, so its chord rate is a ceiling on 60 / hold. */
const padChords = /** @type {ConstraintKind<number>} */ ({
  form: FORM.ceiling,
  value: number({
    min: SECONDS_PER_MINUTE / hold.max,
    max: SECONDS_PER_MINUTE / hold.min,
    default: SECONDS_PER_MINUTE / hold.min,
    unit: "chords/min",
    scale: "log",
    description: "pad chords a minute",
  }),
  text: (ceiling) =>
    `${pad.type} hold at least ${round(SECONDS_PER_MINUTE / ceiling)} s (at most ${ceiling} chords a minute)`,
  lint: (genome, ceiling) =>
    genome.voices.flatMap((voice, i) => {
      if (voice.type !== pad.type) return [];
      const seconds = /** @type {number} */ (voice.hold);
      const rate = SECONDS_PER_MINUTE / seconds;
      if (rate <= ceiling) return [];
      return [
        {
          path: `$.voices[${i}].hold`,
          message: `${seconds} s is ${round(rate)} chords a minute; the vibe allows at most ${ceiling}, so hold at least ${round(SECONDS_PER_MINUTE / ceiling)} s`,
        },
      ];
    }),
});

/** The brightness macro's range; no macro offsets another, so raw is effective. */
const brightness = /** @type {ConstraintKind<Range>} */ ({
  form: FORM.range,
  value: still(MACROS.brightness),
  text: ({ min, max }) =>
    `macros.brightness stays between ${min} and ${max} the whole time (a number, or a trajectory within that range)`,
  lint: (genome, { min, max }) => {
    const [lo, hi] = valueRange(
      genome.macros.brightness,
      0,
      genome.duration,
      MACROS.brightness.scale,
    );
    if (lo >= min && hi <= max) return [];
    return [
      {
        path: "$.macros.brightness",
        message: `goes from ${round(lo)} to ${round(hi)} on the timeline; the vibe allows ${min} to ${max}`,
      },
    ];
  },
});

/** A ceiling on the engine's render cost, at most the engine's own budget. */
const renderCost = /** @type {ConstraintKind<number>} */ ({
  form: FORM.ceiling,
  value: number({
    min: 0,
    max: COST_BUDGET,
    default: COST_BUDGET,
    unit: "",
    description: "render cost",
  }),
  text: (ceiling) => `render cost at most ${ceiling}; fewer voices, notes and grains cost less`,
  lint: (genome, ceiling) => {
    const found = cost(genome);
    if (found <= ceiling) return [];
    return [
      {
        path: "$",
        message: `costs ${round(found)} to render; the vibe allows at most ${ceiling}, so drop a voice or lower a density`,
      },
    ];
  },
});

/** @type {ConstraintKind<string>["across"]} */
const scaleOfTuning = (scale, { tuning }) => {
  if (tuning === undefined) return [];
  const { id, scales } = getTuning(/** @type {string} */ (tuning));
  if (Object.hasOwn(scales, scale)) return [];
  return [`${show(scale)} is not a scale of ${id}; it has ${Object.keys(scales).join(", ")}`];
};

/** @type {ConstraintKind<number>["across"]} */
const keyOfTuning = (key, { tuning }) => {
  if (tuning === undefined) return [];
  const chosen = getTuning(/** @type {string} */ (tuning));
  if (isAbsolute(chosen)) {
    return [`allowed only ${GLOBAL_PARAMS.key.when.text}; ${chosen.id} has no key`];
  }
  const top = chosen.degrees.length - 1;
  return key > top ? [`must be from 0 to ${top} for ${chosen.id}, got ${key}`] : [];
};

/** @type {ConstraintKind<Range>["across"]} */
const bpmWithBeat = (_bpm, { pulse }) => {
  const { when } = GLOBAL_PARAMS.bpm;
  return pulse === undefined || when.applies({ pulse }) ? [] : [`allowed only ${when.text}`];
};

/** @type {ConstraintKind<string[]>["across"]} */
const bannedNotAllowed = (banned, { allowedVoices }) => {
  const allowed = /** @type {string[] | undefined} */ (allowedVoices) ?? [];
  return banned
    .filter((type) => allowed.includes(type))
    .map((type) => `${show(type)} is also allowed; a type can't be both`);
};

export const CONSTRAINT_KINDS = Object.freeze({
  tuning: fixed("tuning"),
  scale: fixed("scale", scaleOfTuning),
  key: fixed("key", keyOfTuning),
  pulse: fixed("pulse"),
  bpm: range("bpm", bpmWithBeat),
  duration: range("duration"),
  loudness: fixed("loudness"),
  allowedVoices: voiceList(true),
  bannedVoices: voiceList(false, bannedNotAllowed),
  bellNotes: densityCeiling(bell, bell.params.density),
  grains: densityCeiling(granularCloud, granularCloud.params.density),
  padChords,
  brightness,
  cost: renderCost,
});

/**
 * A vibe's constraint set, as `validateConstraints` returns it.
 * @typedef {{ -readonly [K in keyof typeof CONSTRAINT_KINDS]?:
 *   (typeof CONSTRAINT_KINDS)[K] extends ConstraintKind<infer T> ? T : never }} Constraints
 */

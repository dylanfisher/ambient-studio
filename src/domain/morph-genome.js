// A morph from one section of a track into the next (decision 0064): the outgoing section's
// genome, extended across the transition, with its parameters moving to the incoming section's
// along their encoded scale (0005) by the transition's curve, so it plays exactly the outgoing
// section until the morph starts. The track then hands over to the incoming section through a
// short crossfade at the morph's end (`MORPH_HANDOVER`). A weave (0080) is the same morph with
// each voice that splits handing over on its own stretch of the transition, one after another.
/** @import { Descriptor, DescriptorTable, NumberDescriptor } from "../engine/descriptor.js" */
/** @import { Genome, ParamValue, Voice } from "../engine/genome-schema.js" */
/** @import { Curve, Trajectory } from "../engine/trajectory.js" */
import { BAND as BELL_BAND, bell } from "../engine/bell.js";
import { chant } from "../engine/chant.js";
import { cymbal } from "../engine/cymbal.js";
import { allowsTrajectory, isNumeric } from "../engine/descriptor.js";
import { drone } from "../engine/drone.js";
import { drum } from "../engine/drum.js";
import { fieldRecording } from "../engine/field-recording.js";
import {
  GENOME_KEY,
  GLOBAL_PARAMS,
  MACROS,
  MAX_VOICES,
  VOICE_ID,
  VOICE_PARAMS,
} from "../engine/genome-schema.js";
import { granularCloud } from "../engine/granular-cloud.js";
import { isObject } from "../engine/is-object.js";
import { MORPH_HANDOVER, MORPH_SUFFIX } from "../engine/morph.js";
import { noiseBed } from "../engine/noise-bed.js";
import { BAND as PAD_BAND, pad } from "../engine/pad.js";
import { MAX_DURATION } from "../engine/timeline.js";
import { CURVES, DEFAULT_CURVE, MAX_POINTS, valueAt } from "../engine/trajectory.js";
import { requireGenome } from "../engine/validate-genome.js";
import { voiceParams } from "../engine/voice-registry.js";
import { TRANSITION_KIND } from "./arrangement-schema.js";
import { paramName } from "./param-name.js";

/**
 * One side of a morph.
 * @typedef {object} MorphSide
 * @property {Genome} genome the section's fitted genome, with no master fade
 * @property {number} at where the transition starts on this genome's timeline: the outgoing
 *   section's end less the transition's seconds, or the incoming section's offset
 */

/**
 * One split voice's stretch of a weave, on the morph genome's timeline: a leaving voice's level
 * falls to the floor from `from` to `to`, an entering one's rises from it.
 * @typedef {object} Handover
 * @property {string} id the instance's id in the genome
 * @property {boolean} leaves whether it is the outgoing section's
 * @property {number} from
 * @property {number} to
 */

/**
 * A morph's genome with the ids of its renamed instances, whose voice is `voiceOfInstance` of
 * the id, and a weave's handovers in their order (none for a morph); or why the transition plays
 * as a crossfade.
 * @typedef {{ ok: true, genome: Genome, instances: string[], order: Handover[] } | { ok: false, reason: string }} Morph
 */

/** The globals that decide what a note or a beat is; a morph between two values can't move. */
const PITCH = Object.freeze(
  [GLOBAL_PARAMS.tuning, GLOBAL_PARAMS.scale, GLOBAL_PARAMS.key, GLOBAL_PARAMS.pulse].map(
    (descriptor) => /** @type {keyof Genome} */ (paramName(GLOBAL_PARAMS, descriptor)),
  ),
);

/**
 * Every global a morph can't move between two values, so two sections that differ in one play
 * as a crossfade: `PITCH` and the pulse's tempo.
 */
export const JOIN_GLOBALS = Object.freeze([
  ...PITCH,
  /** @type {keyof Genome} */ (paramName(GLOBAL_PARAMS, GLOBAL_PARAMS.bpm)),
]);

/** A voice's place on its timeline, not a sound a morph moves. */
const PLACE = new Set(/** @type {Descriptor[]} */ ([VOICE_PARAMS.start, VOICE_PARAMS.end]));

/**
 * The parameters of a voice of `type` that can't move, which two voices of one id must hold
 * equal for a morph to move one into the other: every choice, flag, recording and fixed number,
 * its start and end aside.
 * @param {string} type
 * @returns {string[]}
 */
export const fixedParams = (type) =>
  Object.entries(voiceParams(type))
    .filter(([, descriptor]) => !PLACE.has(descriptor) && !allowsTrajectory(descriptor))
    .map(([name]) => name);

/** The curves whose segment, cut anywhere, is the same curve to the cut's value. */
const SPLITS = new Set([CURVES.linear, CURVES.late]);

const FLOOR = VOICE_PARAMS.level.min;
const LEVEL = paramName(VOICE_PARAMS, VOICE_PARAMS.level);

/** The parameter, in Hz, that places the register of each type that has one. */
const PITCHED = new Set(
  /** @type {Descriptor[]} */ ([
    chant.params.root,
    cymbal.params.center,
    drone.params.root,
    drum.params.root,
    granularCloud.params.root,
  ]),
);
/**
 * The fundamentals' range of each pitched type whose register no parameter sets.
 * @type {ReadonlyMap<string, { lo: number, hi: number }>}
 */
const BANDS = new Map(
  /** @type {[string, { lo: number, hi: number }][]} */ ([
    [pad.type, PAD_BAND],
    [bell.type, BELL_BAND],
  ]),
);
/** The types with no pitch of their own: a bed, below every pitched voice in a weave's order. */
const BEDS = new Set([noiseBed.type, fieldRecording.type]);

/**
 * Where a voice sits in pitch, in Hz, for a weave's order: its root or center at `time`, the
 * middle of its band on a log scale, or 0 for a bed.
 * @param {Voice} voice
 * @param {number} time on the voice's own timeline
 */
function register(voice, time) {
  const pitch = Object.entries(voiceParams(voice.type)).find(([, d]) => PITCHED.has(d));
  if (pitch) {
    const [name, descriptor] = pitch;
    const value = /** @type {ParamValue} */ (voice[name]);
    return rawAt(/** @type {NumberDescriptor} */ (descriptor), value, time);
  }
  const band = BANDS.get(voice.type);
  if (band) return Math.sqrt(band.lo * band.hi);
  if (BEDS.has(voice.type)) return 0;
  throw new Error(`a weave has no register for voice ${voice.id}, of type ${voice.type}`);
}

/**
 * Moves a value to `target` from `from` to `to` by `curve`. Before `from` it is what it was: a
 * number is left as it is until `from`, and a trajectory keeps its points before `from` and its
 * value at `from`. A segment that `from` falls inside is split there when its curve splits
 * exactly (`linear`, `late`); a `smooth` or `early` one is kept whole, and the move starts at its
 * end, or not at all when that end is at or past `to`.
 * @param {NumberDescriptor} descriptor
 * @param {ParamValue} value a number, or a trajectory
 * @param {number} from
 * @param {number} to
 * @param {number} target
 * @param {Curve} curve
 * @returns {number | Trajectory}
 */
function moveTo(descriptor, value, from, to, target, curve) {
  if (!isObject(value)) {
    return value === target
      ? value
      : {
          points: [
            [from, /** @type {number} */ (value)],
            [to, target, curve],
          ],
        };
  }
  const { points } = /** @type {Trajectory} */ (value);
  const before = points.filter(([time]) => time < from);
  const next = points.find(([time]) => time >= from);
  /** @type {[number, number, Curve][]} */
  const kept = before.map(([time, v, c]) => [time, v, c ?? DEFAULT_CURVE]);
  if (next === undefined || next[0] === from || before.length === 0) {
    const at = valueAt(/** @type {Trajectory} */ (value), from, descriptor.scale);
    kept.push([from, at, next?.[0] === from ? (next[2] ?? DEFAULT_CURVE) : DEFAULT_CURVE]);
  } else {
    const split = /** @type {Curve} */ (next[2]);
    if (SPLITS.has(CURVES[split])) {
      const at = valueAt(/** @type {Trajectory} */ (value), from, descriptor.scale);
      // No int parameter may be a trajectory, so the cut's value needs no rounding.
      kept.push([from, at, split]);
    } else {
      kept.push([next[0], next[1], split]);
    }
  }
  const last = /** @type {[number, number, Curve]} */ (kept.at(-1));
  if (last[0] < to) kept.push([to, target, curve]);
  const [[t0, v0], ...rest] =
    /** @type {[[number, number, Curve], ...[number, number, Curve][]]} */ (kept);
  return { points: [[t0, v0], ...rest] };
}

/**
 * A parameter's raw value at a time on its own timeline, before macros, as the engine reads it.
 * @param {NumberDescriptor} descriptor
 * @param {ParamValue} value
 * @param {number} time
 */
function rawAt(descriptor, value, time) {
  if (!isObject(value)) return /** @type {number} */ (value);
  const at = valueAt(/** @type {Trajectory} */ (value), time, descriptor.scale);
  return descriptor.kind === "int" ? Math.round(at) : at;
}

/**
 * Whether two voices of one id are one voice a morph can move: the same type, every choice,
 * flag, recording and fixed number the same, the outgoing one playing through the morph and the
 * incoming one at its end.
 * @param {Voice} out
 * @param {Voice} into
 * @param {{ from: number, to: number, handover: number }} times
 */
function sameVoice(out, into, { from, to, handover }) {
  if (out.type !== into.type) return false;
  if (!(out.start <= from && out.end >= to && into.start <= handover && into.end > handover)) {
    return false;
  }
  return fixedParams(out.type).every((name) => out[name] === into[name]);
}

/**
 * One side's voices of a weave, one after another across the whole move: with `n` voices and a
 * step of the moving time over `n + 1`, voice `i` moves from step `i` to step `i + 2`, so each
 * overlaps the next by half, the first starts where the morph does and the last ends where it
 * ends. A lone voice takes the whole move, as in a morph.
 * @param {{ voice: Voice, leaves: boolean }[]} side in its order
 * @param {number} from
 * @param {number} to
 */
function oneAfterAnother(side, from, to) {
  const step = (to - from) / (side.length + 1);
  return side.map(({ voice, leaves }, i) => ({
    voice,
    leaves,
    from: i === 0 ? from : from + i * step,
    to: i === side.length - 1 ? to : from + (i + 2) * step,
  }));
}

/**
 * Each split voice's stretch of a weave: the leaving voices fall one after another, highest
 * register first, while the entering ones rise one after another, lowest first, both sides
 * across the whole move (0080); ties keep the genomes' order. Listed leaving voices first.
 * @param {{ voice: Voice, leaves: boolean, register: number }[]} leaving
 * @param {{ voice: Voice, leaves: boolean, register: number }[]} entering
 * @param {number} from
 * @param {number} to
 */
const stretches = (leaving, entering, from, to) => [
  ...oneAfterAnother(
    leaving.toSorted((a, b) => b.register - a.register),
    from,
    to,
  ),
  ...oneAfterAnother(
    entering.toSorted((a, b) => a.register - b.register),
    from,
    to,
  ),
];

/**
 * The morph from `outgoing` into `incoming` over `seconds`: moving for `seconds` less
 * `MORPH_HANDOVER`, then holding the incoming values while the track crossfades to the incoming
 * section. Falls back, with the reason, when the two differ in a way a morph can't move
 * (`tuning`, `scale`, `key`, `pulse` and its `bpm`), or when the morph would hold more than
 * `MAX_VOICES` voices or give a trajectory more than `MAX_POINTS` points. A weave is the same
 * morph with each split voice's level moving on its own stretch (`stretches`).
 * @param {MorphSide} outgoing
 * @param {MorphSide} incoming
 * @param {number} seconds the transition's
 * @param {Curve} curve
 * @param {{ weave?: boolean }} [options]
 * @returns {Morph}
 */
export function morphGenome(outgoing, incoming, seconds, curve, { weave = false } = {}) {
  const out = outgoing.genome;
  const into = incoming.genome;
  const kind = weave ? TRANSITION_KIND.weave : TRANSITION_KIND.morph;
  for (const name of PITCH) {
    if (out[name] !== into[name]) {
      return {
        ok: false,
        reason: `the two sketches have different ${name}s (${out[name]}, ${into[name]}), which a ${kind} can't move between`,
      };
    }
  }
  if (out.bpm !== into.bpm) {
    return {
      ok: false,
      reason: `the two sketches have different tempos (${out.bpm}, ${into.bpm} bpm), which a ${kind} can't move between`,
    };
  }
  const suffixed = [...out.voices, ...into.voices].find(({ id }) => id.endsWith(MORPH_SUFFIX));
  if (suffixed) {
    return {
      ok: false,
      reason: `voice ${suffixed.id}'s id ends in "${MORPH_SUFFIX}", which a ${kind} adds to a renamed voice`,
    };
  }
  const from = outgoing.at;
  const to = from + seconds - MORPH_HANDOVER;
  // Where the morph ends on the incoming section's timeline.
  const handover = incoming.at + seconds - MORPH_HANDOVER;
  /** @type {string[]} */
  const crowded = [];

  /**
   * @param {string} path
   * @param {NumberDescriptor} descriptor
   * @param {ParamValue} value
   * @param {number} target
   * @param {{ from: number, to: number }} [span] when it moves, the whole morph unless a weave's
   *   stretch
   * @returns {number | Trajectory}
   */
  const move = (path, descriptor, value, target, span = { from, to }) => {
    const moved = moveTo(descriptor, value, span.from, span.to, target, curve);
    const points = isObject(moved) ? /** @type {Trajectory} */ (moved).points.length : 0;
    if (points > MAX_POINTS) crowded.push(`${path} ${points} points`);
    return moved;
  };

  /**
   * Each parameter of `table` that may be a trajectory, moved to the incoming value.
   * @param {DescriptorTable} table
   * @param {Record<string, unknown>} values the outgoing side's
   * @param {Record<string, unknown>} targets the incoming side's
   * @param {string} prefix the vector path's
   */
  const moveAll = (table, values, targets, prefix) => {
    /** @type {Record<string, unknown>} */
    const moved = {};
    for (const [name, descriptor] of Object.entries(table)) {
      const value = /** @type {ParamValue | undefined} */ (values[name]);
      const target = /** @type {ParamValue | undefined} */ (targets[name]);
      if (value === undefined || target === undefined || !allowsTrajectory(descriptor)) continue;
      const numeric = /** @type {NumberDescriptor} */ (descriptor);
      moved[name] = move(`${prefix}${name}`, numeric, value, rawAt(numeric, target, handover));
    }
    return moved;
  };

  const incomingIds = new Map(into.voices.map((voice) => [voice.id, voice]));
  /** @param {Voice} voice an outgoing one */
  const moves = (voice) => {
    const match = incomingIds.get(voice.id);
    return match !== undefined && sameVoice(voice, match, { from, to, handover });
  };
  const outgoingIds = new Set(out.voices.map(({ id }) => id));
  const shift = from - incoming.at;
  // The incoming voices that play as instances, placed on the outgoing timeline. One that would
  // start after the morph, or end before it, plays only in the incoming section's own render.
  const rising = [
    ...out.voices.filter((voice) => !moves(voice)).flatMap(({ id }) => incomingIds.get(id) ?? []),
    ...into.voices.filter(({ id }) => !outgoingIds.has(id)),
  ]
    .map((voice) => ({
      voice,
      start: Math.max(from, voice.start + shift),
      end: Math.min(MAX_DURATION, voice.end + shift),
    }))
    .filter(({ start, end }) => start < to && end > from);
  /** The outgoing voices that fall to the floor in the morph. */
  const falling = out.voices.filter(
    (voice) => !moves(voice) && voice.start < to && voice.end > from,
  );
  // Only a voice that sounds through the whole move takes a stretch of it; one that starts or
  // ends inside it falls or rises across the move as in a morph, so a stretch never falls
  // outside its voice's life and a gap in a side's sequence can't open where a voice ends early.
  const order = weave
    ? stretches(
        falling
          .filter((voice) => voice.start <= from && voice.end >= to)
          .map((voice) => ({ voice, leaves: true, register: register(voice, from) })),
        rising
          .filter(({ start, end }) => start <= from && end >= to)
          .map(({ voice }) => ({ voice, leaves: false, register: register(voice, handover) })),
        from,
        to,
      )
    : [];
  // By side: two sections of one sketch may hand the same voice object to both.
  const leavingSpans = new Map(order.filter(({ leaves }) => leaves).map((s) => [s.voice, s]));
  const enteringSpans = new Map(order.filter(({ leaves }) => !leaves).map((s) => [s.voice, s]));

  /** @type {unknown[]} the morph's, checked as its genome is */
  const voices = [];
  /** The outgoing ids the morph's genome holds, which an incoming instance is renamed around. */
  const kept = new Set();
  /** @type {string[]} */
  const instances = [];
  for (const voice of out.voices) {
    if (moves(voice)) {
      const match = /** @type {Voice} */ (incomingIds.get(voice.id));
      voices.push({
        ...voice,
        ...moveAll(voiceParams(voice.type), voice, match, `${GENOME_KEY.voices}.${voice.id}.`),
      });
      kept.add(voice.id);
      continue;
    }
    // An outgoing voice that would start after the morph never sounds in it, so it is left out.
    if (voice.start >= to) continue;
    kept.add(voice.id);
    if (voice.end <= from) {
      voices.push(voice);
      continue;
    }
    const span = leavingSpans.get(voice) ?? { from, to };
    const path = `${GENOME_KEY.voices}.${voice.id}.${LEVEL}`;
    voices.push({
      ...voice,
      level: move(path, VOICE_PARAMS.level, voice.level, FLOOR, span),
      end: Math.min(voice.end, span.to),
    });
  }
  /** @type {Map<Voice, string>} each entering voice's id in the genome */
  const idOf = new Map();
  for (const { voice, start, end } of rising) {
    // Renamed only beside the outgoing voice whose id it would take.
    const id = kept.has(voice.id) ? `${voice.id}${MORPH_SUFFIX}` : voice.id;
    if (id !== voice.id) instances.push(id);
    if (!VOICE_ID.test(id)) {
      return {
        ok: false,
        reason: `voice ${voice.id} differs between the two sketches, and its id is too long to rename as ${id}`,
      };
    }
    idOf.set(voice, id);
    /** @type {Record<string, unknown>} */
    const held = {};
    for (const [name, descriptor] of Object.entries(voiceParams(voice.type))) {
      if (isNumeric(descriptor) && isObject(voice[name])) {
        held[name] = rawAt(descriptor, /** @type {ParamValue} */ (voice[name]), handover);
      }
    }
    const level = rawAt(VOICE_PARAMS.level, voice.level, handover);
    const span = enteringSpans.get(voice) ?? { from, to };
    voices.push({
      ...voice,
      ...held,
      id,
      start: Math.max(start, span.from),
      end,
      level: move(`${GENOME_KEY.voices}.${id}.${LEVEL}`, VOICE_PARAMS.level, FLOOR, level, span),
    });
  }
  if (voices.length > MAX_VOICES) {
    return {
      ok: false,
      reason: `the ${kind} would hold ${voices.length} voices, more than ${MAX_VOICES}`,
    };
  }
  if (crowded.length > 0) {
    return {
      ok: false,
      reason: `the ${kind} would give ${crowded[0]}, more than ${MAX_POINTS}`,
    };
  }
  const genome = {
    ...out,
    ...moveAll(GLOBAL_PARAMS, out, into, ""),
    macros: { ...out.macros, ...moveAll(MACROS, out.macros, into.macros, `${GENOME_KEY.macros}.`) },
    voices,
  };
  return {
    ok: true,
    genome: requireGenome(genome, `the ${kind}'s genome`),
    instances,
    order: order.map(({ voice, leaves, from, to }) => ({
      id: leaves ? voice.id : /** @type {string} */ (idOf.get(voice)),
      leaves,
      from,
      to,
    })),
  };
}

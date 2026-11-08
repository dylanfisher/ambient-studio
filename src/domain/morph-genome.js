// A morph from one section of a track into the next (decision 0064): the outgoing section's
// genome, extended across the transition, with its parameters moving to the incoming section's
// along their encoded scale (0005) by the transition's curve, so it plays exactly the outgoing
// section until the morph starts. The track then hands over to the incoming section through a
// short crossfade at the morph's end (`MORPH_HANDOVER`).
/** @import { Descriptor, DescriptorTable, NumberDescriptor } from "../engine/descriptor.js" */
/** @import { Genome, ParamValue, Voice } from "../engine/genome-schema.js" */
/** @import { Curve, Trajectory } from "../engine/trajectory.js" */
import { allowsTrajectory, isNumeric } from "../engine/descriptor.js";
import {
  GENOME_KEY,
  GLOBAL_PARAMS,
  MACROS,
  MAX_VOICES,
  VOICE_ID,
  VOICE_PARAMS,
} from "../engine/genome-schema.js";
import { isObject } from "../engine/is-object.js";
import { MORPH_HANDOVER, MORPH_SUFFIX } from "../engine/morph.js";
import { MAX_DURATION } from "../engine/timeline.js";
import { CURVES, DEFAULT_CURVE, MAX_POINTS, valueAt } from "../engine/trajectory.js";
import { requireGenome } from "../engine/validate-genome.js";
import { voiceParams } from "../engine/voice-registry.js";
import { paramName } from "./param-name.js";

/**
 * One side of a morph.
 * @typedef {object} MorphSide
 * @property {Genome} genome the section's fitted genome, with no master fade
 * @property {number} at where the transition starts on this genome's timeline: the outgoing
 *   section's end less the transition's seconds, or the incoming section's offset
 */

/**
 * A morph's genome, or why the transition plays as a crossfade. A renamed instance's voice is
 * `voiceOfInstance` of its id.
 * @typedef {{ ok: true, genome: Genome } | { ok: false, reason: string }} Morph
 */

/** The globals that decide what a note or a beat is; a morph between two values can't move. */
const PITCH = Object.freeze(
  [GLOBAL_PARAMS.tuning, GLOBAL_PARAMS.scale, GLOBAL_PARAMS.key, GLOBAL_PARAMS.pulse].map(
    (descriptor) => /** @type {keyof Genome} */ (paramName(GLOBAL_PARAMS, descriptor)),
  ),
);

/** A voice's place on its timeline, not a sound a morph moves. */
const PLACE = new Set(/** @type {Descriptor[]} */ ([VOICE_PARAMS.start, VOICE_PARAMS.end]));

/** The curves whose segment, cut anywhere, is the same curve to the cut's value. */
const SPLITS = new Set([CURVES.linear, CURVES.late]);

const FLOOR = VOICE_PARAMS.level.min;
const LEVEL = paramName(VOICE_PARAMS, VOICE_PARAMS.level);

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
      kept.push([from, descriptor.kind === "int" ? Math.round(at) : at, split]);
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
  return Object.entries(voiceParams(out.type)).every(
    ([name, descriptor]) =>
      PLACE.has(descriptor) || allowsTrajectory(descriptor) || out[name] === into[name],
  );
}

/**
 * The morph from `outgoing` into `incoming` over `seconds`: moving for `seconds` less
 * `MORPH_HANDOVER`, then holding the incoming values while the track crossfades to the incoming
 * section. Falls back, with the reason, when the two differ in a way a morph can't move
 * (`tuning`, `scale`, `key`, `pulse` and its `bpm`), or when the morph would hold more than
 * `MAX_VOICES` voices or give a trajectory more than `MAX_POINTS` points.
 * @param {MorphSide} outgoing
 * @param {MorphSide} incoming
 * @param {number} seconds the transition's
 * @param {Curve} curve
 * @returns {Morph}
 */
export function morphGenome(outgoing, incoming, seconds, curve) {
  const out = outgoing.genome;
  const into = incoming.genome;
  for (const name of PITCH) {
    if (out[name] !== into[name]) {
      return {
        ok: false,
        reason: `the two sketches have different ${name}s (${out[name]}, ${into[name]}), which a morph can't move between`,
      };
    }
  }
  if (out.bpm !== into.bpm) {
    return {
      ok: false,
      reason: `the two sketches have different tempos (${out.bpm}, ${into.bpm} bpm), which a morph can't move between`,
    };
  }
  const suffixed = [...out.voices, ...into.voices].find(({ id }) => id.endsWith(MORPH_SUFFIX));
  if (suffixed) {
    return {
      ok: false,
      reason: `voice ${suffixed.id}'s id ends in "${MORPH_SUFFIX}", which a morph adds to a renamed voice`,
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
   * @returns {number | Trajectory}
   */
  const move = (path, descriptor, value, target) => {
    const moved = moveTo(descriptor, value, from, to, target, curve);
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

  /**
   * The level of an instance falling to the floor or rising from it.
   * @param {Voice} voice
   * @param {number} target
   */
  const fade = (voice, target) =>
    move(`${GENOME_KEY.voices}.${voice.id}.${LEVEL}`, VOICE_PARAMS.level, voice.level, target);

  const incomingIds = new Map(into.voices.map((voice) => [voice.id, voice]));
  /** @type {unknown[]} the morph's, checked as its genome is */
  const voices = [];
  /** @type {Voice[]} */
  const rising = [];
  for (const voice of out.voices) {
    const match = incomingIds.get(voice.id);
    if (match && sameVoice(voice, match, { from, to, handover })) {
      voices.push({
        ...voice,
        ...moveAll(voiceParams(voice.type), voice, match, `${GENOME_KEY.voices}.${voice.id}.`),
      });
      continue;
    }
    if (match) rising.push(match);
    // An outgoing voice that would start after the morph never sounds in it, so it is left out.
    if (voice.start >= to) continue;
    voices.push(
      voice.end <= from
        ? voice
        : { ...voice, level: fade(voice, FLOOR), end: Math.min(voice.end, to) },
    );
  }
  const outgoingIds = new Set(out.voices.map(({ id }) => id));
  rising.push(...into.voices.filter(({ id }) => !outgoingIds.has(id)));
  const shift = from - incoming.at;
  for (const voice of rising) {
    const start = Math.max(from, voice.start + shift);
    const end = Math.min(MAX_DURATION, voice.end + shift);
    // An incoming voice that would start after the morph, or end before it, plays only in the
    // incoming section's own render.
    if (start >= to || end <= from) continue;
    const id = outgoingIds.has(voice.id) ? `${voice.id}${MORPH_SUFFIX}` : voice.id;
    if (!VOICE_ID.test(id)) {
      return {
        ok: false,
        reason: `voice ${voice.id} differs between the two sketches, and its id is too long to rename as ${id}`,
      };
    }
    /** @type {Record<string, unknown>} */
    const held = {};
    for (const [name, descriptor] of Object.entries(voiceParams(voice.type))) {
      if (isNumeric(descriptor) && isObject(voice[name])) {
        held[name] = rawAt(descriptor, /** @type {ParamValue} */ (voice[name]), handover);
      }
    }
    const level = rawAt(VOICE_PARAMS.level, voice.level, handover);
    voices.push({
      ...voice,
      ...held,
      id,
      start,
      end,
      level: move(`${GENOME_KEY.voices}.${id}.${LEVEL}`, VOICE_PARAMS.level, FLOOR, level),
    });
  }
  if (voices.length > MAX_VOICES) {
    return {
      ok: false,
      reason: `the morph would hold ${voices.length} voices, more than ${MAX_VOICES}`,
    };
  }
  if (crowded.length > 0) {
    return {
      ok: false,
      reason: `the morph would give ${crowded[0]}, more than ${MAX_POINTS}`,
    };
  }
  const genome = {
    ...out,
    ...moveAll(GLOBAL_PARAMS, out, into, ""),
    macros: { ...out.macros, ...moveAll(MACROS, out.macros, into.macros, `${GENOME_KEY.macros}.`) },
    voices,
  };
  return { ok: true, genome: requireGenome(genome, "the morph's genome") };
}

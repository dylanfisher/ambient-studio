// A genome as a fixed-length list of positions from 0 to 1, for the preference models and
// optimizers (decision 0005). Only numbers and ints have positions; a trajectory has two, its
// start and end value, and keeps its times and curves.
/** @import { DescriptorTable, NumberDescriptor } from "./descriptor.js" */
/** @import { Genome } from "./genome-schema.js" */
/** @import { Trajectory } from "./trajectory.js" */
import { decode, encode, isNumeric } from "./descriptor.js";
import { GLOBAL_PARAMS, MACROS } from "./genome-schema.js";
import { isObject } from "./is-object.js";
import { requireGenome } from "./validate-genome.js";
import { voiceParams } from "./voice-registry.js";

/**
 * Where one path points: the object holding the value, the parameter's name and descriptor, and
 * for a trajectory which end.
 * @typedef {{
 *   holder: Record<string, unknown>;
 *   name: string;
 *   descriptor: NumberDescriptor;
 *   end?: "start" | "end";
 * }} Target
 */

/**
 * @param {Genome} genome
 * @param {string} path as `width`, `macros.space`, `voices.pad.level.start`
 * @returns {Target}
 */
function locate(genome, path) {
  const parts = path.split(".");
  /** @type {DescriptorTable} */
  let table = GLOBAL_PARAMS;
  /** @type {Record<string, unknown>} */
  let holder = genome;
  if (parts[0] === "macros") {
    table = MACROS;
    holder = genome.macros;
    parts.shift();
  } else if (parts[0] === "voices") {
    const voice = genome.voices.find((v) => v.id === parts[1]);
    if (!voice) throw new Error(`vector path ${path}: no voice "${parts[1]}"`);
    table = voiceParams(voice.type);
    holder = voice;
    parts.splice(0, 2);
  }
  const [name = "", end, ...rest] = parts;
  const descriptor = Object.hasOwn(table, name) ? table[name] : undefined;
  if (!descriptor || rest.length > 0) {
    throw new Error(`vector path ${path}: unknown parameter "${parts.join(".")}"`);
  }
  if (!isNumeric(descriptor)) {
    // An ordinal code for an enum would make an optimizer jump between unrelated values.
    throw new Error(`vector path ${path}: an ${descriptor.kind} has no position (decision 0005)`);
  }
  const value = holder[name];
  if (value === undefined) throw new Error(`vector path ${path}: absent from this genome`);
  if (!isObject(value)) {
    if (end !== undefined) throw new Error(`vector path ${path}: ${name} is not a trajectory`);
    return { holder, name, descriptor };
  }
  if (end !== "start" && end !== "end") {
    throw new Error(`vector path ${path}: ${name} is a trajectory; use .start or .end`);
  }
  if (end === "end" && /** @type {Trajectory} */ (value).points.length === 1) {
    throw new Error(`vector path ${path}: the trajectory has one point; use .start`);
  }
  return { holder, name, descriptor, end };
}

/** @param {Target} target @returns {[number, number]} the point a trajectory's end names */
function endPoint({ holder, name, end }) {
  const { points } = /** @type {Trajectory} */ (holder[name]);
  return /** @type {[number, number]} */ (end === "start" ? points[0] : points.at(-1));
}

/**
 * Every number and int path of a genome, in a fixed order: globals, macros, then voices by id,
 * each in its descriptor table's order. A trajectory gives `.start`, and `.end` when it has
 * more than one point.
 * @param {Genome} genome
 * @returns {string[]}
 */
export function vectorPaths(genome) {
  /** @param {DescriptorTable} table @param {Record<string, unknown>} values @param {string} prefix */
  const pathsOf = (table, values, prefix) =>
    Object.entries(table).flatMap(([name, descriptor]) => {
      const value = values[name];
      if (!isNumeric(descriptor) || value === undefined) return [];
      if (!isObject(value)) return [prefix + name];
      const single = /** @type {Trajectory} */ (value).points.length === 1;
      return single
        ? [`${prefix}${name}.start`]
        : [`${prefix}${name}.start`, `${prefix}${name}.end`];
    });
  const voices = [...genome.voices].sort((a, b) => (a.id < b.id ? -1 : 1));
  return [
    ...pathsOf(GLOBAL_PARAMS, genome, ""),
    ...pathsOf(MACROS, genome.macros, "macros."),
    ...voices.flatMap((voice) => pathsOf(voiceParams(voice.type), voice, `voices.${voice.id}.`)),
  ];
}

/**
 * Each path's value as a position from 0 to 1 along its parameter's scale.
 * @param {Genome} genome
 * @param {readonly string[]} paths
 * @returns {number[]}
 */
export function toVector(genome, paths) {
  return paths.map((path) => {
    const target = locate(genome, path);
    const value = target.end
      ? endPoint(target)[1]
      : /** @type {number} */ (target.holder[target.name]);
    return encode(target.descriptor, value);
  });
}

/**
 * Sets `point[1]` to the value at `position`, leaving it alone when it is already there, so
 * `fromVector(g, p, toVector(g, p))` gives `g` back exactly.
 * @param {NumberDescriptor} descriptor
 * @param {[number, number]} point
 * @param {number} position
 */
function place(descriptor, point, position) {
  if (position !== encode(descriptor, point[1])) point[1] = decode(descriptor, position);
}

/**
 * Moves a trajectory's ends to new positions. Interior points keep where they sat between start
 * and end, mapped affinely along the scale; when start and end were equal, each interior point
 * moves by the ends' moves blended by its time instead.
 * @param {NumberDescriptor} descriptor
 * @param {Trajectory} trajectory
 * @param {{ start?: number; end?: number }} moves new positions
 */
function moveEnds(descriptor, trajectory, moves) {
  const points = /** @type {[number, number][]} */ (trajectory.points);
  const first = /** @type {[number, number]} */ (points[0]);
  const last = /** @type {[number, number]} */ (points.at(-1));
  const s = encode(descriptor, first[1]);
  const e = encode(descriptor, last[1]);
  const s2 = moves.start ?? s;
  const e2 = moves.end ?? e;
  if (s2 === s && e2 === e) return;
  for (const point of points.slice(1, -1)) {
    const u = encode(descriptor, point[1]);
    const blend = (point[0] - first[0]) / (last[0] - first[0]);
    const moved =
      e === s
        ? u + (1 - blend) * (s2 - s) + blend * (e2 - e)
        : s2 + ((u - s) * (e2 - s2)) / (e - s);
    place(descriptor, point, moved);
  }
  place(descriptor, first, s2);
  if (points.length > 1) place(descriptor, last, e2);
}

/**
 * A copy of `genome` with each path set from its position in `vector`. Positions outside 0..1
 * clamp to the range. Throws on a path that doesn't fit the genome, a length mismatch, or a
 * result that isn't a valid genome, such as fades longer than the timeline.
 * @param {Genome} genome
 * @param {readonly string[]} paths
 * @param {readonly number[]} vector
 * @returns {Genome}
 */
export function fromVector(genome, paths, vector) {
  if (paths.length !== vector.length) {
    throw new Error(`fromVector: ${paths.length} paths but ${vector.length} values`);
  }
  const copy = structuredClone(genome);
  /** @type {Map<Trajectory, { descriptor: NumberDescriptor; start?: number; end?: number }>} */
  const trajectories = new Map();
  paths.forEach((path, i) => {
    const target = locate(copy, path);
    const position = /** @type {number} */ (vector[i]);
    const { holder, name, descriptor, end } = target;
    if (!end) {
      const point = /** @type {[number, number]} */ ([0, holder[name]]);
      place(descriptor, point, position);
      holder[name] = point[1];
      return;
    }
    const trajectory = /** @type {Trajectory} */ (holder[name]);
    trajectories.set(trajectory, { descriptor, ...trajectories.get(trajectory), [end]: position });
  });
  // Both ends move together, so the interior is mapped once from the old span to the new one.
  for (const [trajectory, { descriptor, ...moves }] of trajectories) {
    moveEnds(descriptor, trajectory, moves);
  }
  return requireGenome(copy, "fromVector gave an invalid genome");
}

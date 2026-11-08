// A track's macro lanes written into one section's genome (decision 0065): each laned macro
// becomes the section's own value plus the lane's offset, clamped to 0–1, as a trajectory
// sampled where either has a breakpoint and every `LANE_SAMPLE_SECONDS` of the track. Lanes are
// offsets, so the section's own macro motion is kept. `sectionGenome` calls it last, on the
// fitted genome or a morph's, so lanes add to a morph's move.
/** @import { Lane } from "./lane-schema.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Curve, Trajectory } from "../engine/trajectory.js" */
import { MACROS } from "../engine/genome-schema.js";
import { isObject } from "../engine/is-object.js";
import { LANE_CURVE, LANE_POINTS, LANE_SAMPLE_SECONDS } from "../engine/macro-lane.js";
import { valueAt } from "../engine/trajectory.js";
import { requireGenome } from "../engine/validate-genome.js";
import { laneOffsetAt } from "./lane-schema.js";

/**
 * Where a section's genome plays on the track: its timeline from `from` to `to` plays from
 * track second `at`.
 * @typedef {{ at: number, from: number, to: number }} LaneSpan
 */

/**
 * Two samples closer than this, in seconds, are one: a breakpoint mapped from track time onto
 * the genome's can land a rounding error from another.
 */
const SAME_TIME = 1e-9;

/**
 * A time the laned macro is sampled at, on the genome's timeline and on the track's.
 * @typedef {{ time: number, track: number }} Sample
 */

/**
 * Up to `room` of `samples`, spread evenly over them.
 * @param {Sample[]} samples
 * @param {number} room
 */
function spread(samples, room) {
  if (samples.length <= room) return samples;
  return Array.from(
    { length: room },
    (_, i) => /** @type {Sample} */ (samples[Math.floor(((i + 0.5) * samples.length) / room)]),
  );
}

/**
 * The times one laned macro is sampled at: the section's ends and the lane's breakpoints inside
 * it first, then the section's own breakpoints, then the track's grid, each group spread over
 * what room the cap leaves.
 * @param {Lane} lane
 * @param {number | Trajectory} own
 * @param {LaneSpan} span
 * @returns {Sample[]} in time order
 */
function samplesOf(lane, own, { at, from, to }) {
  const end = at + to - from;
  /** @param {number} track */
  const onTrack = (track) => ({ time: from + track - at, track });
  /** @param {number} time */
  const onGenome = (time) => ({ time, track: at + time - from });
  const inside = (/** @type {Sample} */ { time }) => time > from && time < to;
  const ends = [
    { time: from, track: at },
    { time: to, track: end },
  ];
  const breakpoints = lane.points.map(([track]) => onTrack(track)).filter(inside);
  const owns = isObject(own) ? own.points.map(([time]) => onGenome(time)).filter(inside) : [];
  const grid = [];
  for (let k = Math.ceil(at / LANE_SAMPLE_SECONDS); k * LANE_SAMPLE_SECONDS < end; k++) {
    grid.push(onTrack(k * LANE_SAMPLE_SECONDS));
  }
  /** @type {Sample[]} */
  const kept = [];
  for (const group of [[...ends, ...breakpoints], owns, grid.filter(inside)]) {
    const fresh = group.filter(
      ({ time }) => !kept.some((sample) => Math.abs(sample.time - time) < SAME_TIME),
    );
    kept.push(...spread(fresh, LANE_POINTS - kept.length));
  }
  return kept.sort((a, b) => a.time - b.time);
}

/**
 * The macro under its lane: the section's own value plus the lane's offset at each sample,
 * clamped to 0–1, joined by `LANE_CURVE`; a number when every sample is the same.
 * @param {Lane} lane
 * @param {number | Trajectory} own
 * @param {LaneSpan} span
 * @returns {number | Trajectory}
 */
function laned(lane, own, span) {
  const { min, max, scale } = MACROS[lane.macro];
  /** @type {[number, number, Curve][]} */
  const values = samplesOf(lane, own, span).map(({ time, track }) => {
    const base = isObject(own) ? valueAt(own, time, scale) : own;
    const value = Math.min(max, Math.max(min, base + laneOffsetAt(lane.points, track)));
    return [time, value, LANE_CURVE];
  });
  const [[t0, v0], ...rest] =
    /** @type {[[number, number, Curve], ...[number, number, Curve][]]} */ (values);
  if (rest.every(([, value]) => value === v0)) return v0;
  return { points: [[t0, v0], ...rest] };
}

/**
 * The genome with each lane that has points written into its macro; the genome itself when no
 * lane has any.
 * @param {Genome} genome a section's, fitted or a morph's
 * @param {readonly Lane[]} lanes the arrangement's, valid
 * @param {LaneSpan} span where the section plays the genome on the track
 * @returns {Genome}
 */
export function applyLanes(genome, lanes, span) {
  const active = lanes.filter(({ points }) => points.length > 0);
  if (active.length === 0) return genome;
  const macros = { ...genome.macros };
  for (const lane of active) {
    macros[lane.macro] = /** @type {any} */ (laned(lane, macros[lane.macro], span));
  }
  return requireGenome({ ...genome, macros }, "the laned section's genome");
}

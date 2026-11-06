// A genome's parameters at one time on its timeline, as the engine plays them: trajectories
// evaluated and macro offsets applied (decisions 0006 and 0007).
/** @import { Descriptor, DescriptorTable, ValuesOf } from "./descriptor.js" */
/** @import { Genome, ParamValue, Voice } from "./genome-schema.js" */
/** @import { MacroRow } from "./macro-table.js" */
/** @import { Trajectory } from "./trajectory.js" */
import { decode, encode, isNumeric } from "./descriptor.js";
import { GLOBAL_PARAMS, MACROS } from "./genome-schema.js";
import { isObject } from "./is-object.js";
import { GLOBAL_MACRO_ROWS } from "./macro-table.js";
import { valueAt } from "./trajectory.js";
import { requireVoiceType, voiceParams } from "./voice-registry.js";

/**
 * An object's values with every trajectory replaced by a number.
 * @template T
 * @typedef {{ [K in keyof T]: Exclude<T[K], Trajectory> }} Resolved
 */

/**
 * @typedef {Resolved<ValuesOf<typeof GLOBAL_PARAMS>> & {
 *   schemaVersion: number;
 *   macros: Resolved<ValuesOf<typeof MACROS>>;
 *   voices: Resolved<Voice>[];
 * }} EffectiveParams
 */

/**
 * @param {Descriptor} descriptor
 * @param {ParamValue} value
 * @param {number} time
 */
function rawAt(descriptor, value, time) {
  if (!isObject(value) || !isNumeric(descriptor)) return value;
  const at = valueAt(/** @type {Trajectory} */ (value), time, descriptor.scale);
  return descriptor.kind === "int" ? Math.round(at) : at;
}

/**
 * Each parameter of `table` that `values` holds, at `time`, shifted by the macros' rows.
 * @param {DescriptorTable} table
 * @param {Readonly<Record<string, unknown>>} values
 * @param {readonly MacroRow[]} rows
 * @param {Readonly<Record<string, number>>} macros the macros' values at `time`
 * @param {number} time
 */
function resolve(table, values, rows, macros, time) {
  /** @type {Record<string, number | string | boolean>} */
  const out = {};
  for (const [name, descriptor] of Object.entries(table)) {
    const value = /** @type {ParamValue | undefined} */ (values[name]);
    if (value === undefined) continue;
    const raw = rawAt(descriptor, value, time);
    let shift = 0;
    for (const { macro, param, depth } of rows) {
      const level = /** @type {number} */ (macros[macro]);
      if (param === name) shift += depth * (level - 0.5) * 2;
    }
    // A zero shift returns the raw value itself, so neutral macros change nothing, not even
    // the last bit a round trip through `encode` and `decode` would.
    out[name] =
      shift === 0
        ? /** @type {number | string | boolean} */ (raw)
        : decode(descriptor, encode(descriptor, /** @type {number} */ (raw)) + shift);
  }
  return out;
}

/**
 * Every parameter's effective value at `time`: each trajectory evaluated there, then shifted
 * along its scale by Σ depth × (macro − 0.5) × 2 over the macro rows that name it, and clamped to
 * its range. With every macro at 0.5 the values are the raw ones exactly.
 * @param {Genome} genome a normalized genome
 * @param {number} time seconds on the timeline
 * @returns {EffectiveParams}
 */
export function effectiveParams(genome, time) {
  if (!(time >= 0 && time < Infinity)) {
    throw new RangeError(`time must be finite seconds from 0, got ${time}`);
  }
  const macros = /** @type {Record<string, number>} */ (
    resolve(MACROS, genome.macros, [], {}, time)
  );
  const globals = resolve(GLOBAL_PARAMS, genome, GLOBAL_MACRO_ROWS, macros, time);
  const voices = genome.voices.map((voice) => {
    const { macros: rows } = requireVoiceType(voice.type);
    const values = resolve(voiceParams(voice.type), voice, rows, macros, time);
    return { id: voice.id, type: voice.type, ...values };
  });
  return /** @type {EffectiveParams} */ (
    /** @type {unknown} */ ({ schemaVersion: genome.schemaVersion, ...globals, macros, voices })
  );
}

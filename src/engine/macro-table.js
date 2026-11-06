// Which raw parameters each macro moves, and how far (decision 0006). The global rows are here;
// each voice type lists its own in `macros`, and the voice registry checks them with
// `checkMacroRows` when the voice registers. `effectiveParams` reads both.
/** @import { DescriptorTable } from "./descriptor.js" */
import { allowsTrajectory } from "./descriptor.js";
import { GLOBAL_PARAMS, MACROS } from "./genome-schema.js";

/** @typedef {keyof typeof MACROS} MacroName */

/**
 * @typedef {object} MacroRow
 * @property {MacroName} macro
 * @property {string} param a parameter of the table the row belongs to
 * @property {number} depth how far the macro at 1 moves the parameter, as a fraction of its range
 *   along its scale; at 0 it moves as far the other way. Nonzero, from -1 to 1.
 */

/**
 * Throws on a row naming an unknown macro or parameter, a parameter that can't be a trajectory,
 * a depth outside -1..1 or of 0, or the same macro and parameter twice. Only a parameter that
 * may be a trajectory can follow a macro, because any macro may itself be a trajectory, and the
 * engine holds the other parameters fixed for a whole render.
 * @param {readonly MacroRow[]} rows
 * @param {DescriptorTable} table the parameters the rows may name
 * @param {string} owner names the table's owner in error messages: `global`, or the voice type
 * @returns {readonly MacroRow[]} the rows, frozen
 */
export function checkMacroRows(rows, table, owner) {
  const seen = new Set();
  for (const { macro, param, depth } of rows) {
    const where = `${owner}: macro row "${macro}" → "${param}"`;
    if (!Object.hasOwn(MACROS, macro)) throw new Error(`${where}: unknown macro "${macro}"`);
    const descriptor = table[param];
    if (!descriptor) throw new Error(`${where}: no parameter "${param}"`);
    if (!allowsTrajectory(descriptor))
      throw new Error(`${where}: "${param}" can't be a trajectory`);
    if (!(depth >= -1 && depth <= 1 && depth !== 0)) {
      throw new Error(`${where}: depth must be from -1 to 1 and not 0, got ${depth}`);
    }
    const key = `${macro} ${param}`;
    if (seen.has(key)) throw new Error(`${owner}: "${macro}" → "${param}" is listed twice`);
    seen.add(key);
  }
  return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
}

/**
 * The rows on global parameters. Reverb decay stays off this list: it sets the impulse
 * response, which is fixed for a render.
 */
export const GLOBAL_MACRO_ROWS = checkMacroRows(
  [
    { macro: "space", param: "reverbLevel", depth: 0.25 },
    { macro: "space", param: "delayLevel", depth: 0.2 },
  ],
  GLOBAL_PARAMS,
  "global",
);

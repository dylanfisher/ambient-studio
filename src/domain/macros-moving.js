// Which macros move a locked value (decision 0035), for the lock control's offer to lock them
// too: a locked raw value still follows the macros (0006).
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { MacroName, MacroRow } from "../engine/macro-table.js" */
import { MACROS } from "../engine/genome-schema.js";
import { GLOBAL_MACRO_ROWS } from "../engine/macro-table.js";
import { show } from "../engine/validation-error.js";
import { requireVoiceType } from "../engine/voice-registry.js";
import { LOCK_KIND, parseLockPath } from "./lock-path.js";

/**
 * The macros whose rows move the value at a lock path, in the macros' table order: for a whole
 * voice, every macro a row of its type names. A macro moves no other macro.
 * @param {string} path a lock path
 * @param {Genome} genome the genome holding the voice a voice path names
 * @returns {MacroName[]}
 */
export function macrosMoving(path, genome) {
  const target = parseLockPath(path);
  if (!target) throw new Error(`lock path ${path} names no parameter or voice`);
  if (target.kind === LOCK_KIND.macro) return [];
  /** @type {readonly MacroRow[]} */
  let rows = GLOBAL_MACRO_ROWS;
  if (target.kind !== LOCK_KIND.global) {
    const voice = genome.voices.find((v) => v.id === target.voiceId);
    if (!voice)
      throw new Error(`lock path ${path}: the genome has no voice ${show(target.voiceId)}`);
    rows = requireVoiceType(voice.type).macros;
  }
  const moving = rows.filter((row) => target.kind === LOCK_KIND.voice || row.param === target.name);
  return /** @type {MacroName[]} */ (
    Object.keys(MACROS).filter((macro) => moving.some((row) => row.macro === macro))
  );
}

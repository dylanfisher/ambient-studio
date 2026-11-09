// What a words answer does to a session card's fields (decision 0085), no DOM: the values now
// each candidate set sends, the changes that differ from them, the requests a Keep sends, the
// words that say each change, and the values an Undo gives back. The answer fills the card's
// fields unsaved; nothing is sent until the owner keeps it.
/** @import { LockGroup } from "../domain/lock-choices.js" */
/** @import { WordsDirection } from "../domain/words-sets.js" */
import { AXIS_SOURCE } from "../domain/attachment-kind.js";
import { axisName } from "../domain/axis-words.js";
import { macroWords } from "../domain/macro-words.js";
import { positionWords } from "../domain/position-words.js";
import {
  fieldDirection,
  LOCK_STATE,
  MACRO_NONE,
  WORDS_SETS,
  wordsSet,
} from "../domain/words-sets.js";
import { GENOME_KEY, MACROS } from "../engine/genome-schema.js";

/** @typedef {{ field: string, from: unknown, to: unknown }} WordsChange */

/**
 * An answer applied to the values now: the values after, each change that differs from the
 * value now, and the values before, for Undo.
 * @typedef {{ before: Record<string, unknown>, next: Record<string, unknown>,
 *   changed: WordsChange[] }} WordsEdit
 */

/**
 * @param {Readonly<Record<string, unknown>>} current the values now, as the page sent them
 * @param {Readonly<Record<string, unknown>>} changes the job's checked answer
 * @returns {WordsEdit}
 */
export function applyWords(current, changes) {
  /** @type {WordsChange[]} */
  const changed = [];
  for (const [field, to] of Object.entries(changes)) {
    if (!Object.hasOwn(current, field)) throw new Error(`the answer names ${field}, never sent`);
    if (current[field] !== to) changed.push({ field, from: current[field], to });
  }
  return { before: { ...current }, next: { ...current, ...changes }, changed };
}

/**
 * The locks set's values now: locked for each path a live lock holds, free for the rest.
 * @param {readonly LockGroup[]} groups `lockChoices` of the card's genome
 * @param {readonly { path: string }[]} locks the brief's live locks
 * @returns {Record<string, string>}
 */
export const lockValues = (groups, locks) =>
  Object.fromEntries(
    groups.flatMap(({ choices }) =>
      choices.map(({ path }) => [
        path,
        locks.some((lock) => lock.path === path) ? LOCK_STATE.locked : LOCK_STATE.free,
      ]),
    ),
  );

/**
 * The macros set's values now: each macro's live choice, or none.
 * @param {Readonly<Record<string, { id: number, direction: string }>>} choices the card's live macro choices
 * @returns {Record<string, string>}
 */
export const macroValues = (choices) =>
  Object.fromEntries(
    Object.keys(MACROS).map((macro) => [macro, choices[macro]?.direction ?? MACRO_NONE]),
  );

/**
 * The voice a lock path names and whether it names the whole voice, or a null voice for a path
 * outside the voices.
 * @param {string} path
 */
function voiceOf(path) {
  const [head, voice, ...rest] = path.split(".");
  if (head !== GENOME_KEY.voices || voice === undefined) return { voice: null, whole: false };
  return { voice, whole: rest.length === 0 };
}

/**
 * The lock requests a Keep sends, in the order the lock route takes them (0035): every unlock
 * first, then whole voices, then the other paths. A parameter of a voice that stays or becomes
 * locked whole is dropped, since the route refuses a lock inside a voice locked whole and the
 * voice's lock already keeps it.
 * @template {{ path: string }} L
 * @param {readonly WordsChange[]} changed
 * @param {readonly L[]} locks the brief's live locks
 * @returns {{ unlock: L[], lock: string[], dropped: { path: string, voice: string }[] }}
 */
export function lockEdits(changed, locks) {
  const unlock = changed
    .filter(({ to }) => to === LOCK_STATE.free)
    .flatMap(({ field }) => locks.filter((held) => held.path === field));
  const asked = changed.filter(({ to }) => to === LOCK_STATE.locked).map(({ field }) => field);
  const wholes = asked.filter((path) => voiceOf(path).whole);
  const kept = new Set(
    [...locks.filter((held) => !unlock.includes(held)).map(({ path }) => path), ...wholes]
      .filter((path) => voiceOf(path).whole)
      .map((path) => voiceOf(path).voice),
  );
  /** @type {{ path: string, voice: string }[]} */
  const dropped = [];
  /** @type {string[]} */
  const rest = [];
  for (const path of asked) {
    const { voice, whole } = voiceOf(path);
    if (whole) continue;
    if (voice !== null && kept.has(voice)) dropped.push({ path, voice });
    else rest.push(path);
  }
  return { unlock, lock: [...wholes, ...rest], dropped };
}

/**
 * The macro choices a Keep sends: a direction, or null to clear it.
 * @param {readonly WordsChange[]} changed
 * @returns {{ macro: string, direction: string | null }[]}
 */
export const macroEdits = (changed) =>
  changed.map(({ field, to }) => ({
    macro: field,
    direction: to === MACRO_NONE ? null : String(to),
  }));

/**
 * The slider settings an answer sets, by direction id.
 * @param {readonly WordsChange[]} changed
 * @returns {Map<number, number>}
 */
export function steerEdits(changed) {
  /** @type {Map<number, number>} */
  const settings = new Map();
  for (const { field, to } of changed) {
    const id = fieldDirection(field);
    if (id === null) throw new Error(`${field} names no direction`);
    settings.set(id, Number(to));
  }
  return settings;
}

/**
 * Each change in words, for the card's words box, written from templates (as 0047).
 * @param {string} set the field set's name
 * @param {readonly WordsChange[]} changed
 * @param {{ choices: readonly LockGroup[], directions: readonly WordsDirection[],
 *   locks: readonly { path: string }[] }} context the card's lock choices, the brief's
 *   directions and its live locks
 * @returns {string[]}
 */
export function changeLines(set, changed, { choices, directions, locks }) {
  const named = wordsSet(set);
  if (named === WORDS_SETS.locks) {
    const labels = new Map(
      choices.flatMap((group) => group.choices.map(({ path, label }) => [path, label])),
    );
    const { unlock, lock, dropped } = lockEdits(changed, locks);
    /** @param {string} path */
    const label = (path) => labels.get(path) ?? path;
    return [
      ...unlock.map(({ path }) => `Unlock ${label(path)}`),
      ...lock.map((path) => `Lock ${label(path)}`),
      ...dropped.map(
        ({ path, voice }) =>
          `Leave ${voice} ${path.split(".").at(-1)} as it is: the whole ${voice} voice is locked, which keeps it`,
      ),
    ];
  }
  if (named === WORDS_SETS.macros) {
    return changed.map(({ field, to }) => {
      if (to === MACRO_NONE) return `${field}: no choice`;
      return `${field}: ${to} (${macroWords(field)[/** @type {keyof ReturnType<typeof macroWords>} */ (to)]})`;
    });
  }
  if (named === WORDS_SETS.steer) {
    return [...steerEdits(changed)].map(([id, setting]) => {
      const direction = directions.find((shown) => shown.id === id);
      if (!direction) throw new Error(`the answer names direction ${id}, which the page lacks`);
      const axis = axisName({ source: AXIS_SOURCE.direction, ...direction });
      return `Steer aims ${positionWords(direction, setting)} on ${axis}`;
    });
  }
  throw new Error(`the page has no words for the field set ${set}`);
}

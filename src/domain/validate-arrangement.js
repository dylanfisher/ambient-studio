// Checks a track's arrangement (decision 0061), every error with its JSON path, as
// `validateConstraints` does for a vibe's rules (0020). The sketches are looked up through the
// caller, since only the server reads the store; 6h's repair round quotes the errors back.
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { Arrangement, Section } from "./arrangement-schema.js" */
import { checkValue } from "../engine/descriptor.js";
import { isObject } from "../engine/is-object.js";
import { MAX_DURATION } from "../engine/timeline.js";
import { checkKeys, MISSING, show } from "../engine/validation-error.js";
import { arrangementLength } from "./arrangement-length.js";
import {
  ARRANGEMENT_KEY,
  MAX_ARC_CHARS,
  MAX_TRACK_SECONDS,
  SECTION_FIELDS,
  SECTION_KEYS,
  TRACK_LENGTH,
  TRANSITION_KEYS,
  TRANSITION_KIND,
  TRANSITION_SECONDS,
} from "./arrangement-schema.js";
import { NOT_ONE_LINE } from "./explore-direction.js";

/**
 * What the validator needs to know of a sketch a section names.
 * @typedef {object} ArrangementSketch
 * @property {number} vibeId the vibe its candidate was made for
 * @property {string | null} removedReason null while it is live
 * @property {number} duration its genome's, in seconds
 */

/**
 * @typedef {object} ArrangementContext
 * @property {number} vibeId the track's
 * @property {(id: number) => ArrangementSketch | undefined} sketch undefined when there is none
 */

/**
 * @typedef {{ ok: true, arrangement: Arrangement } | { ok: false, errors: ValidationError[] }} ArrangementValidation
 */

/** @param {unknown} value */
const isRowId = (value) => Number.isSafeInteger(value) && /** @type {number} */ (value) > 0;

/**
 * Pushes an error for each of `keys` the object lacks and each key it has that isn't one.
 * @param {Record<string, unknown>} given
 * @param {readonly string[]} keys
 * @param {string} path
 * @param {ValidationError[]} errors
 */
function checkShape(given, keys, path, errors) {
  checkKeys(given, (key) => keys.includes(key), path, errors);
  for (const key of keys) {
    if (given[key] === undefined) errors.push({ path: `${path}.${key}`, message: MISSING });
  }
}

/**
 * Checks one section, returning it when it passed.
 * @param {unknown} given
 * @param {string} path
 * @param {ArrangementContext} context
 * @param {ValidationError[]} errors
 * @returns {Section | undefined}
 */
function checkSection(given, path, { vibeId, sketch }, errors) {
  if (!isObject(given)) {
    errors.push({ path, message: `must be an object, got ${show(given)}` });
    return undefined;
  }
  const before = errors.length;
  checkShape(given, SECTION_KEYS, path, errors);
  const { sketchId } = given;
  /** @type {ArrangementSketch | undefined} */
  let found;
  if (sketchId !== undefined) {
    const at = `${path}.sketchId`;
    if (!isRowId(sketchId)) {
      errors.push({
        path: at,
        message: `must be a sketch's id, a whole number, got ${show(sketchId)}`,
      });
    } else {
      found = sketch(/** @type {number} */ (sketchId));
      if (!found) errors.push({ path: at, message: `there is no sketch ${sketchId}` });
      else if (found.removedReason !== null) {
        errors.push({
          path: at,
          message: `sketch ${sketchId} was removed (${found.removedReason})`,
        });
        found = undefined;
      } else if (found.vibeId !== vibeId) {
        errors.push({
          path: at,
          message: `sketch ${sketchId} is of another vibe (${found.vibeId}); a track's sections are sketches of its own vibe, ${vibeId}`,
        });
        found = undefined;
      }
    }
  }
  for (const [name, descriptor] of Object.entries(SECTION_FIELDS)) {
    if (given[name] !== undefined) checkValue(descriptor, given[name], `${path}.${name}`, errors);
  }
  if (errors.length > before) return undefined;
  const section = /** @type {Section} */ (/** @type {unknown} */ (given));
  if (!found) return undefined;
  if (section.offset >= found.duration) {
    errors.push({
      path: `${path}.offset`,
      message: `must be under its sketch's ${found.duration} s, got ${section.offset}`,
    });
    return undefined;
  }
  const end = section.offset + section.seconds;
  if (end > MAX_DURATION) {
    errors.push({
      path: `${path}.seconds`,
      message: `the section ends at ${end} s on its sketch's timeline; past the sketch's ${found.duration} s it is extended, up to ${MAX_DURATION} s`,
    });
    return undefined;
  }
  return section;
}

/**
 * Checks the transitions: one between each pair of neighbors, each at most half the shorter of
 * its two sections, read only when both passed.
 * @param {unknown} given
 * @param {unknown[]} sections as given
 * @param {(Section | undefined)[]} passed each section, or undefined when it failed
 * @param {ValidationError[]} errors
 */
function checkTransitions(given, sections, passed, errors) {
  const path = `$.${ARRANGEMENT_KEY.transitions}`;
  if (!Array.isArray(given)) {
    errors.push({ path, message: `must be a list, got ${show(given)}` });
    return;
  }
  const wanted = Math.max(0, sections.length - 1);
  if (given.length !== wanted) {
    errors.push({
      path,
      message: `must hold one transition between each pair of neighboring sections: ${wanted} transitions for ${sections.length} sections, got ${given.length}`,
    });
    return;
  }
  given.forEach((transition, i) => {
    const at = `${path}[${i}]`;
    if (!isObject(transition)) {
      errors.push({ path: at, message: `must be an object, got ${show(transition)}` });
      return;
    }
    const before = errors.length;
    checkShape(transition, TRANSITION_KEYS, at, errors);
    const kinds = Object.values(TRANSITION_KIND);
    if (transition.kind !== undefined && !kinds.includes(/** @type {any} */ (transition.kind))) {
      const listed = kinds.map((kind) => JSON.stringify(kind)).join(", ");
      errors.push({
        path: `${at}.kind`,
        message: `must be one of ${listed}, got ${show(transition.kind)}`,
      });
    }
    if (transition.seconds !== undefined) {
      checkValue(TRANSITION_SECONDS, transition.seconds, `${at}.seconds`, errors);
    }
    const [left, right] = [passed[i], passed[i + 1]];
    if (errors.length > before || !left || !right) return;
    const most = Math.min(left.seconds, right.seconds) / 2;
    if (/** @type {number} */ (transition.seconds) > most) {
      errors.push({
        path: `${at}.seconds`,
        message: `must be at most half the shorter of its two sections, ${most} s, got ${transition.seconds}`,
      });
    }
  });
}

/**
 * Pushes an error unless `value` is null or passes `check`, which returns the problem or null.
 * @param {unknown} value
 * @param {string} key
 * @param {(value: unknown) => string | null} check
 * @param {ValidationError[]} errors
 */
function nullOr(value, key, check, errors) {
  if (value === null || value === undefined) return;
  const problem = check(value);
  if (problem !== null) errors.push({ path: `$.${key}`, message: problem });
}

/**
 * Returns the arrangement, or every error found.
 * @param {unknown} value
 * @param {ArrangementContext} context
 * @returns {ArrangementValidation}
 */
export function validateArrangement(value, context) {
  /** @type {ValidationError[]} */
  const errors = [];
  if (!isObject(value)) {
    errors.push({ path: "$", message: `must be an object, got ${show(value)}` });
    return { ok: false, errors };
  }
  checkShape(value, Object.values(ARRANGEMENT_KEY), "$", errors);
  const { length, arc, sections, transitions, lanes, proposal } = value;
  nullOr(
    length,
    ARRANGEMENT_KEY.length,
    (given) => {
      /** @type {ValidationError[]} */
      const found = [];
      checkValue(TRACK_LENGTH, given, "$", found);
      return found[0]?.message ?? null;
    },
    errors,
  );
  nullOr(
    arc,
    ARRANGEMENT_KEY.arc,
    (given) => {
      if (typeof given !== "string" || given.trim() === "")
        return `must be text or null, got ${show(given)}`;
      if (NOT_ONE_LINE.test(given)) return "must be one line, with no control characters";
      return given.length > MAX_ARC_CHARS ? `must be at most ${MAX_ARC_CHARS} characters` : null;
    },
    errors,
  );
  nullOr(
    proposal,
    ARRANGEMENT_KEY.proposal,
    (given) => (isRowId(given) ? null : `must be a generation id or null, got ${show(given)}`),
    errors,
  );
  if (lanes !== undefined && !(Array.isArray(lanes) && lanes.length === 0)) {
    errors.push({
      path: `$.${ARRANGEMENT_KEY.lanes}`,
      message: "must be empty: a track has no macro lanes yet",
    });
  }
  if (sections === undefined) return { ok: false, errors };
  if (!Array.isArray(sections)) {
    errors.push({
      path: `$.${ARRANGEMENT_KEY.sections}`,
      message: `must be a list, got ${show(sections)}`,
    });
    return { ok: false, errors };
  }
  const passed = sections.map((section, i) =>
    checkSection(section, `$.${ARRANGEMENT_KEY.sections}[${i}]`, context, errors),
  );
  if (transitions !== undefined) checkTransitions(transitions, sections, passed, errors);
  if (errors.length > 0) return { ok: false, errors };
  const arrangement = /** @type {Arrangement} */ (/** @type {unknown} */ ({ ...value }));
  const seconds = arrangementLength(arrangement);
  if (seconds > MAX_TRACK_SECONDS) {
    errors.push({
      path: `$.${ARRANGEMENT_KEY.sections}`,
      message: `the track would be ${seconds} s; a track is at most ${MAX_TRACK_SECONDS} s`,
    });
    return { ok: false, errors };
  }
  return { ok: true, arrangement };
}

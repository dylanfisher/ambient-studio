// The words route (decisions 0084, 0085): the owner's words for one field set of a brief's page,
// read by the model as an owner-started job, one at a time. The set is named, never defined, by
// the page; the page sends the set's values now, unsaved, checked against its descriptors. A
// candidate's set names the candidate too, and the route reads its genome for the fields and its
// reading for the prompt, never taking either from the page. A track's set (0087) takes the
// track's id and its arrangement as the page has it, unsaved, checked as Save checks it, with the
// part it changes; the route reads the values now and the reading from the arrangement, and
// checks the answer applied to it by the same validator. The job's result is the checked changes
// and a sentence saying them, for the page to fill its fields with.
/** @import { QuotedError } from "../domain/build-repair-prompt.js" */
/** @import { WordsContext, WordsSet } from "../domain/words-sets.js" */
/** @import { App } from "./routing.js" */
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { Route } from "./routing.js" */
import { ATTACHMENT_KIND } from "../domain/attachment-kind.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { OPERATOR } from "../domain/operator.js";
import { sectionNames, trackTargets } from "../domain/track-words.js";
import { validateArrangement } from "../domain/validate-arrangement.js";
import { fitWordsPrompt, WORDS_CHARS } from "../domain/words-prompt.js";
import { WORDS_SCOPE, WORDS_SETS, wordsSet } from "../domain/words-sets.js";
import { checkValue } from "../engine/descriptor.js";
import { isObject } from "../engine/is-object.js";
import { checkKeys, MISSING, show } from "../engine/validation-error.js";
import { refuseSecondWords, wordsJob } from "./ask-words.js";
import { listAttachments } from "./attachment-store.js";
import { getDevelopment } from "./development-store.js";
import { FIRST_PROMPT_SHARE } from "./draft-brief-routes.js";
import { currentRevision } from "./generate-candidates.js";
import { CANDIDATE_ID, vibeCandidate } from "./lock-routes.js";
import { sketchReadings } from "./rating-routes.js";
import { fields, rowId, text } from "./request-fields.js";
import { HttpError } from "./routing.js";
import { arrangementContext, checkedArrangement } from "./track-routes.js";
import { getTrack, TRACK_REVISION_FIELD } from "./track-store.js";
import { requireVibe } from "./vibe-routes.js";

const WORDS_JOB = JOB_KIND.words;

/** The body's keys a track's set reads (0087). */
const TRACK_KEY = Object.freeze({
  trackId: "trackId",
  arrangement: TRACK_REVISION_FIELD.arrangement,
  target: "target",
});

/** The finding a timeline the answer breaks is quoted under. */
const TIMELINE_RULE = "timeline";

/**
 * The page's values now, or a 400 naming each one that is missing, unknown or not allowed by its
 * field's descriptor.
 * @param {Readonly<Record<string, Descriptor>>} descriptors
 * @param {unknown} current
 * @returns {Record<string, unknown>}
 */
function readCurrent(descriptors, current) {
  if (!isObject(current)) {
    throw new HttpError(
      400,
      `current must be an object of the set's values now, got ${show(current)}`,
    );
  }
  /** @type {ValidationError[]} */
  const errors = [];
  checkKeys(current, (key) => Object.hasOwn(descriptors, key), "current", errors);
  for (const [name, descriptor] of Object.entries(descriptors)) {
    const path = `current.${name}`;
    if (current[name] === undefined) errors.push({ path, message: MISSING });
    else checkValue(descriptor, current[name], path, errors);
  }
  if (errors.length > 0) {
    throw new HttpError(400, errors.map(({ path, message }) => `${path}: ${message}`).join("; "));
  }
  return current;
}

/**
 * A 400 for each of `keys` the body holds, which the set doesn't take.
 * @param {Record<string, unknown>} given
 * @param {readonly string[]} keys
 */
function refuseKeys(given, keys) {
  for (const key of keys) {
    if (given[key] !== undefined) {
      throw new HttpError(400, `the field set ${show(given.set)} takes no ${key}`);
    }
  }
}

/**
 * A track's set's context, read from the body: the track, a live one of the vibe; its
 * arrangement as the page has it, checked as Save checks it; and the part the set changes in it.
 * The values now come from the arrangement, so a body that sends them is a 400. The answer
 * applied to the arrangement is checked by the same validator.
 * @param {App} app
 * @param {number} vibeId
 * @param {WordsSet} set
 * @param {Record<string, unknown>} given the body
 */
function readTrack(app, vibeId, set, given) {
  const { store } = app;
  refuseKeys(given, [CANDIDATE_ID]);
  if (given.current !== undefined) {
    throw new HttpError(
      400,
      `the field set ${show(given.set)} reads its values now from the arrangement; send no current`,
    );
  }
  const trackId = rowId(given, TRACK_KEY.trackId);
  const track = getTrack(store, trackId);
  if (!track || track.removedAt !== null) {
    throw new HttpError(400, `there is no track ${trackId}`);
  }
  if (track.vibeId !== vibeId) {
    throw new HttpError(400, `track ${trackId} is not a track of vibe ${vibeId}`);
  }
  const arrangement = checkedArrangement(store, track, given[TRACK_KEY.arrangement]);
  const target = /** @type {number | string} */ (given[TRACK_KEY.target]);
  const kind = /** @type {NonNullable<WordsSet["target"]>} */ (set.target);
  if (!trackTargets(kind, arrangement).includes(target)) {
    throw new HttpError(400, `the track has no ${kind} ${show(target)}`);
  }
  const names = sectionNames(arrangement, (id) => getDevelopment(store, id)?.bridge === true);
  const context = { arrangement, target, names };
  const validated = arrangementContext(store, vibeId, track.id);
  /**
   * @param {Record<string, unknown>} changes
   * @returns {QuotedError[]}
   */
  const check = (changes) => {
    const apply = /** @type {NonNullable<WordsSet["apply"]>} */ (set.apply);
    const result = validateArrangement(apply(context, changes).arrangement, validated);
    return result.ok
      ? []
      : result.errors.map(({ path, message }) => ({
          path: "$.changes",
          rule: TIMELINE_RULE,
          message: `with these changes the timeline is invalid at ${path}: ${message}`,
        }));
  };
  const current = /** @type {NonNullable<WordsSet["current"]>} */ (set.current)(context);
  return { context, current, check };
}

/**
 * What a set's fields are built from, and the reading of what they change: for a candidate's
 * set, the candidate the body names, checked to be a live one of the vibe, and the brief's
 * directions; for a page's set, nothing. A 400 for a candidate named where the set takes none,
 * or none named where it needs one.
 * @param {App} app
 * @param {number} vibeId
 * @param {WordsSet} set
 * @param {Record<string, unknown>} given the body
 * @returns {{ context: WordsContext, reading: string[], sessionId: number | null }}
 */
function readContext(app, vibeId, set, given) {
  refuseKeys(given, Object.values(TRACK_KEY));
  if (set.scope !== WORDS_SCOPE.candidate) {
    refuseKeys(given, [CANDIDATE_ID]);
    return { context: {}, reading: [], sessionId: null };
  }
  const { candidate, genome } = vibeCandidate(app.store, vibeId, rowId(given, CANDIDATE_ID));
  const directions = listAttachments(app.store, vibeId, ATTACHMENT_KIND.direction).map(
    ({ id, details }) => ({
      id,
      .../** @type {{ near: string | null, far: string }} */ (details),
    }),
  );
  return {
    context: { genome, directions },
    reading: sketchReadings(app, candidate, genome).sketch,
    sessionId: candidate.sessionId,
  };
}

/** @type {Route[]} */
export const WORDS_ROUTES = [
  {
    method: "POST",
    path: "/api/vibes/:vibeId/words",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      const given = fields(await body(), [
        "set",
        "words",
        "current",
        CANDIDATE_ID,
        ...Object.values(TRACK_KEY),
      ]);
      const set = typeof given.set === "string" ? wordsSet(given.set) : undefined;
      if (!set) {
        const known = Object.keys(WORDS_SETS).join(", ");
        throw new HttpError(400, `there is no field set ${show(given.set)}; the sets are ${known}`);
      }
      if (set.scope === WORDS_SCOPE.earSearch) {
        throw new HttpError(
          400,
          `the field set ${show(given.set)} is read from the running search by ear; ask it from the search's own words field`,
        );
      }
      const words = text(given, "words", WORDS_CHARS);
      const { context, reading, sessionId, current, check } =
        set.scope === WORDS_SCOPE.track
          ? { ...readTrack(app, vibe.id, set, given), reading: [], sessionId: null }
          : { ...readContext(app, vibe.id, set, given), current: null, check: undefined };
      const descriptors = set.fields(context);
      if (Object.keys(descriptors).length === 0) {
        throw new HttpError(
          400,
          `the field set ${show(given.set)} has nothing to set here: the brief has no directions yet`,
        );
      }
      let built;
      try {
        built = fitWordsPrompt(
          {
            words,
            brief: currentRevision(app.store, vibe.id).revision.brief,
            reading,
            set,
            context,
            current: current ?? readCurrent(descriptors, given.current),
          },
          Math.floor(app.config.queue.contextBudgetTokens * FIRST_PROMPT_SHARE),
        );
      } catch (error) {
        throw new HttpError(400, /** @type {Error} */ (error).message);
      }
      refuseSecondWords(app);
      const request = {
        vibeId: vibe.id,
        sessionId,
        operator: OPERATOR.words,
        messages: built.messages,
        fields: built.fields,
        ...(check ? { check } : {}),
      };
      return app.jobs.add(WORDS_JOB, wordsJob(app, request));
    },
  },
];

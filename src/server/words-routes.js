// The words route (decisions 0084, 0085): the owner's words for one field set of a brief's page,
// read by the model as an owner-started job, one at a time. The set is named, never defined, by
// the page; the page sends the set's values now, unsaved, checked against its descriptors. A
// candidate's set names the candidate too, and the route reads its genome for the fields and its
// reading for the prompt, never taking either from the page. The job's result is the checked
// changes and a sentence saying them, for the page to fill its fields with.
/** @import { WordsContext, WordsSet } from "../domain/words-sets.js" */
/** @import { App } from "./routing.js" */
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { Route } from "./routing.js" */
import { ATTACHMENT_KIND } from "../domain/attachment-kind.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { OPERATOR } from "../domain/operator.js";
import { fitWordsPrompt, WORDS_CHARS } from "../domain/words-prompt.js";
import { WORDS_SCOPE, WORDS_SETS, wordsSet } from "../domain/words-sets.js";
import { checkValue } from "../engine/descriptor.js";
import { isObject } from "../engine/is-object.js";
import { checkKeys, MISSING, show } from "../engine/validation-error.js";
import { refuseSecondWords, wordsJob } from "./ask-words.js";
import { listAttachments } from "./attachment-store.js";
import { FIRST_PROMPT_SHARE } from "./draft-brief-routes.js";
import { currentRevision } from "./generate-candidates.js";
import { CANDIDATE_ID, vibeCandidate } from "./lock-routes.js";
import { sketchReadings } from "./rating-routes.js";
import { fields, rowId, text } from "./request-fields.js";
import { HttpError } from "./routing.js";
import { requireVibe } from "./vibe-routes.js";

const WORDS_JOB = JOB_KIND.words;

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
  if (set.scope !== WORDS_SCOPE.candidate) {
    if (given[CANDIDATE_ID] !== undefined) {
      throw new HttpError(400, `the field set ${show(given.set)} takes no ${CANDIDATE_ID}`);
    }
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
      const given = fields(await body(), ["set", "words", "current", CANDIDATE_ID]);
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
      const { context, reading, sessionId } = readContext(app, vibe.id, set, given);
      const descriptors = set.fields(context);
      if (Object.keys(descriptors).length === 0) {
        throw new HttpError(
          400,
          `the field set ${show(given.set)} has nothing to set here: the brief has no directions yet`,
        );
      }
      const current = readCurrent(descriptors, given.current);
      let built;
      try {
        built = fitWordsPrompt(
          {
            words,
            brief: currentRevision(app.store, vibe.id).revision.brief,
            reading,
            set,
            context,
            current,
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
      };
      return app.jobs.add(WORDS_JOB, wordsJob(app, request));
    },
  },
];

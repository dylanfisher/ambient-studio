// The words route (decision 0084): the owner's words for one field set of a brief's page, read
// by the model as an owner-started job, one at a time. The set is named, never defined, by the
// page; the page sends the set's values now, unsaved, checked against its descriptors. The job's
// result is the checked changes and a sentence saying them, for the page to fill its fields with.
/** @import { WordsField } from "../domain/words-prompt.js" */
/** @import { Descriptor } from "../engine/descriptor.js" */
/** @import { ValidationError } from "../engine/validation-error.js" */
/** @import { Route } from "./routing.js" */
import { JOB_KIND } from "../domain/job-kind.js";
import { OPERATOR } from "../domain/operator.js";
import { buildWordsPrompt, WORDS_CHARS } from "../domain/words-prompt.js";
import { WORDS_SCOPE, WORDS_SETS, wordsSet } from "../domain/words-sets.js";
import { checkValue } from "../engine/descriptor.js";
import { isObject } from "../engine/is-object.js";
import { checkKeys, MISSING, show } from "../engine/validation-error.js";
import { wordsJob } from "./ask-words.js";
import { FIRST_PROMPT_SHARE } from "./draft-brief-routes.js";
import { currentRevision } from "./generate-candidates.js";
import { fields, text } from "./request-fields.js";
import { HttpError, refuseUnfinished } from "./routing.js";
import { requireVibe } from "./vibe-routes.js";

const WORDS_JOB = JOB_KIND.words;

/**
 * The page's values now as the fields asked about, or a 400 naming each one that is missing,
 * unknown or not allowed by its descriptor.
 * @param {Readonly<Record<string, Descriptor>>} descriptors
 * @param {unknown} current
 * @returns {WordsField[]}
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
  return Object.entries(descriptors).map(([name, descriptor]) => ({
    name,
    descriptor,
    current: current[name],
  }));
}

/** @type {Route[]} */
export const WORDS_ROUTES = [
  {
    method: "POST",
    path: "/api/vibes/:vibeId/words",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      const given = fields(await body(), ["set", "words", "current"]);
      const set = typeof given.set === "string" ? wordsSet(given.set) : undefined;
      if (!set) {
        const known = Object.keys(WORDS_SETS).join(", ");
        throw new HttpError(400, `there is no field set ${show(given.set)}; the sets are ${known}`);
      }
      if (set.scope !== WORDS_SCOPE.page) {
        throw new HttpError(
          400,
          `the field set ${show(given.set)} is read from the running search by ear; ask it from the search's own words field`,
        );
      }
      const words = text(given, "words", WORDS_CHARS);
      const asked = readCurrent(set.fields([]), given.current);
      let messages;
      try {
        messages = buildWordsPrompt(
          {
            words,
            subject: set.subject,
            fields: asked,
            brief: currentRevision(app.store, vibe.id).revision.brief,
            reading: [],
          },
          Math.floor(app.config.queue.contextBudgetTokens * FIRST_PROMPT_SHARE),
        );
      } catch (error) {
        throw new HttpError(400, /** @type {Error} */ (error).message);
      }
      refuseUnfinished(
        app,
        WORDS_JOB,
        (id) =>
          `The model is already reading your words (job ${id}). Wait for it to finish, or cancel it.`,
      );
      const request = {
        vibeId: vibe.id,
        sessionId: null,
        operator: OPERATOR.words,
        messages,
        fields: asked,
      };
      return app.jobs.add(WORDS_JOB, wordsJob(app, request));
    },
  },
];

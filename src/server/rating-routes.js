// The rating routes (decision 0027): thumbs, more or less like this on a macro, A/B pairs and
// their ratings, and keep as sketch. Each names the render the owner heard, keeps it as rated
// audio with `captureRatedAudio`, and stores the heard identity beside the rating (0021). A
// candidate holds one live thumbs and one live direction per macro, and the remove routes take
// feedback or an A/B rating back by marking it removed (0031).
/** @import { MacroName } from "../engine/macro-table.js" */
/** @import { FeedbackKindFields, HeardExcerpt, RatingSide } from "./rating-store.js" */
/** @import { Render } from "./render-store.js" */
/** @import { App, Route } from "./routing.js" */
/** @import { Session } from "./session-store.js" */
import { AB_ORDER_SEEDS, abOrder } from "../domain/ab-order.js";
import { macroWindow } from "../domain/macro-window.js";
import { MACROS } from "../engine/genome-schema.js";
import { requireGenome } from "../engine/validate-genome.js";
import { captureRatedAudio } from "./capture-rated-audio.js";
import { getCandidate, getGenome } from "./generation-store.js";
import { PRODUCER } from "./producer.js";
import {
  addRating,
  addSketch,
  FEEDBACK_KIND,
  getFeedback,
  getRating,
  MACRO_DIRECTIONS,
  OUTCOMES,
  SKETCH_FIELD,
  setFeedback,
  THUMBS,
  undoFeedback,
  undoRating,
} from "./rating-store.js";
import { getRender } from "./render-store.js";
import {
  fields,
  finite,
  idParam,
  integer,
  MAX_CHARS,
  oneOf,
  rowId,
  tagList,
  text,
} from "./request-fields.js";
import { HttpError } from "./routing.js";
import { requireOpenSession } from "./session-routes.js";
import { getVibe } from "./vibe-store.js";

const MACRO_NAMES = Object.freeze(Object.keys(MACROS));
/** The longest a rating may say it took: a day, so a page left open overnight still counts. */
const MAX_TIME_TAKEN_MS = 24 * 60 * 60 * 1000;

/**
 * @param {Record<string, unknown>} body
 * @param {string} key
 */
const playedFraction = (body, key) => finite(body, key, { min: 0, max: 1 });
/** @param {Record<string, unknown>} body */
const timeTaken = (body) => finite(body, "timeTakenMs", { min: 0, max: MAX_TIME_TAKEN_MS });

/**
 * The render a body names as heard, checked to be of a genome of the session's vibe and made by
 * this server's producer, with its genome.
 * @param {App} app
 * @param {Session} session
 * @param {Record<string, unknown>} body
 * @param {string} key
 */
function heardRender(app, session, body, key) {
  const id = rowId(body, key);
  const render = getRender(app.store, id);
  if (!render) throw new HttpError(400, `${key} names render ${id}, and there is no render ${id}`);
  const genome = getGenome(app.store, render.genomeId);
  if (genome?.vibeId !== session.vibeId) {
    throw new HttpError(400, `render ${id} is not of a genome of vibe ${session.vibeId}`);
  }
  if (render.producer !== PRODUCER) {
    throw new HttpError(
      409,
      `render ${id} was made by an earlier version of the server; render the excerpt again`,
    );
  }
  return { render, genome: genome.genome };
}

/**
 * Keeps the render as rated audio, and returns the heard identity a rating stores beside it.
 * Called once every field has been checked, so a refused rating keeps nothing.
 * @param {App} app
 * @param {number} renderId
 * @returns {Promise<HeardExcerpt & { ratedAudioId: number }>}
 */
async function keepHeard(app, renderId) {
  const rated = await captureRatedAudio(app.store, app.paths, renderId);
  const { genomeId, seed, offset, duration, engineVersion } = rated;
  return { genomeId, seed, offset, duration, engineVersion, ratedAudioId: rated.id };
}

/**
 * The id of the revision the session's vibe is at now, which a rating is made under.
 * @param {App} app
 * @param {Session} session
 */
function currentRevisionId(app, session) {
  const vibe = getVibe(app.store, session.vibeId);
  if (!vibe) throw new Error(`session ${session.id} names vibe ${session.vibeId}, which is gone`);
  return vibe.revision.id;
}

/**
 * @param {HeardExcerpt & { ratedAudioId: number }} heard
 * @param {number} fraction
 * @returns {RatingSide}
 */
const side = (heard, fraction) => ({
  ...heard,
  playedFraction: fraction,
  rank: null,
  score: null,
  modelVersion: null,
  wildcard: null,
});

/** What every feedback body holds, beside its kind's own fields. */
const FEEDBACK_FIELDS = Object.freeze(["renderId", "direction", "playedFraction", "timeTakenMs"]);

/**
 * A route that stores one kind of feedback. `read` checks the kind's own fields and returns the
 * row's columns for them; every field is checked before the heard excerpt is kept.
 * @param {string} path
 * @param {readonly string[]} kindFields
 * @param {(given: Record<string, unknown>, render: Render, genome: unknown) => FeedbackKindFields} read
 * @returns {Route}
 */
function feedbackRoute(path, kindFields, read) {
  return {
    method: "POST",
    path,
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), [...FEEDBACK_FIELDS, ...kindFields]);
      const fraction = playedFraction(given, "playedFraction");
      const timeTakenMs = timeTaken(given);
      const { render, genome } = heardRender(app, session, given, "renderId");
      const kind = read(given, render, genome);
      const heard = await keepHeard(app, render.id);
      return setFeedback(app.store, {
        sessionId: session.id,
        vibeRevisionId: currentRevisionId(app, session),
        ...heard,
        playedFraction: fraction,
        timeTakenMs,
        ...kind,
      });
    },
  };
}

/** @type {Route[]} */
export const RATING_ROUTES = [
  feedbackRoute("/api/sessions/:sessionId/thumbs", ["note"], (given) => ({
    kind: FEEDBACK_KIND.thumbs,
    direction: oneOf(given, "direction", THUMBS),
    note:
      given.note === undefined || given.note === null ? null : text(given, "note", MAX_CHARS.note),
    macro: null,
    macroValue: null,
  })),
  feedbackRoute("/api/sessions/:sessionId/macro-feedback", ["macro"], (given, render, genome) => {
    const macro = /** @type {MacroName} */ (oneOf(given, "macro", MACRO_NAMES));
    const normalized = requireGenome(genome, `genome ${render.genomeId}`);
    return {
      kind: FEEDBACK_KIND.macro,
      direction: oneOf(given, "direction", MACRO_DIRECTIONS),
      note: null,
      macro,
      macroValue: macroWindow(normalized, macro, render.offset, render.duration),
    };
  }),
  {
    method: "POST",
    path: "/api/sessions/:sessionId/ab-pairs",
    handle: async ({ app, params, body }) => {
      requireOpenSession(app, params);
      const given = fields(await body(), ["a", "b"]);
      const a = rowId(given, "a");
      const b = rowId(given, "b");
      if (a === b) throw new HttpError(400, `a and b are both render ${a}; a pair needs two`);
      const orderSeed = Math.floor(app.random() * AB_ORDER_SEEDS);
      return { a, b, orderSeed, leftSide: abOrder(orderSeed) };
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/ab-ratings",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), [
        "a",
        "b",
        "orderSeed",
        "outcome",
        "aPlayedFraction",
        "bPlayedFraction",
        "timeTakenMs",
      ]);
      if (given.a === given.b) {
        throw new HttpError(400, `a and b are both render ${given.a}; a pair needs two`);
      }
      const orderSeed = integer(given, "orderSeed", { min: 0, max: AB_ORDER_SEEDS - 1 });
      const outcome = oneOf(given, "outcome", OUTCOMES);
      const aFraction = playedFraction(given, "aPlayedFraction");
      const bFraction = playedFraction(given, "bPlayedFraction");
      const timeTakenMs = timeTaken(given);
      const a = heardRender(app, session, given, "a").render;
      const b = heardRender(app, session, given, "b").render;
      return addRating(app.store, {
        sessionId: session.id,
        vibeRevisionId: currentRevisionId(app, session),
        a: side(await keepHeard(app, a.id), aFraction),
        b: side(await keepHeard(app, b.id), bFraction),
        leftSide: abOrder(orderSeed),
        orderSeed,
        outcome,
        timeTakenMs,
      });
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/sketches",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      const given = fields(await body(), [...Object.values(SKETCH_FIELD), "renderId"]);
      const candidateId = rowId(given, SKETCH_FIELD.candidateId);
      const notes = text(given, SKETCH_FIELD.notes, MAX_CHARS.note, { allowEmpty: true });
      const tags = tagList(given, SKETCH_FIELD.tags);
      const candidate = getCandidate(app.store, candidateId);
      if (!candidate) throw new HttpError(400, `there is no candidate ${candidateId}`);
      const { render } = heardRender(app, session, given, "renderId");
      if (render.genomeId !== candidate.genomeId || render.seed !== candidate.seed) {
        throw new HttpError(400, `render ${render.id} is not candidate ${candidateId}'s excerpt`);
      }
      // The sketch row names the candidate only, and the rated-audio row keeps what was heard.
      await keepHeard(app, render.id);
      return addSketch(app.store, { candidateId, notes, tags });
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/feedback/:feedbackId/remove",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      fields(await body(), []);
      const id = idParam(params, "feedbackId");
      if (getFeedback(app.store, id)?.sessionId !== session.id) {
        throw new HttpError(404, `session ${session.id} has no feedback ${id}`);
      }
      return undoFeedback(app.store, id);
    },
  },
  {
    method: "POST",
    path: "/api/sessions/:sessionId/ab-ratings/:ratingId/remove",
    handle: async ({ app, params, body }) => {
      const session = requireOpenSession(app, params);
      fields(await body(), []);
      const id = idParam(params, "ratingId");
      if (getRating(app.store, id)?.sessionId !== session.id) {
        throw new HttpError(404, `session ${session.id} has no A/B rating ${id}`);
      }
      return undoRating(app.store, id);
    },
  },
];

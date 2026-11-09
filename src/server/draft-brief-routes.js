// The routes that draft a brief from the owner's words (decision 0074), as an owner-started job,
// one at a time: one for a new brief, and one for reworking a saved brief, whose requests are
// stored with its current revision. Each takes the form as the page holds it, or null, and
// returns the job, whose result is the draft for the page to fill its form with.
/** @import { BriefDraft } from "../domain/draft-brief-prompt.js" */
/** @import { App, Route } from "./routing.js" */
import { buildDraftBriefPrompt } from "../domain/draft-brief-prompt.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { DRAFT_LIMITS, draftBriefJob } from "./draft-brief.js";
import { fields, MAX_CHARS, text } from "./request-fields.js";
import { HttpError, refuseUnfinished } from "./routing.js";
import { readDraft, requireVibe } from "./vibe-routes.js";

const DRAFT_JOB = JOB_KIND.draftBrief;

/** The share of the context budget the first prompt may take; the rest is the repair's (0024). */
export const FIRST_PROMPT_SHARE = 0.5;

/**
 * Checks the body, builds the first prompt and adds the job.
 * @param {App} app
 * @param {number | null} vibeId the saved brief's; null for a new one
 * @param {unknown} body `{ words, current }`
 */
function startDraft(app, vibeId, body) {
  const given = fields(body, ["words", "current"]);
  const words = text(given, "words", MAX_CHARS.draftWords);
  const current =
    given.current === null
      ? null
      : /** @type {BriefDraft} */ (readDraft(given.current, { allowEmpty: true }));
  let messages;
  try {
    messages = buildDraftBriefPrompt(
      { words, current, limits: DRAFT_LIMITS },
      Math.floor(app.config.queue.contextBudgetTokens * FIRST_PROMPT_SHARE),
    );
  } catch (error) {
    throw new HttpError(400, /** @type {Error} */ (error).message);
  }
  refuseUnfinished(
    app,
    DRAFT_JOB,
    (id) =>
      `The model is already writing a brief (job ${id}). Wait for it to finish, or cancel it.`,
  );
  return app.jobs.add(DRAFT_JOB, draftBriefJob(app, { vibeId, messages }));
}

/** @type {Route[]} */
export const DRAFT_BRIEF_ROUTES = [
  {
    method: "POST",
    path: "/api/brief-drafts",
    handle: async ({ app, body }) => startDraft(app, null, await body()),
  },
  {
    method: "POST",
    path: "/api/vibes/:vibeId/drafts",
    handle: async ({ app, params, body }) =>
      startDraft(app, requireVibe(app.store, params).id, await body()),
  },
];

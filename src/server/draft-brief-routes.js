// The routes that draft a brief from the owner's words (decision 0074), as an owner-started job,
// one at a time: one for a new brief, and one for reworking a saved brief, whose requests are
// stored with its current revision. Each takes the form as the page holds it, or null, and
// returns the job, whose result is the draft for the page to fill its form with.
/** @import { BriefDraft } from "../domain/draft-brief-prompt.js" */
/** @import { App, Route } from "./routing.js" */
import { buildDraftBriefPrompt, buildSuggestBriefPrompt } from "../domain/draft-brief-prompt.js";
import { JOB_KIND } from "../domain/job-kind.js";
import { DRAFT_LIMITS, draftBriefJob } from "./draft-brief.js";
import { fields, MAX_CHARS, text } from "./request-fields.js";
import { HttpError, refuseUnfinished } from "./routing.js";
import { readDraft, requireVibe } from "./vibe-routes.js";
import { listVibes } from "./vibe-store.js";

const DRAFT_JOB = JOB_KIND.draftBrief;

/** The share of the context budget the first prompt may take; the rest is the repair's (0024). */
export const FIRST_PROMPT_SHARE = 0.5;

/**
 * The first prompt, built within its share of the context budget, a 400 when it can't be; then a
 * 409 when another brief draft is unfinished.
 * @template T
 * @param {App} app
 * @param {(budgetTokens: number) => T} build throws when the prompt is over the budget
 * @returns {T}
 */
function firstPrompt(app, build) {
  let built;
  try {
    built = build(Math.floor(app.config.queue.contextBudgetTokens * FIRST_PROMPT_SHARE));
  } catch (error) {
    throw new HttpError(400, /** @type {Error} */ (error).message);
  }
  refuseUnfinished(
    app,
    DRAFT_JOB,
    (id) =>
      `The model is already writing a brief (job ${id}). Wait for it to finish, or cancel it.`,
  );
  return built;
}

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
  const messages = firstPrompt(app, (budget) =>
    buildDraftBriefPrompt({ words, current, limits: DRAFT_LIMITS }, budget),
  );
  return app.jobs.add(DRAFT_JOB, draftBriefJob(app, { vibeId, messages }));
}

/**
 * Suggests a new brief from the owner's briefs and words (decision 0093): the same job as a new
 * brief's draft, its prompt quoting the briefs, and its result saying how many it read.
 * @param {App} app
 * @param {unknown} body `{ words }`, "" for none
 */
function startSuggestion(app, body) {
  const given = fields(body, ["words"]);
  const words = text(given, "words", MAX_CHARS.draftWords, { allowEmpty: true }).trim();
  const others = listVibes(app.store)
    .filter((vibe) => vibe.removedAt === null)
    .sort((a, b) => b.revision.createdAt - a.revision.createdAt)
    .map(({ revision }) => revision);
  const { messages, read } = firstPrompt(app, (budget) =>
    buildSuggestBriefPrompt({ words, others, limits: DRAFT_LIMITS }, budget),
  );
  const draft = draftBriefJob(app, { vibeId: null, messages });
  return app.jobs.add(DRAFT_JOB, async (job) => ({
    ...(await draft(job)),
    briefsRead: read,
    briefsTotal: others.length,
  }));
}

/** @type {Route[]} */
export const DRAFT_BRIEF_ROUTES = [
  {
    method: "POST",
    path: "/api/brief-suggestions",
    handle: async ({ app, body }) => startSuggestion(app, await body()),
  },
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

// The vibe routes (decision 0027): create, list, read, edit as a new revision, notes, the vibe's
// ratings, and starting a session. An edit never changes a row: it appends a revision (0021).
/** @import { Route } from "./routing.js" */
/** @import { Store } from "./store.js" */
/** @import { Vibe, VibeDraft } from "./vibe-store.js" */
import { validateConstraints } from "../domain/validate-constraints.js";

import { isObject } from "../engine/is-object.js";
import { show } from "../engine/validation-error.js";
import { listFeedback, listRatings, listSketches } from "./rating-store.js";
import { fields, idParam, text } from "./request-fields.js";
import { HttpError } from "./routing.js";
import { getSession, listSessions, startSession } from "./session-store.js";
import {
  addNote,
  createVibe,
  getVibe,
  listNotes,
  listRevisions,
  listVibes,
  reviseVibe,
  VIBE_DRAFT_FIELD,
} from "./vibe-store.js";

/**
 * A vibe's whole draft from a body, its constraints checked by 2b's validator.
 * @param {unknown} body
 * @returns {VibeDraft}
 */
function readDraft(body) {
  const given = fields(body, Object.values(VIBE_DRAFT_FIELD));
  const checked = validateConstraints(given.constraints);
  if (!checked.ok) {
    const list = checked.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new HttpError(400, `the constraints are invalid: ${list}`);
  }
  // Soft targets are kept as given until phase 3 measures features against them.
  const { softTargets } = given;
  if (!isObject(softTargets)) {
    throw new HttpError(
      400,
      `softTargets must be a JSON object, {} for none, got ${show(softTargets)}`,
    );
  }
  return {
    name: text(given, VIBE_DRAFT_FIELD.name),
    brief: text(given, VIBE_DRAFT_FIELD.brief),
    constraints: checked.constraints,
    softTargets,
  };
}

/**
 * The vibe named by the path, or a 404 when there is none or it was removed.
 * @param {Store} store
 * @param {Record<string, string>} params
 * @returns {Vibe}
 */
function requireVibe(store, params) {
  const id = idParam(params, "vibeId");
  const vibe = getVibe(store, id);
  if (!vibe || vibe.removedAt !== null) throw new HttpError(404, `there is no vibe ${id}`);
  return vibe;
}

/** @type {Route[]} */
export const VIBE_ROUTES = [
  {
    method: "GET",
    path: "/api/vibes",
    handle: ({ app }) => ({ vibes: listVibes(app.store) }),
  },
  {
    method: "POST",
    path: "/api/vibes",
    handle: async ({ app, body }) => createVibe(app.store, readDraft(await body())),
  },
  {
    method: "GET",
    path: "/api/vibes/:vibeId",
    handle: ({ app, params }) => {
      const vibe = requireVibe(app.store, params);
      return {
        ...vibe,
        notes: listNotes(app.store, vibe.id),
        sessions: listSessions(app.store, vibe.id),
      };
    },
  },
  {
    method: "GET",
    path: "/api/vibes/:vibeId/revisions",
    handle: ({ app, params }) => ({
      revisions: listRevisions(app.store, requireVibe(app.store, params).id),
    }),
  },
  {
    method: "POST",
    path: "/api/vibes/:vibeId/revisions",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      const revision = reviseVibe(app.store, vibe.id, readDraft(await body()));
      return { ...vibe, revision };
    },
  },
  {
    method: "POST",
    path: "/api/vibes/:vibeId/notes",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      const given = fields(await body(), ["text"]);
      return addNote(app.store, { vibeId: vibe.id, text: text(given, "text") });
    },
  },
  {
    method: "GET",
    path: "/api/vibes/:vibeId/ratings",
    handle: ({ app, params }) => {
      const { id } = requireVibe(app.store, params);
      return {
        ratings: listRatings(app.store, id),
        feedback: listFeedback(app.store, id),
        sketches: listSketches(app.store, id),
      };
    },
  },
  {
    method: "POST",
    path: "/api/vibes/:vibeId/sessions",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      fields(await body(), []);
      return getSession(app.store, startSession(app.store, vibe.id).id);
    },
  },
];

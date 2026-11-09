// What the owner edits on the brief page: a vibe's name, brief, constraints and soft targets
// (decision 0021). Every edit appends a revision with these fields.

/**
 * @typedef {object} VibeDraft
 * @property {string} name
 * @property {string} brief
 * @property {unknown} constraints 2b's constraint set, checked by the caller
 * @property {unknown} softTargets
 */

/** The fields of a `VibeDraft`, by name; every one is required. */
export const VIBE_DRAFT_FIELD = Object.freeze({
  name: "name",
  brief: "brief",
  constraints: "constraints",
  softTargets: "softTargets",
});

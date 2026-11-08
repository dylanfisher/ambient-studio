// What the owner can attach to a brief beside its revisions (decisions 0052, 0056). The server
// stores each in `vibe_attachments` under its kind, and the brief page reads the limits.

/** The kinds stored today; migration 0010 also admits 5h's `axis`. */
export const ATTACHMENT_KIND = Object.freeze({
  /** A reference region, described in the first prompt. */
  reference: "reference",
  /** A CLAP direction between two typed ends, which a session card's slider steers along. */
  direction: "direction",
});

/** The most regions one brief holds at a time. */
export const MAX_REFERENCES = 2;

/** The most directions one brief holds at a time: each is a slider on every card. */
export const MAX_DIRECTIONS = 4;

/** A direction's two ends, its `details` keys and its route's body fields, near end first. */
export const DIRECTION_ENDS = Object.freeze(/** @type {const} */ (["near", "far"]));

/**
 * The near end of a direction typed with none, when the brief's description is empty: a text
 * like the brief, so the direction's two ends are both text embeddings (decision 0056).
 */
export const NEUTRAL_NEAR_TEXT = "ambient music";

/** The most characters one end of a direction may hold, as dry or underwater. */
export const DIRECTION_END_CHARS = 100;

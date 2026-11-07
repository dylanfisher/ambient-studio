// The values a rating takes, which the server stores and checks and the session page sends
// (decision 0027).

/** What an A/B rating comes to: a side won, a tie, or the owner skipped the pair. */
export const OUTCOMES = /** @type {const} */ (["a", "b", "tie", "skip"]);
/** The feedback kinds: thumbs, and more or less like this on a macro. */
export const FEEDBACK_KIND = /** @type {const} */ ({ thumbs: "thumbs", macro: "macro" });
/** The directions thumbs take, and the directions of more or less like this on a macro. */
export const THUMBS = /** @type {const} */ (["up", "down"]);
export const MACRO_DIRECTIONS = /** @type {const} */ (["more", "less"]);

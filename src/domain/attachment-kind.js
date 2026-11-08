// What the owner can attach to a brief beside its revisions (decision 0052). The server stores
// each in `vibe_attachments` under its kind, and the brief page reads the limits.

/** The kinds stored today; migration 0010 also admits 5g's `direction` and 5h's `axis`. */
export const ATTACHMENT_KIND = Object.freeze({
  /** A reference region, described in the first prompt. */
  reference: "reference",
});

/** The most regions one brief holds at a time. */
export const MAX_REFERENCES = 2;

// What the owner can attach to a brief beside its revisions (decisions 0052, 0056, 0057). The
// server stores each in `vibe_attachments` under its kind, and the brief page reads the limits.

/** The kinds migration 0010 admits. */
export const ATTACHMENT_KIND = Object.freeze({
  /** A reference region, described in the first prompt. */
  reference: "reference",
  /** A CLAP direction between two typed ends, which a session card's slider steers along. */
  direction: "direction",
  /** One axis of the brief's map of candidates (0057). */
  axis: "axis",
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

/** What an axis of the map reads of each excerpt, its `details.source` (decision 0057). */
export const AXIS_SOURCE = Object.freeze({
  /** A feature a range may name, measured on the excerpt; `details.name` names it. */
  feature: "feature",
  /** A macro's mean over the excerpt's window; `details.name` names it. */
  macro: "macro",
  /** The excerpt's projection on a direction; `details.directionId` names its attachment. */
  direction: "direction",
  /** The excerpt's similarity to a region; the row's `regionId` names it. */
  region: "region",
});

/** The keys of an axis's `details` every source has, in the order they are written. */
export const AXIS_DETAILS = Object.freeze({ source: "source", ends: "ends", bins: "bins" });

/**
 * Each axis source's `details` keys besides `AXIS_DETAILS`, between `source` and `ends`.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const AXIS_KEYS = Object.freeze({
  [AXIS_SOURCE.feature]: Object.freeze(["name"]),
  [AXIS_SOURCE.macro]: Object.freeze(["name"]),
  [AXIS_SOURCE.direction]: Object.freeze(["directionId"]),
  [AXIS_SOURCE.region]: Object.freeze([]),
});

/** The body field naming an axis's region, the attachment row's own column. */
export const REGION_KEY = "regionId";

/** The fields one axis in the axes route's body names its source by. */
export const AXIS_BODY_KEYS = Object.freeze([
  AXIS_DETAILS.source,
  ...new Set(Object.values(AXIS_KEYS).flat()),
  REGION_KEY,
]);

/**
 * Bins a side, by how many axes the map has: 8 by 8 for two, 6 by 6 by 6 for three, so a map
 * is at most `MAX_ARCHIVE_CELLS`.
 * @type {Readonly<Record<number, number>>}
 */
export const AXIS_BINS = Object.freeze({ 2: 8, 3: 6 });

/** The most cells one map holds. */
export const MAX_ARCHIVE_CELLS = 256;

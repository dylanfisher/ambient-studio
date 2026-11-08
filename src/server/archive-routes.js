// A brief's map (decision 0057): choosing its two or three axes, which replaces the live ones
// and makes no revision, and reading the map, rebuilt from the stored candidates on each read.
/** @import { Route } from "./routing.js" */
/** @import { Store } from "./store.js" */
import {
  ATTACHMENT_KIND,
  AXIS_BINS,
  AXIS_BODY_KEYS,
  AXIS_DETAILS,
  AXIS_KEYS,
  AXIS_SOURCE,
  REGION_KEY,
} from "../domain/attachment-kind.js";
import { RANGE_ENDS } from "../domain/target-schema.js";
import { isObject } from "../engine/is-object.js";
import { addAttachment, DETACHED, getAttachment, listAttachments } from "./attachment-store.js";
import { fields, oneOf, rowId } from "./request-fields.js";
import { HttpError } from "./routing.js";
import { markRemoved, TABLE, transaction } from "./store.js";
import { readArchive } from "./vibe-archive.js";
import { requireVibe } from "./vibe-routes.js";

const AXIS = ATTACHMENT_KIND.axis;
const [LOW, HIGH] = RANGE_ENDS;
/** The fields one axis in the body may hold. */
const AXIS_FIELDS = [...AXIS_BODY_KEYS, LOW, HIGH];

/**
 * One axis of the body as the row's draft: its source and what it names, checked against the
 * vibe's live directions and attached regions, its ends or null, and `bins`.
 * @param {Store} store
 * @param {number} vibeId
 * @param {unknown} entry
 * @param {string} key its place in the body, for the 400
 * @param {number} bins
 */
function axisDraft(store, vibeId, entry, key, bins) {
  if (!isObject(entry)) throw new HttpError(400, `${key} must be an object`);
  const given = fields(entry, AXIS_FIELDS);
  const source = oneOf(given, AXIS_DETAILS.source, Object.values(AXIS_SOURCE));
  /** @param {string} end the default's when absent or null */
  const end = (end) => {
    const value = given[end] ?? null;
    if (value !== null && !Number.isFinite(value)) {
      throw new HttpError(400, `${key}.${end} must be a number, or null for the default`);
    }
    return /** @type {number | null} */ (value);
  };
  const ends = [end(LOW), end(HIGH)];
  /** @type {number | null} */
  let regionId = null;
  /** @type {Record<string, unknown>} */
  let names = {};
  const [nameKey] = /** @type {readonly string[]} */ (AXIS_KEYS[AXIS_SOURCE.feature]);
  const [directionKey] = /** @type {readonly string[]} */ (AXIS_KEYS[AXIS_SOURCE.direction]);
  if (source === AXIS_SOURCE.feature || source === AXIS_SOURCE.macro) {
    names = { [String(nameKey)]: given[String(nameKey)] };
  } else if (source === AXIS_SOURCE.direction) {
    const directionId = rowId(given, String(directionKey));
    const row = getAttachment(store, directionId);
    if (
      row?.vibeId !== vibeId ||
      row.kind !== ATTACHMENT_KIND.direction ||
      row.removedAt !== null
    ) {
      throw new HttpError(400, `${key}: direction ${directionId} isn't on this brief`);
    }
    names = { [String(directionKey)]: directionId };
  } else {
    regionId = rowId(given, REGION_KEY);
    const attached = listAttachments(store, vibeId, ATTACHMENT_KIND.reference);
    if (!attached.some((row) => row.regionId === regionId)) {
      throw new HttpError(
        400,
        `${key}: region ${regionId} isn't attached to this brief; attach it under “Regions for the model to aim at” first`,
      );
    }
  }
  /** @type {Record<string, unknown>} */
  const details = { source, ...names, ends, bins };
  return { vibeId, kind: AXIS, regionId, details };
}

/** @type {Route[]} */
export const ARCHIVE_ROUTES = [
  {
    method: "GET",
    path: "/api/vibes/:vibeId/archive",
    handle: ({ app, params }) => {
      const vibe = requireVibe(app.store, params);
      return readArchive(app, vibe.id, new AbortController().signal);
    },
  },
  {
    method: "POST",
    path: "/api/vibes/:vibeId/axes",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      const { axes } = fields(await body(), ["axes"]);
      const bins = Array.isArray(axes) ? AXIS_BINS[axes.length] : undefined;
      if (!Array.isArray(axes) || bins === undefined) {
        throw new HttpError(400, "axes must be a list of two or three axes");
      }
      const drafts = axes.map((entry, i) =>
        axisDraft(app.store, vibe.id, entry, `axes[${i}]`, bins),
      );
      const keys = drafts.map(({ regionId, details }) =>
        JSON.stringify([details.source, details.name, details.directionId, regionId]),
      );
      if (new Set(keys).size !== keys.length) {
        throw new HttpError(400, "each axis must read something different");
      }
      try {
        transaction(app.store, () => {
          for (const { id } of listAttachments(app.store, vibe.id, AXIS)) {
            markRemoved(app.store, TABLE.vibeAttachments, id, DETACHED.axesReplaced);
          }
          for (const draft of drafts) addAttachment(app.store, draft);
        });
      } catch (error) {
        // The store's check is the one statement of what an axis may be.
        throw new HttpError(400, /** @type {Error} */ (error).message);
      }
      return { axes: listAttachments(app.store, vibe.id, AXIS) };
    },
  },
];

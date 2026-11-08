// A brief's attachments (decision 0052): list the regions attached to it, attach an analyzed
// region, and detach one. None of them makes a new revision; each generation logs the
// attachments its prompt held.
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { Route } from "./routing.js" */
/** @import { Store } from "./store.js" */
import { ATTACHMENT_KIND, MAX_REFERENCES } from "../domain/attachment-kind.js";
import {
  addAttachment,
  detachAttachment,
  getAttachment,
  listAttachments,
} from "./attachment-store.js";
import { PRODUCER } from "./producer.js";
import { getReferenceFile, getRegion } from "./reference-store.js";
import { findRegionAnalysis } from "./region-analysis-store.js";
import { vibeLoudness } from "./render-excerpt.js";
import { fields, idParam, oneOf, rowId } from "./request-fields.js";
import { HttpError } from "./routing.js";
import { requireVibe } from "./vibe-routes.js";

const REFERENCE = ATTACHMENT_KIND.reference;

/**
 * The loudness target the vibe's regions are read at: its current revision's. Stored revisions
 * passed validateConstraints, so the cast holds.
 * @param {{ revision: { constraints: unknown } }} vibe
 */
const targetOf = (vibe) => vibeLoudness(/** @type {Constraints} */ (vibe.revision.constraints));

/**
 * @param {{ id: number, label: string }} region
 */
const named = ({ id, label }) => `region ${id} (${JSON.stringify(label)})`;

/**
 * The region the body names, live and analyzed at `target` under this server's producer, or a
 * 400 naming it.
 * @param {Store} store
 * @param {number} regionId
 * @param {number} target
 */
function attachableRegion(store, regionId, target) {
  const region = getRegion(store, regionId);
  if (!region) throw new HttpError(400, `there is no region ${regionId}`);
  if (region.removedAt !== null) {
    throw new HttpError(400, `${named(region)} was ${region.removedReason}`);
  }
  if (!findRegionAnalysis(store, { regionId, target, producer: PRODUCER })) {
    throw new HttpError(
      400,
      `${named(region)} isn't analyzed at this brief's loudness, ${target} LUFS; analyze it first`,
    );
  }
  return region;
}

/** @type {Route[]} */
export const ATTACHMENT_ROUTES = [
  {
    method: "GET",
    path: "/api/vibes/:vibeId/attachments",
    handle: ({ app, params }) => {
      const vibe = requireVibe(app.store, params);
      const target = targetOf(vibe);
      const references = listAttachments(app.store, vibe.id, REFERENCE).map((attachment) => {
        const regionId = /** @type {number} */ (attachment.regionId);
        const region = getRegion(app.store, regionId);
        if (!region)
          throw new Error(`attachment ${attachment.id} names region ${regionId}, which has no row`);
        const file = getReferenceFile(app.store, region.referenceFileId);
        const analysis = findRegionAnalysis(app.store, { regionId, target, producer: PRODUCER });
        return {
          id: attachment.id,
          regionId,
          label: region.label,
          note: region.note,
          fileName: file?.fileName ?? null,
          startSeconds: region.startSeconds,
          endSeconds: region.endSeconds,
          analyzed: analysis !== undefined,
          embedded: (analysis?.embedding ?? null) !== null,
          createdAt: attachment.createdAt,
        };
      });
      return { target, references };
    },
  },
  {
    method: "POST",
    path: "/api/vibes/:vibeId/attachments",
    handle: async ({ app, params, body }) => {
      const vibe = requireVibe(app.store, params);
      const given = fields(await body(), ["kind", "regionId"]);
      oneOf(given, "kind", [REFERENCE]);
      const region = attachableRegion(app.store, rowId(given, "regionId"), targetOf(vibe));
      const live = listAttachments(app.store, vibe.id, REFERENCE);
      if (live.some((row) => row.regionId === region.id)) {
        throw new HttpError(400, `${named(region)} is attached to this brief already`);
      }
      if (live.length >= MAX_REFERENCES) {
        throw new HttpError(
          400,
          `this brief holds ${live.length} regions already, the most it takes; detach one first`,
        );
      }
      const attachment = addAttachment(app.store, {
        vibeId: vibe.id,
        kind: REFERENCE,
        regionId: region.id,
        details: {},
      });
      return { attachment };
    },
  },
  {
    method: "POST",
    path: "/api/vibe-attachments/:attachmentId/detach",
    handle: async ({ app, params, body }) => {
      fields(await body(), []);
      const id = idParam(params, "attachmentId");
      const attachment = getAttachment(app.store, id);
      if (!attachment) throw new HttpError(404, `there is no attachment ${id}`);
      if (attachment.removedAt !== null) {
        throw new HttpError(
          400,
          `attachment ${id} isn't attached any more (${attachment.removedReason})`,
        );
      }
      detachAttachment(app.store, id);
      return { attachment: getAttachment(app.store, id) };
    },
  },
];

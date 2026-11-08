// The regions attached to a brief, as the brief page shows them (decision 0052): which regions
// can still be attached, and what each attached one says. No DOM and no request here.
/** @import { RegionFields } from "../domain/reference-region.js" */
import { MAX_REFERENCES } from "../domain/attachment-kind.js";

/**
 * The regions the brief can attach now: those not attached already, and none once it holds
 * `MAX_REFERENCES`.
 * @template {RegionFields & { id: number }} R
 * @param {readonly R[]} regions every live region
 * @param {readonly { regionId: number }[]} attached
 * @returns {R[]}
 */
export function attachable(regions, attached) {
  if (attached.length >= MAX_REFERENCES) return [];
  const taken = new Set(attached.map((row) => row.regionId));
  return regions.filter((region) => !taken.has(region.id));
}

/**
 * What the model is told about one attached region, or why asking for candidates would stop.
 * @param {{ analyzed: boolean, embedded: boolean }} attached
 * @param {number} target the brief's loudness, LUFS
 * @returns {string}
 */
export function attachedStatus({ analyzed, embedded }, target) {
  if (!analyzed) {
    return `Not measured at this brief's loudness, ${target} LUFS, so asking for candidates stops with an error. Press Measure, or detach it.`;
  }
  if (embedded) return "The model is told its measurements and the words nearest its sound.";
  return "The model is told its measurements. Its sound isn't analyzed, so no words go with them.";
}

/**
 * The line under the attached regions.
 * @param {number} count how many the brief holds
 * @returns {string}
 */
export function attachHelp(count) {
  const limit =
    count >= MAX_REFERENCES
      ? `This brief holds ${MAX_REFERENCES}, the most it takes. Detach one to attach another.`
      : `A brief takes up to ${MAX_REFERENCES}.`;
  return `${limit} Attaching or detaching takes effect on the next request and doesn't save a new version of the brief.`;
}

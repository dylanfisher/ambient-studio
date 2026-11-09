// A proposed arrangement stretched or squeezed to play the length the owner asked for (decision
// 0067's amendment): every section's seconds scaled by one factor, transitions kept, and each
// lane's times scaled with the track, so the model's choice of material, order and proportions
// stays while the overlap arithmetic it keeps missing is done here.
/** @import { Arrangement } from "./arrangement-schema.js" */
/** @import { LanePoint } from "./lane-schema.js" */
import { arrangementLength } from "./arrangement-length.js";

/** The most a proposal's sections are scaled by, either way, before it goes back as a finding. */
const LENGTH_FIT_MOST = 0.25;

/** Lane times are rounded to this many seconds once scaled. */
const LANE_STEP = 0.1;

/**
 * @param {Arrangement} arrangement a valid one
 * @param {number} length seconds the track should play
 * @returns {Arrangement | null} one that plays exactly `length`, sections in whole seconds, or
 *   null when its sections would scale by more than `LENGTH_FIT_MOST`; the caller validates it
 */
export function fitArrangementLength(arrangement, length) {
  const { sections, transitions, lanes } = arrangement;
  const overlap = transitions.reduce((sum, { seconds }) => sum + seconds, 0);
  const total = sections.reduce((sum, { seconds }) => sum + seconds, 0);
  const factor = (length + overlap) / total;
  if (!(Math.abs(factor - 1) <= LENGTH_FIT_MOST)) return null;
  const scaled = sections.map((section) => ({
    ...section,
    seconds: Math.round(section.seconds * factor),
  }));
  const last = scaled.at(-1);
  if (!last) return null;
  last.seconds += length - arrangementLength({ ...arrangement, sections: scaled });
  const stretch = length / arrangementLength(arrangement);
  return {
    ...arrangement,
    sections: scaled,
    lanes: lanes.map((lane) => ({
      ...lane,
      points: lane.points.map(
        ([time, ...rest]) =>
          /** @type {LanePoint} */ ([
            Math.round((time * stretch) / LANE_STEP) * LANE_STEP,
            ...rest,
          ]),
      ),
    })),
  };
}

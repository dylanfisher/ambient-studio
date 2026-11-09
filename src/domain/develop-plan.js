// What Develop every section does with each section of a version (decision 0082): develops
// it with TD.3's request (0079), or keeps it as it plays. The server's job and the timeline's
// confirm read the same plan.
/** @import { Arrangement } from "./arrangement-schema.js" */
import { DEVELOP_LEAST } from "./develop-prompt.js";

/** What happens to one section. */
export const DEVELOP_PLAN = Object.freeze(
  /** @type {const} */ ({
    /** Developed in turn. */
    develop: "develop",
    /** Already developed, and the owner didn't ask to develop it again. */
    kept: "kept",
    /** A bridge (0081): written to its neighbors' ends, never developed again as a section. */
    bridge: "bridge",
    /** Under `DEVELOP_LEAST`, so no genome can last it. */
    short: "short",
  }),
);

/** @typedef {(typeof DEVELOP_PLAN)[keyof typeof DEVELOP_PLAN]} DevelopPlan */

/**
 * Each section's plan, in order.
 * @param {Arrangement} arrangement
 * @param {boolean} again whether a section already developed is developed again
 * @param {(developmentId: number) => boolean} isBridge
 * @returns {DevelopPlan[]}
 */
export const developPlan = ({ sections }, again, isBridge) =>
  sections.map(({ seconds, developmentId }) => {
    if (developmentId !== null && isBridge(developmentId)) return DEVELOP_PLAN.bridge;
    if (developmentId !== null && !again) return DEVELOP_PLAN.kept;
    return seconds < DEVELOP_LEAST ? DEVELOP_PLAN.short : DEVELOP_PLAN.develop;
  });

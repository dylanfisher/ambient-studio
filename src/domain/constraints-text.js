// A vibe's constraints as lines of the generation prompt. omlx contexts are short, so a test
// holds a set with every kind under 800 characters (decision 0020).
/** @import { Constraints } from "./constraint-schema.js" */
import { CONSTRAINT_KINDS } from "./constraint-schema.js";

/**
 * One line for each kind the set gives, in the table's order, after a header line.
 * @param {Constraints} constraints a validated set
 * @returns {string}
 */
export function constraintsText(constraints) {
  const lines = Object.entries(CONSTRAINT_KINDS).flatMap(([name, kind]) => {
    const constraint = constraints[/** @type {keyof Constraints} */ (name)];
    return constraint === undefined ? [] : [kind.text(/** @type {never} */ (constraint))];
  });
  if (lines.length === 0) return "The vibe sets no hard constraints.";
  return ["Hard constraints from the vibe; a genome that breaks one is rejected:", ...lines].join(
    "\n",
  );
}

// Every tuning the engine knows, one import line per file in ./tunings/. The engine runs unbuilt
// in the browser and can't list or read a folder, so adding a tuning file means adding its line
// here; a test fails when the folder and this list disagree (decision 0004).
/** @import { Tuning } from "./tuning.js" */
import { loadTuning } from "./tuning.js";
import tet12 from "./tunings/12-tet.js";
import edo19 from "./tunings/19-edo.js";
import bohlenPierce from "./tunings/bohlen-pierce.js";
import colundi from "./tunings/colundi.js";
import just5Limit from "./tunings/just-5-limit.js";

/** @type {Record<string, unknown>} file name without `.js` → the file's contents */
const files = {
  "12-tet": tet12,
  "19-edo": edo19,
  "bohlen-pierce": bohlenPierce,
  colundi,
  "just-5-limit": just5Limit,
};

// Loaded when the module is imported, so a malformed file fails at startup, not mid-render.
const tunings = new Map(Object.entries(files).map(([id, file]) => [id, loadTuning(id, file)]));

/** @returns {string[]} every tuning id, sorted */
export const tuningIds = () => [...tunings.keys()].sort();

/**
 * @param {string} id
 * @returns {Tuning}
 */
export function getTuning(id) {
  const tuning = tunings.get(id);
  if (!tuning) throw new Error(`unknown tuning "${id}"; known: ${tuningIds().join(", ")}`);
  return tuning;
}

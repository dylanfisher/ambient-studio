// The last taste model test's report (decision 0045): derived data, one JSON file beside the
// models it was fitted with. Running the test again rebuilds it from the ratings, so each run
// replaces it and no history is kept.
/** @import { Paths } from "../config/paths.js" */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Model files are named by a hex key, so this name can't be one of theirs. */
const FILE = "preference-test.json";

/** @param {Paths} paths */
const reportFile = (paths) => join(paths.models, FILE);

/**
 * Writes the report through a temp file, so a reader never sees half of one.
 * @param {Paths} paths
 * @param {unknown} report
 */
export async function writePreferenceTest(paths, report) {
  await mkdir(paths.models, { recursive: true });
  const temp = `${reportFile(paths)}.partial`;
  await writeFile(temp, JSON.stringify(report));
  await rename(temp, reportFile(paths));
}

/**
 * @param {Paths} paths
 * @returns {Promise<unknown>} the report, or null when no test has finished
 */
export async function readPreferenceTest(paths) {
  /** @type {string} */
  let text;
  try {
    text = await readFile(reportFile(paths), "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw error;
  }
  return JSON.parse(text);
}

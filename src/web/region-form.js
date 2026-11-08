// The References page's region form (decision 0050), with no DOM: the start and end fields take
// seconds (`75.5`) or minutes and seconds (`1:15.5`), and a drag on the peak strip fills them,
// as a shortcut for typing. The bounds are checked by the domain's rule, which the server runs
// on the same numbers.
/** @import { RegionFields } from "../domain/reference-region.js" */
import { regionProblem, regionSeconds } from "../domain/reference-region.js";

/** The form's input names, which are also its ids. */
export const REGION_INPUT = Object.freeze({
  start: "regionStart",
  end: "regionEnd",
  label: "regionLabel",
  note: "regionNote",
});

/** Times are kept to the hundredth of a second, the most a field shows. */
const PLACES = 100;

/** @param {number} seconds */
const hundredths = (seconds) => Math.round(seconds * PLACES) / PLACES;

/**
 * A typed time in seconds; null when the text is empty, NaN when it isn't a time.
 * @param {string} text
 * @returns {number | null}
 */
export function parseSeconds(text) {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const match = /^(?:(\d+):)?(\d+(?:\.\d*)?|\.\d+)$/.exec(trimmed);
  if (!match) return Number.NaN;
  const [, minutes, seconds = ""] = match;
  const within = Number(seconds);
  if (minutes === undefined) return within;
  return within < 60 ? Number(minutes) * 60 + within : Number.NaN;
}

/**
 * @param {number} seconds
 * @returns {string} such as `1:15.50`
 */
export function formatSeconds(seconds) {
  const total = Math.round(seconds * PLACES);
  const minutes = Math.floor(total / (60 * PLACES));
  const rest = (total - minutes * 60 * PLACES) / PLACES;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
}

/**
 * The form's values for a saved region, named as `readRegion` reads them.
 * @param {RegionFields} region
 * @returns {Record<string, string>}
 */
export const regionValues = ({ startSeconds, endSeconds, label, note }) => ({
  [REGION_INPUT.start]: formatSeconds(startSeconds),
  [REGION_INPUT.end]: formatSeconds(endSeconds),
  [REGION_INPUT.label]: label,
  [REGION_INPUT.note]: note,
});

/**
 * Reads the form into a region to send, or the sentence that says what is wrong.
 * @param {(name: string) => string} get an input's value, "" when empty
 * @param {number} durationSeconds the file's
 * @returns {{ ok: true, region: RegionFields } | { ok: false, message: string }}
 */
export function readRegion(get, durationSeconds) {
  const startSeconds = parseSeconds(get(REGION_INPUT.start));
  const endSeconds = parseSeconds(get(REGION_INPUT.end));
  if (startSeconds === null || Number.isNaN(startSeconds)) {
    return {
      ok: false,
      message: "Type the start as seconds (75.5) or minutes and seconds (1:15.5).",
    };
  }
  if (endSeconds === null || Number.isNaN(endSeconds)) {
    return {
      ok: false,
      message: "Type the end as seconds (75.5) or minutes and seconds (1:15.5).",
    };
  }
  const problem = regionProblem(startSeconds, endSeconds, durationSeconds);
  if (problem) return { ok: false, message: problem };
  const label = get(REGION_INPUT.label).trim();
  if (label === "") return { ok: false, message: "Give the region a label, such as “the swell”." };
  return {
    ok: true,
    region: {
      startSeconds: regionSeconds(startSeconds),
      endSeconds: regionSeconds(endSeconds),
      label,
      note: get(REGION_INPUT.note).trim(),
    },
  };
}

/**
 * The region a drag across the peak strip covers, either way, stopped at the strip's edges.
 * @param {number} fromX where the pointer went down, in pixels from the strip's left edge
 * @param {number} toX where it is now
 * @param {number} width the strip's width in pixels
 * @param {number} durationSeconds the file's
 * @returns {{ startSeconds: number, endSeconds: number }}
 */
export function dragRegion(fromX, toX, width, durationSeconds) {
  /** @param {number} x */
  const at = (x) => hundredths((Math.min(Math.max(x, 0), width) / width) * durationSeconds);
  const [a, b] = [at(fromX), at(toX)];
  return { startSeconds: Math.min(a, b), endSeconds: Math.max(a, b) };
}

/**
 * The audio route's query for a span, its bounds to the millisecond as the route reads them.
 * @param {{ startSeconds: number, endSeconds: number }} span
 */
export const spanQuery = ({ startSeconds, endSeconds }) =>
  `start=${regionSeconds(startSeconds)}&end=${regionSeconds(endSeconds)}`;

// What the search-by-ear page says of its steering (decision 0075): each variation's name, each
// searched path's, and a line for the steering in force. No DOM here, so the wording is tested.
/** @import { EarSteering, EarVariation } from "../domain/ear-settings.js" */
import { MACRO_DIRECTIONS } from "../domain/rating-values.js";
import { GENOME_KEY } from "../engine/genome-schema.js";

const [MORE, LESS] = MACRO_DIRECTIONS;

/** Each variation as the page's choice names it. */
export const VARIATION_LABEL = Object.freeze({
  subtle: "Subtle",
  medium: "Medium",
  wide: "Wide",
  wider: "Very wide",
});

/** A macro's path names it by its macro alone; any other path is shown as it is. */
const MACRO_PREFIX = `${GENOME_KEY.macros}.`;

/** @param {string} path */
export const pathName = (path) =>
  path.startsWith(MACRO_PREFIX) ? path.slice(MACRO_PREFIX.length) : path;

/**
 * @param {EarSteering} steering
 * @returns {string} such as `Wide variation, leaning toward less brightness and more space.`
 */
export function steeringText({ variation, shift }) {
  const leans = Object.entries(shift).map(
    ([path, value]) => `${value < 0 ? LESS : MORE} ${pathName(path)}`,
  );
  const variationText = `${VARIATION_LABEL[/** @type {EarVariation} */ (variation)]} variation`;
  if (leans.length === 0) return `${variationText}, with no shift.`;
  const listed =
    leans.length === 1 ? leans[0] : `${leans.slice(0, -1).join(", ")} and ${leans.at(-1)}`;
  return `${variationText}, leaning toward ${listed}.`;
}

/**
 * A slider's reading, as its line under it shows it.
 * @param {string} path
 * @param {number} value from -1 to 1
 */
export const leanText = (path, value) =>
  value === 0
    ? "Leans neither way."
    : `Leans toward ${value < 0 ? LESS : MORE} ${pathName(path)} (${Math.abs(value) * 100}%).`;

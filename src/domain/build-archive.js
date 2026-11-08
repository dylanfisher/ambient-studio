// The map of a brief's candidates (decision 0057), MAP-Elites' archive: two or three axes, each
// a descriptor of the excerpt cut into bins between two ends, and in each cell the elite, the
// best excerpt that lands there. Derived: rebuilt from the stored candidates on every read, so
// it holds nothing a candidate row doesn't.
import { AXIS_BINS, MAX_ARCHIVE_CELLS } from "./attachment-kind.js";
import { nearestRank } from "./percentiles.js";

/** The percentiles of the brief's excerpts an axis's ends default to, low end first. */
export const END_PERCENTILES = Object.freeze(/** @type {const} */ ([10, 90]));

/**
 * @typedef {object} ArchiveAxis
 * @property {number} bins
 * @property {number} low the first bin's lower edge; a value under it lands in the first bin
 * @property {number} high the last bin's upper edge, above `low`; a value over it lands in the
 *   last bin
 */

/**
 * One excerpt as the map reads it.
 * @typedef {object} ArchiveEntry
 * @property {number} candidateId
 * @property {number} createdAt
 * @property {readonly number[]} values one descriptor per axis
 * @property {number | null} score its search score under the brief's taste model; null with
 *   no model, or for an excerpt whose sound isn't analyzed
 * @property {number} misses the brief's ranges it misses
 */

/**
 * @typedef {object} ArchiveCell
 * @property {number[]} index the bin on each axis, from 0
 * @property {ArchiveEntry} elite
 * @property {number} count excerpts in the cell, the elite's included
 */

/**
 * @typedef {object} Archive
 * @property {number[]} shape bins per axis
 * @property {number} total cells
 * @property {ArchiveCell[]} cells the filled ones, by index, first axis first
 */

/**
 * The ends an axis reads between: the brief's range where it gives an end, and otherwise the
 * excerpts' 10th and 90th percentiles. Null when an end can't be had, or the two ends meet.
 * @param {readonly number[]} values the excerpts' descriptors on the axis
 * @param {readonly [number | null, number | null] | null} range the brief's, or the owner's
 *   ends; null for none
 * @returns {{ low: number, high: number } | null}
 */
export function axisEnds(values, range) {
  const sorted = [...values].sort((a, b) => a - b);
  /** @param {number | null | undefined} given @param {number} p */
  const end = (given, p) => given ?? (sorted.length === 0 ? null : nearestRank(sorted, p));
  const low = end(range?.[0], END_PERCENTILES[0]);
  const high = end(range?.[1], END_PERCENTILES[1]);
  return low === null || high === null || high <= low ? null : { low, high };
}

/**
 * The bin `value` lands in.
 * @param {number} value
 * @param {ArchiveAxis} axis
 */
const binOf = (value, { bins, low, high }) =>
  Math.min(bins - 1, Math.max(0, Math.floor(((value - low) / (high - low)) * bins)));

/**
 * Whether `a` is the better elite: the higher score where the model scored both, one it scored
 * over one it couldn't, and otherwise the fewer misses; a tie goes to the newer.
 * @param {ArchiveEntry} a
 * @param {ArchiveEntry} b
 */
function beats(a, b) {
  if ((a.score === null) !== (b.score === null)) return a.score !== null;
  if (a.score !== null && b.score !== null && a.score !== b.score) return a.score > b.score;
  if (a.score === null && a.misses !== b.misses) return a.misses < b.misses;
  return a.createdAt !== b.createdAt ? a.createdAt > b.createdAt : a.candidateId > b.candidateId;
}

/** @param {readonly number[]} a @param {readonly number[]} b */
function byIndex(a, b) {
  for (let i = 0; i < a.length; i++) {
    const d = /** @type {number} */ (a[i]) - /** @type {number} */ (b[i]);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The map of `entries` on `axes`. Throws on a map of other than two or three axes or of more
 * than `MAX_ARCHIVE_CELLS` cells.
 * @param {readonly ArchiveAxis[]} axes
 * @param {readonly ArchiveEntry[]} entries each with a finite value per axis
 * @returns {Archive}
 */
export function buildArchive(axes, entries) {
  if (AXIS_BINS[axes.length] === undefined) {
    throw new Error(`a map takes two or three axes, got ${axes.length}`);
  }
  const shape = axes.map(({ bins }) => bins);
  const total = shape.reduce((product, bins) => product * bins, 1);
  if (total > MAX_ARCHIVE_CELLS) {
    throw new Error(`a map holds at most ${MAX_ARCHIVE_CELLS} cells; these axes make ${total}`);
  }
  /** @type {Map<string, ArchiveCell>} */
  const cells = new Map();
  for (const each of entries) {
    if (each.values.length !== axes.length || !each.values.every(Number.isFinite)) {
      throw new Error(`candidate ${each.candidateId} needs a finite value on each axis`);
    }
    const index = axes.map((axis, i) => binOf(/** @type {number} */ (each.values[i]), axis));
    const key = index.join();
    const cell = cells.get(key);
    if (!cell) cells.set(key, { index, elite: each, count: 1 });
    else {
      cell.count += 1;
      if (beats(each, cell.elite)) cell.elite = each;
    }
  }
  return { shape, total, cells: [...cells.values()].sort((a, b) => byIndex(a.index, b.index)) };
}

/**
 * Filled cells over cells.
 * @param {Archive} archive
 */
export const archiveCoverage = ({ cells, total }) => cells.length / total;

/**
 * @typedef {object} FillStart
 * @property {number} eliteId the candidate to nudge
 * @property {number[]} from its cell
 * @property {number[]} to the empty cell beside it
 * @property {number} axis the axis the two differ on
 * @property {-1 | 1} sign which way along it the empty cell lies
 */

/**
 * Every elite beside an empty cell, one step along one axis, with that cell: the fill job's
 * starts. In cell order, then axis order, the lower side first.
 * @param {Archive} archive
 * @returns {FillStart[]}
 */
export function besideEmpty({ shape, cells }) {
  const filled = new Set(cells.map(({ index }) => index.join()));
  /** @type {FillStart[]} */
  const starts = [];
  for (const { index, elite } of cells) {
    for (const [axis, bins] of shape.entries()) {
      for (const sign of /** @type {const} */ ([-1, 1])) {
        const bin = /** @type {number} */ (index[axis]) + sign;
        if (bin < 0 || bin >= bins) continue;
        const to = index.with(axis, bin);
        if (!filled.has(to.join())) {
          starts.push({ eliteId: elite.candidateId, from: index, to, axis, sign });
        }
      }
    }
  }
  return starts;
}

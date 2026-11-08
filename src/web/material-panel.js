// The timeline's material panel (decision 0066), with no DOM: the brief's sketches, each with
// its position on the brief's directions (0056) read from its excerpt, the map's elites by cell
// with the cell's axis words (0057), the directions a section can be steered along, and the
// attached regions that can be the arc target. A brief with no map, directions or regions
// lists its sketches alone.
/** @import { AxisSource } from "../domain/axis-words.js" */
/** @import { MapCell } from "./map-grid.js" */
/** @import { SteeringView } from "./steer-sliders.js" */
import { axisName } from "../domain/axis-words.js";
import { directionText, positionsLine } from "./direction-text.js";
import { clockTime } from "./excerpt-player.js";
import { endText, openText } from "./map-grid.js";

/**
 * A sketch as the track route lists it.
 * @typedef {object} PanelSketch
 * @property {number} id
 * @property {number} candidateId
 * @property {string | null} intent
 * @property {number} duration
 * @property {{ renderId: number } | null} excerpt its candidate's excerpt, null when none is
 *   cached
 */

/**
 * One axis of the map as the archive route gives it, with its ends once they can be had.
 * @typedef {AxisSource & { low: number | null, high: number | null, bins: number }} PanelAxis
 */

/**
 * The map as the archive route gives it.
 * @typedef {object} PanelArchive
 * @property {string | null} reason why it has no cells
 * @property {boolean} model
 * @property {PanelAxis[]} axes
 * @property {MapCell[]} cells
 */

/** An attached region as the attachments route lists it. */
/** @typedef {{ id: number, regionId: number, label: string }} PanelRegion */

/**
 * @typedef {object} EliteRow
 * @property {string} key its cell, as "2,5"
 * @property {MapCell} cell
 * @property {number | null} sketchId the sketch already kept of its candidate, or null
 * @property {string} words the cell's place on each axis
 * @property {string} label the line the panel shows
 * @property {string} about what the cell holds, as the map says it
 */

/**
 * A direction a section can be steered along, with why it can't be yet, or null.
 * @typedef {{ id: number, text: string, near: string | null, far: string, reason: string | null }} DirectionRow
 */

/**
 * @typedef {object} MaterialPanel
 * @property {{ sketch: PanelSketch, name: string, positions: { directionId: number,
 *   position: number | null }[], line: string }[]} sketches
 * @property {EliteRow[]} elites
 * @property {string} elitesLine why there are none, or how many cells there are
 * @property {DirectionRow[]} directions
 * @property {PanelRegion[]} regions
 */

/**
 * The words for bin `bin` of an axis: its stretch of the axis between its ends, and past the
 * end for an edge bin, where a value past an end lands (0057).
 * @param {PanelAxis} axis
 * @param {number} bin
 */
function binWords(axis, bin) {
  const { low, high, bins } = axis;
  if (low === null || high === null) throw new Error("a filled cell's axis has its ends");
  const width = (high - low) / bins;
  const from = endText(low + bin * width);
  const to = endText(low + (bin + 1) * width);
  const stretch =
    bin === 0 ? `up to ${to}` : bin === bins - 1 ? `${from} or more` : `${from} to ${to}`;
  return `${axisName(axis)} ${stretch}`;
}

/**
 * A cell's place on each axis of the map, in words.
 * @param {readonly PanelAxis[]} axes
 * @param {readonly number[]} index
 */
export const cellWords = (axes, index) =>
  axes.map((axis, i) => binWords(axis, /** @type {number} */ (index[i]))).join("; ");

/**
 * A sketch's name, as the add list gives it.
 * @param {PanelSketch} sketch
 */
const sketchName = ({ id, intent, duration }) =>
  `Sketch ${id}${intent ? `: ${intent}` : ""}, ${clockTime(duration)}`;

/**
 * @param {object} read
 * @param {readonly PanelSketch[]} read.sketches the brief's live ones
 * @param {PanelArchive | null} read.archive null while unread
 * @param {SteeringView | null} read.steering null while unread
 * @param {readonly PanelRegion[]} read.regions the brief's attached regions
 * @returns {MaterialPanel}
 */
export function materialPanel({ sketches, archive, steering, regions }) {
  const directions = steering?.directions ?? [];
  const cells = archive === null || archive.reason !== null ? [] : archive.cells;
  const elitesLine =
    archive === null
      ? "Reading the map…"
      : archive.reason !== null
        ? `No elites from the map: ${archive.reason}`
        : cells.length === 0
          ? "The map has no filled cells yet."
          : `${cells.length} filled ${cells.length === 1 ? "cell" : "cells"} of the map, each with its best candidate.`;
  return {
    sketches: sketches.map((sketch) => {
      const renderId = sketch.excerpt?.renderId ?? null;
      return {
        sketch,
        name: sketchName(sketch),
        positions: directions.map(({ id, positions }) => ({
          directionId: id,
          position: renderId === null ? null : (positions[renderId] ?? null),
        })),
        line: positionsLine(directions, renderId),
      };
    }),
    elites: cells.map((cell) => {
      const sketchId = sketches.find((sketch) => sketch.candidateId === cell.candidateId)?.id;
      const words = cellWords(/** @type {PanelArchive} */ (archive).axes, cell.index);
      const kept = sketchId === undefined ? "" : ` (kept as sketch ${sketchId})`;
      return {
        key: cell.index.join(","),
        cell,
        sketchId: sketchId ?? null,
        words,
        label: `Candidate #${cell.candidateId}${kept}: ${words}`,
        about: openText(cell, /** @type {PanelArchive} */ (archive).model),
      };
    }),
    elitesLine,
    directions: directions.map(({ id, near, far, reason }) => ({
      id,
      text: directionText({ near, far }),
      near,
      far,
      reason: steering?.reason ?? reason,
    })),
    regions: [...regions],
  };
}

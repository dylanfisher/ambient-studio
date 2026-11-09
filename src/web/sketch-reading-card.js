// The track page's reading card (decision 0078): what the model reads about the chosen
// section's sketch, its voices and macros and how it was made, read from the server again
// whenever the chosen section's sketch changes. Each raw number in a reading's line sits in
// parentheses; the card marks those `data-numbers`, so they follow the page's numbers toggle
// (0083) and the words read without them. It writes nothing.
/** @import { StatusLine } from "./status-line.js" */
import { getJson, sketchReadingPath } from "./api.js";
import { elementsById } from "./element-by-id.js";

/** A parenthesized group that holds a digit: the reading's raw numbers. */
const NUMBERS = /\([^()]*\d[^()]*\)/g;

/** @typedef {{ text: string, numbers: boolean }} ReadingPart */

/**
 * A line split into its words and its raw numbers, in order.
 * @param {string} line
 * @returns {ReadingPart[]}
 */
export function readingParts(line) {
  /** @type {ReadingPart[]} */
  const parts = [];
  let at = 0;
  for (const match of line.matchAll(NUMBERS)) {
    if (match.index > at) parts.push({ text: line.slice(at, match.index), numbers: false });
    parts.push({ text: match[0], numbers: true });
    at = match.index + match[0].length;
  }
  if (at < line.length) parts.push({ text: line.slice(at), numbers: false });
  return parts;
}

/**
 * One reading's lines as list items, numbers in their own marked spans.
 * @param {HTMLUListElement} list
 * @param {readonly string[]} lines
 */
function fill(list, lines) {
  list.replaceChildren(
    ...lines.map((line) => {
      const item = document.createElement("li");
      item.append(
        ...readingParts(line).map(({ text, numbers }) => {
          if (!numbers) return text;
          const span = document.createElement("span");
          span.dataset.numbers = "";
          span.textContent = text;
          return span;
        }),
      );
      return item;
    }),
  );
}

/**
 * @param {StatusLine} status where a failed read is said
 * @returns {{ show: (sketchId: number | null) => void }} `show` reads the sketch's reading
 *   unless it is the one shown already, and hides the card for no sketch
 */
export function sketchReadingCard(status) {
  const page = elementsById({
    readingBox: HTMLElement,
    readingLine: HTMLElement,
    readingSketch: HTMLUListElement,
    readingLineage: HTMLUListElement,
  });
  /** @type {number | null} the sketch shown, or being read */
  let shown = null;
  return {
    show(sketchId) {
      if (sketchId === shown) return;
      shown = sketchId;
      page.readingBox.hidden = sketchId === null;
      page.readingSketch.replaceChildren();
      page.readingLineage.replaceChildren();
      if (sketchId === null) return;
      page.readingLine.textContent = `Reading sketch ${sketchId}…`;
      void status.run(async () => {
        try {
          /** @type {{ sketch: string[], lineage: string[] }} */
          const reading = await getJson(sketchReadingPath(sketchId));
          // A section chosen meanwhile has its own read on the way.
          if (shown !== sketchId) return;
          fill(page.readingSketch, reading.sketch);
          fill(page.readingLineage, reading.lineage);
          page.readingLine.textContent = `Sketch ${sketchId}, in the words the model is given when it develops this section.`;
        } catch (error) {
          if (shown === sketchId) {
            page.readingLine.textContent = `Sketch ${sketchId}'s reading couldn't be read. It is read again when the timeline next changes.`;
            shown = null;
          }
          throw error;
        }
      });
    },
  };
}

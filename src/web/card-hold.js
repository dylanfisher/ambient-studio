// Whether a session card is in use, so a revised pair's swap (decision 0036) doesn't hide it:
// it holds the focus, a pointer is pressed inside it, it holds text not yet sent (a note, tags
// or an explore direction), or it waits on something: a request from it in flight, or an offer
// to lock macros not yet answered (0039). The pointer counts because Safari and Firefox on macOS don't focus a button on click:
// a press blurs a focused field, and a swap run on that blur would hide the card before the
// click lands. No DOM: the page feeds it the card's events.

/**
 * @typedef {object} CardHold
 * @property {() => void} focusIn the focus moved into the card
 * @property {() => void} focusOut the focus left the card, or moved within it
 * @property {() => void} pointerDown a pointer was pressed inside the card
 * @property {() => void} pointerUp a pointer was released or cancelled anywhere
 * @property {(use: CardUse) => boolean} held whether the card may not be hidden now
 */

/**
 * What the page knows of the card's own state beyond its events.
 * @typedef {object} CardUse
 * @property {boolean} unsentText a note, tags or a direction holds text not yet sent
 * @property {boolean} pending a request from the card is in flight, or its offer to lock the
 *   macros is not yet answered, so hiding it would hide the answer
 */

/** @returns {CardHold} */
export function createCardHold() {
  let focused = false;
  let pressed = false;
  return {
    focusIn() {
      focused = true;
    },
    focusOut() {
      focused = false;
    },
    pointerDown() {
      pressed = true;
    },
    pointerUp() {
      pressed = false;
    },
    held: ({ unsentText, pending }) => focused || pressed || unsentText || pending,
  };
}

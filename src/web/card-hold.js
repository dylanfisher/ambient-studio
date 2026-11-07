// Whether a session card is in use, so a revised pair's swap (decision 0036) doesn't hide it:
// it holds the focus, a pointer is pressed inside it, or its note or tags hold text not yet
// sent. The pointer counts because Safari and Firefox on macOS don't focus a button on click:
// a press blurs a focused field, and a swap run on that blur would hide the card before the
// click lands. No DOM: the page feeds it the card's events.

/**
 * @typedef {object} CardHold
 * @property {() => void} focusIn the focus moved into the card
 * @property {() => void} focusOut the focus left the card, or moved within it
 * @property {() => void} pointerDown a pointer was pressed inside the card
 * @property {() => void} pointerUp a pointer was released or cancelled anywhere
 * @property {(unsentText: boolean) => boolean} held whether the card may not be hidden now
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
    held: (unsentText) => focused || pressed || unsentText,
  };
}

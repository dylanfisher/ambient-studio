// A card in use holds a revised pair's swap (decision 0036). The sequence is the one Safari
// gives a click on a button while a field in the card has the focus: the press blurs the field
// before the click, and the swap must not run until the pointer is up.
import { expect, test } from "vitest";
import { createCardHold } from "../../src/web/card-hold.js";
import { createPairSwap } from "../../src/web/pair-swap.js";

const FIRST = 1;
const REVISION = 2;

test("a click that blurs a field doesn't swap the card until the pointer is up", () => {
  const swap = createPairSwap();
  const hold = createCardHold();
  const held = {
    playing: () => false,
    editing: (/** @type {number} */ id) => id === FIRST && hold.held(false),
  };
  hold.focusIn();
  expect(swap.show(FIRST, REVISION, held)).toBe(FIRST);
  hold.pointerDown();
  hold.focusOut();
  // The deferred swap after the blur runs while the button is still pressed.
  expect(swap.show(FIRST, REVISION, held)).toBe(FIRST);
  hold.pointerUp();
  expect(swap.show(FIRST, REVISION, held)).toBe(REVISION);
});

test("unsent text holds the card with no focus or pointer", () => {
  const hold = createCardHold();
  expect(hold.held(true)).toBe(true);
  expect(hold.held(false)).toBe(false);
});

test("focus moving within the card keeps it held", () => {
  const hold = createCardHold();
  hold.focusIn();
  hold.focusOut();
  hold.focusIn();
  expect(hold.held(false)).toBe(true);
});

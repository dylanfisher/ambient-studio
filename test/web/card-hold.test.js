// A card in use holds a revised pair's swap (decision 0036). The sequence is the one Safari
// gives a click on a button while a field in the card has the focus: the press blurs the field
// before the click, and the swap must not run until the pointer is up.
import { expect, test } from "vitest";
import { createCardHold } from "../../src/web/card-hold.js";
import { createPairSwap } from "../../src/web/pair-swap.js";

const FIRST = 1;
const REVISION = 2;
/** Nothing unsent and nothing pending. */
const FREE = Object.freeze({ unsentText: false, pending: false });

test("a click that blurs a field doesn't swap the card until the pointer is up", () => {
  const swap = createPairSwap();
  const hold = createCardHold();
  const held = {
    playing: () => false,
    editing: (/** @type {number} */ id) => id === FIRST && hold.held(FREE),
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
  expect(hold.held({ ...FREE, unsentText: true })).toBe(true);
  expect(hold.held(FREE)).toBe(false);
});

test("focus moving within the card keeps it held", () => {
  const hold = createCardHold();
  hold.focusIn();
  hold.focusOut();
  hold.focusIn();
  expect(hold.held(FREE)).toBe(true);
});

test("a click on Lock keeps the card shown through the request and until its offer is answered", () => {
  const swap = createPairSwap();
  const hold = createCardHold();
  /** @type {import("../../src/web/card-hold.js").CardUse} the card's state, as the page keeps it */
  let use = FREE;
  const held = {
    playing: () => false,
    editing: (/** @type {number} */ id) => id === FIRST && hold.held(use),
  };
  // The path was picked in the select, which has the focus; then Lock is pressed.
  hold.focusIn();
  hold.pointerDown();
  hold.focusOut();
  use = { ...FREE, pending: true }; // the click sent the lock request
  hold.pointerUp();
  // Safari leaves the focus nowhere, and the swap deferred after the press runs.
  expect(swap.show(FIRST, REVISION, held)).toBe(FIRST);
  // The answer names macros to offer: the offer is pending until the owner answers it.
  expect(swap.show(FIRST, REVISION, held)).toBe(FIRST);
  use = FREE; // answered or dismissed
  expect(swap.show(FIRST, REVISION, held)).toBe(REVISION);
});

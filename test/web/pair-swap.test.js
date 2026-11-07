// Which card of a revised pair the session page shows (decision 0036): the server's pick, never
// swapped in while the visible card plays, and the owner's own pick once made.
import { expect, test } from "vitest";
import { createPairSwap } from "../../src/web/pair-swap.js";

const FIRST = 1;
const REVISION = 2;
const silent = () => false;

test("shows the server's pick when nothing plays", () => {
  const swap = createPairSwap();
  expect(swap.show(FIRST, REVISION, silent)).toBe(REVISION);
  expect(swap.show(FIRST, FIRST, silent)).toBe(FIRST);
});

test("waits while the first try plays, then swaps once it stops", () => {
  const swap = createPairSwap();
  let playing = true;
  const isPlaying = (/** @type {number} */ id) => playing && id === FIRST;
  // The first try was on the page before its revision existed.
  expect(swap.show(FIRST, REVISION, isPlaying)).toBe(FIRST);
  expect(swap.show(FIRST, REVISION, isPlaying)).toBe(FIRST);
  playing = false;
  expect(swap.show(FIRST, REVISION, isPlaying)).toBe(REVISION);
});

test("waits while the revision plays before swapping back", () => {
  const swap = createPairSwap();
  swap.show(FIRST, REVISION, silent);
  expect(swap.show(FIRST, FIRST, (id) => id === REVISION)).toBe(REVISION);
  expect(swap.show(FIRST, FIRST, silent)).toBe(FIRST);
});

test("keeps the owner's pick over the server's", () => {
  const swap = createPairSwap();
  swap.show(FIRST, REVISION, silent);
  swap.choose(FIRST, FIRST);
  expect(swap.show(FIRST, REVISION, silent)).toBe(FIRST);
});

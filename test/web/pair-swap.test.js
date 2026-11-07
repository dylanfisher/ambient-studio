// Which card of a revised pair the session page shows (decision 0036): the server's pick, never
// swapped in while the visible card plays or is being written in, and the owner's own pick once
// made.
import { expect, test } from "vitest";
import { createPairSwap } from "../../src/web/pair-swap.js";

const FIRST = 1;
const REVISION = 2;
const never = () => false;
const free = { playing: never, editing: never };

test("shows the server's pick when nothing holds the visible card", () => {
  const swap = createPairSwap();
  expect(swap.show(FIRST, REVISION, free)).toBe(REVISION);
  expect(swap.show(FIRST, FIRST, free)).toBe(FIRST);
});

test("waits while the first try plays, then swaps once it stops", () => {
  const swap = createPairSwap();
  let playing = true;
  const held = { playing: (/** @type {number} */ id) => playing && id === FIRST, editing: never };
  // The first try was on the page before its revision existed.
  expect(swap.show(FIRST, REVISION, held)).toBe(FIRST);
  expect(swap.show(FIRST, REVISION, held)).toBe(FIRST);
  playing = false;
  expect(swap.show(FIRST, REVISION, held)).toBe(REVISION);
});

test("waits while the first try holds the focus or an unsent note, then swaps once it doesn't", () => {
  const swap = createPairSwap();
  let editing = true;
  const held = { playing: never, editing: (/** @type {number} */ id) => editing && id === FIRST };
  expect(swap.show(FIRST, REVISION, held)).toBe(FIRST);
  editing = false;
  expect(swap.show(FIRST, REVISION, held)).toBe(REVISION);
});

test("waits while the revision plays before swapping back", () => {
  const swap = createPairSwap();
  swap.show(FIRST, REVISION, free);
  const held = { playing: (/** @type {number} */ id) => id === REVISION, editing: never };
  expect(swap.show(FIRST, FIRST, held)).toBe(REVISION);
  expect(swap.show(FIRST, FIRST, free)).toBe(FIRST);
});

test("keeps the owner's pick over the server's", () => {
  const swap = createPairSwap();
  swap.show(FIRST, REVISION, free);
  swap.choose(FIRST, FIRST);
  expect(swap.show(FIRST, REVISION, free)).toBe(FIRST);
});

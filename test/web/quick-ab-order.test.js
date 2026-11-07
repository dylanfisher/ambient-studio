// The order Quick A/B draws its pairs in (decision 0048): the chosen side stays as the champion
// and meets a fresh challenger until every candidate has had a turn, or random pairs that never
// repeat.
import { expect, test } from "vitest";
import { createQuickAbOrder } from "../../src/web/quick-ab-order.js";

const IDS = [11, 12, 13, 14, 15];

/**
 * A fixed sequence of draws in [0, 1), repeated, so every run draws the same order.
 * @param {...number} values
 */
function draws(...values) {
  let at = 0;
  return () => /** @type {number} */ (values[at++ % values.length]);
}

/** @param {[number, number] | null} pair */
const key = (pair) => (pair ? [...pair].sort((x, y) => x - y).join("-") : "none");

test("the chosen side stays as the champion and a fresh challenger comes next", () => {
  const order = createQuickAbOrder(IDS, { mode: "champion", random: draws(0.3, 0.7, 0.1) });
  const first = /** @type {[number, number]} */ (order.pair());
  const [champion, challenger] = first;
  order.rate("a");
  const second = /** @type {[number, number]} */ (order.pair());
  expect(second[0]).toBe(champion);
  expect(second[1]).not.toBe(challenger);

  // The challenger wins, so it is the champion against the next one.
  order.rate("b");
  const third = /** @type {[number, number]} */ (order.pair());
  expect(third[0]).toBe(second[1]);
  expect(order.champion()).toBe(second[1]);
  expect([champion, challenger, second[1]]).not.toContain(third[1]);
});

test("every candidate has one turn, then the pool runs out", () => {
  const order = createQuickAbOrder(IDS, { mode: "champion", random: draws(0.5, 0.2, 0.9) });
  const seen = new Set();
  for (const outcome of /** @type {const} */ (["a", "b", "tie", "skip"])) {
    const pair = /** @type {[number, number]} */ (order.pair());
    for (const id of pair) seen.add(id);
    order.rate(outcome);
  }
  expect(seen).toEqual(new Set(IDS));
  expect(order.pair()).toBeNull();
  expect(order.remaining()).toBe(0);
});

test("a tie keeps the champion, and a skip draws a new challenger", () => {
  const order = createQuickAbOrder(IDS, { mode: "champion", random: draws(0.4) });
  const [champion, first] = /** @type {[number, number]} */ (order.pair());
  order.rate("tie");
  const [kept, second] = /** @type {[number, number]} */ (order.pair());
  expect(kept).toBe(champion);
  order.rate("skip");
  const [still, third] = /** @type {[number, number]} */ (order.pair());
  expect(still).toBe(champion);
  expect(new Set([first, second, third]).size).toBe(3);
});

test("random mode never draws a pair twice, and runs out after every pair", () => {
  const order = createQuickAbOrder(IDS, { mode: "random", random: draws(0, 0.99, 0.5, 0.25) });
  const keys = [];
  // Bounded, so an order that repeats pairs fails here instead of looping.
  for (let turn = 0; turn < 20 && order.pair(); turn++) {
    keys.push(key(order.pair()));
    order.rate("a");
  }
  expect(keys).toHaveLength((IDS.length * (IDS.length - 1)) / 2);
  expect(new Set(keys).size).toBe(keys.length);
});

test("switching to random keeps out the pairs already rated", () => {
  const order = createQuickAbOrder([1, 2, 3], { mode: "champion", random: draws(0) });
  const rated = key(order.pair());
  order.rate("a");
  order.setMode("random");
  expect(order.mode()).toBe("random");
  const keys = [];
  // Bounded, so an order that repeats pairs fails here instead of looping.
  for (let turn = 0; turn < 20 && order.pair(); turn++) {
    keys.push(key(order.pair()));
    order.rate("tie");
  }
  expect(keys).toHaveLength(2);
  expect(keys).not.toContain(rated);
});

test("undo puts back the pair and the champion from before the last rating, and keeps the mode", () => {
  const order = createQuickAbOrder(IDS, { mode: "champion", random: draws(0.6, 0.1) });
  const first = order.pair();
  order.rate("b");
  const second = order.pair();
  order.setMode("random");
  order.rate("a");
  expect(order.undo()).toBe(true);
  expect(order.pair()).toEqual(second);
  expect(order.mode()).toBe("random");
  expect(order.undo()).toBe(true);
  expect(order.pair()).toEqual(first);
  expect(order.champion()).toBe(first?.[0]);
  expect(order.mode()).toBe("random");
  expect(order.undo()).toBe(false);
});

test("switching mode keeps the pair shown, and applies from the next one", () => {
  const order = createQuickAbOrder(IDS, { mode: "champion", random: draws(0.3, 0.8) });
  const shown = order.pair();
  order.setMode("random");
  expect(order.pair()).toEqual(shown);
  order.setMode("champion");
  expect(order.pair()).toEqual(shown);
});

test("a rating that wasn't saved isn't rated, is held out of the draw, and undo doesn't bring it back", () => {
  const order = createQuickAbOrder([1, 2, 3], { mode: "random", random: draws(0) });
  const failed = /** @type {[number, number]} */ (order.pair());
  order.rate("a");
  order.rate("a");
  order.forget(failed);
  order.undo();
  // The failed pair is held out while its save waits: the one undone and the last are left.
  expect(order.remaining()).toBe(2);
  order.release(failed);
  expect(order.remaining()).toBe(3);
  order.forget(failed);
  order.remember(failed);
  expect(order.remaining()).toBe(2);
});

test("random mode leaves out the pairs the session rated before", () => {
  const order = createQuickAbOrder([1, 2, 3], {
    mode: "random",
    random: draws(0),
    prior: ["1-2", "2-3"],
  });
  expect(key(order.pair())).toBe("1-3");
  order.rate("a");
  expect(order.pair()).toBeNull();
});

test("fewer than two candidates make no pair", () => {
  expect(createQuickAbOrder([7], { mode: "champion", random: draws(0) }).pair()).toBeNull();
  expect(createQuickAbOrder([], { mode: "random", random: draws(0) }).pair()).toBeNull();
});

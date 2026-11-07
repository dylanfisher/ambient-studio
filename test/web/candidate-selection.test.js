import { expect, test } from "vitest";
import { createSelection } from "../../src/web/candidate-selection.js";

function clock() {
  let time = 1000;
  return { now: () => time, advance: (/** @type {number} */ ms) => (time += ms) };
}

test("nothing is selected at first", () => {
  expect(createSelection(clock().now).current()).toBeNull();
});

test("choosing a candidate selects it, starts its clock, and moves focus to it", () => {
  const time = clock();
  const selection = createSelection(time.now);
  expect(selection.choose("a", { inField: false })).toEqual({ focus: true });
  time.advance(4000);
  expect(selection.current()).toBe("a");
  expect(selection.elapsedMs()).toBe(4000);
});

test("choosing while the owner types in a field selects without taking focus", () => {
  const selection = createSelection(clock().now);
  expect(selection.choose("a", { inField: true })).toEqual({ focus: false });
  expect(selection.current()).toBe("a");
});

test("choosing the selected candidate again keeps its clock and leaves focus", () => {
  const time = clock();
  const selection = createSelection(time.now);
  selection.choose("a", { inField: false });
  time.advance(3000);
  expect(selection.choose("a", { inField: false })).toEqual({ focus: false });
  expect(selection.elapsedMs()).toBe(3000);
});

test("a reload that replaces the selected card carries the selection and its clock, never focus", () => {
  const time = clock();
  const selection = createSelection(time.now);
  selection.choose("old", { inField: false });
  time.advance(2000);
  selection.carry("old", "new");
  expect(selection.current()).toBe("new");
  expect(selection.elapsedMs()).toBe(2000);
});

test("a reload of another card leaves the selection alone", () => {
  const selection = createSelection(clock().now);
  selection.choose("a", { inField: false });
  selection.carry("b", "b2");
  expect(selection.current()).toBe("a");
});

test("restart, after a rating or the A/B view closing, starts the clock again", () => {
  const time = clock();
  const selection = createSelection(time.now);
  selection.choose("a", { inField: false });
  time.advance(9000);
  selection.restart();
  time.advance(1500);
  expect(selection.elapsedMs()).toBe(1500);
});

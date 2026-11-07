import { expect, test } from "vitest";
import { createSelection } from "../../src/web/candidate-selection.js";

function clock() {
  let time = 1000;
  return { now: () => time, advance: (/** @type {number} */ ms) => (time += ms) };
}

test("nothing is selected at first", () => {
  expect(createSelection(clock().now).current()).toBeNull();
});

test("choosing a candidate selects it and starts its clock", () => {
  const time = clock();
  const selection = createSelection(time.now);
  selection.choose("a");
  time.advance(4000);
  expect(selection.current()).toBe("a");
  expect(selection.elapsedMs()).toBe(4000);
});

test("choosing the selected candidate again keeps its clock", () => {
  const time = clock();
  const selection = createSelection(time.now);
  selection.choose("a");
  time.advance(3000);
  selection.choose("a");
  expect(selection.elapsedMs()).toBe(3000);
});

test("choosing another candidate restarts the clock for it", () => {
  const time = clock();
  const selection = createSelection(time.now);
  selection.choose("a");
  time.advance(3000);
  selection.choose("b");
  time.advance(500);
  expect(selection.current()).toBe("b");
  expect(selection.elapsedMs()).toBe(500);
});

test("restart, after a rating or the A/B view closing, starts the clock again", () => {
  const time = clock();
  const selection = createSelection(time.now);
  selection.choose("a");
  time.advance(9000);
  selection.restart();
  time.advance(1500);
  expect(selection.elapsedMs()).toBe(1500);
});

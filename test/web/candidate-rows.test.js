// The session table's rows (decision 0049): each candidate under its parent at any depth, a
// revised pair in one place with the children of either under it, and hidden candidates moved
// to the hidden list, their children left in the table as roots that name them.
import { expect, test } from "vitest";
import { candidateRows } from "../../src/web/candidate-rows.js";

/**
 * @param {number} id
 * @param {{ parent?: number, pair?: [number, number], hidden?: boolean }} [options] `pair` is
 *   the first try's id and the revision's
 */
const candidate = (id, { parent, pair, hidden = false } = {}) => ({
  id,
  parentIds: parent === undefined ? [] : [parent],
  pair: pair ? { firstTryId: pair[0], revisionId: pair[1] } : null,
  hidden,
});

/** @param {ReturnType<typeof candidateRows>["shown"]} rows */
const flat = (rows) =>
  rows.map(({ id, depth, parentMissing }) =>
    parentMissing === null ? [id, depth] : [id, depth, parentMissing],
  );

test("children nest under their parent at any depth, in the order given", () => {
  const { shown, hidden } = candidateRows([
    candidate(1),
    candidate(2),
    candidate(3, { parent: 1 }),
    candidate(4, { parent: 3 }),
    candidate(5, { parent: 4 }),
    candidate(6, { parent: 1 }),
    candidate(7, { parent: 2 }),
  ]);
  expect(flat(shown)).toEqual([
    [1, 0],
    [3, 1],
    [4, 2],
    [5, 3],
    [6, 1],
    [2, 0],
    [7, 1],
  ]);
  expect(hidden).toEqual([]);
});

test("a revised pair takes one place, and a child of either member nests under it", () => {
  const { shown } = candidateRows([
    candidate(1, { pair: [1, 2] }),
    candidate(2, { parent: 1, pair: [1, 2] }),
    candidate(3),
    candidate(4, { parent: 2 }),
    candidate(5, { parent: 1 }),
  ]);
  expect(flat(shown)).toEqual([
    [1, 0],
    [2, 0],
    [4, 1],
    [5, 1],
    [3, 0],
  ]);
});

test("a candidate whose parent isn't in the session is a root that names it", () => {
  const { shown } = candidateRows([candidate(8, { parent: 3 }), candidate(9, { parent: 8 })]);
  expect(flat(shown)).toEqual([
    [8, 0, 3],
    [9, 1],
  ]);
});

test("a hidden candidate leaves the table for the hidden list, and its children stay as roots", () => {
  const { shown, hidden } = candidateRows([
    candidate(1),
    candidate(2, { parent: 1, hidden: true }),
    candidate(3, { parent: 2 }),
    candidate(4, { parent: 3 }),
    candidate(5, { hidden: true }),
  ]);
  expect(flat(shown)).toEqual([
    [1, 0],
    [3, 0, 2],
    [4, 1],
  ]);
  expect(hidden).toEqual([2, 5]);
});

test("a revised pair is hidden whole when either member is", () => {
  const { shown, hidden } = candidateRows([
    candidate(1, { pair: [1, 2] }),
    candidate(2, { parent: 1, pair: [1, 2], hidden: true }),
    candidate(3, { parent: 2 }),
  ]);
  expect(flat(shown)).toEqual([[3, 0, 1]]);
  expect(hidden).toEqual([1, 2]);
});

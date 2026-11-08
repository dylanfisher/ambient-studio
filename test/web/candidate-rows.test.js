// The session table's rows (decision 0049): each candidate under its parent at any depth, a
// revised pair in one place with the children of either under it, and hidden candidates moved
// to the hidden list, their children left in the table as roots that name them.
import { expect, test } from "vitest";
import { candidateRows, foldedOut, rowPlacement } from "../../src/web/candidate-rows.js";

/**
 * @param {number} id
 * @param {{ parent?: number, pair?: [number, number], hidden?: boolean,
 *   foldedUnder?: number | null }} [options] `pair` is the first try's id and the revision's;
 *   `foldedUnder` makes it a search point, shown when null
 */
const candidate = (id, { parent, pair, hidden = false, foldedUnder } = {}) => ({
  id,
  parentIds: parent === undefined ? [] : [parent],
  pair: pair ? { firstTryId: pair[0], revisionId: pair[1] } : null,
  hidden,
  ...(foldedUnder !== undefined && { search: { foldedUnder } }),
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

// The ranked order (decision 0046): roots by their place in the ranking, children kept under
// their parent in the order given.
test("ranked roots follow their slots, children stay under their parent, and unranked roots come last", () => {
  /** @param {number} id @param {number | null} slot @param {Parameters<typeof candidate>[1]} [options] */
  const ranked = (id, slot, options) => ({
    ...candidate(id, options),
    ranking: slot === null ? null : { slot },
  });
  const { shown } = candidateRows([
    ranked(1, 4),
    ranked(2, null),
    ranked(3, 1, { parent: 1 }),
    ranked(4, 3),
    ranked(5, 2, { pair: [5, 6] }),
    ranked(6, 5, { parent: 5, pair: [5, 6] }),
    ranked(7, 6, { parent: 4 }),
  ]);
  expect(flat(shown)).toEqual([
    [5, 0],
    [6, 0],
    [4, 0],
    [7, 1],
    [1, 0],
    [3, 1],
    [2, 0],
  ]);
});

// Placing the rows without moving one in use (decision 0046): Safari pauses a detached
// `<audio>` and blurs a detached field, so a held row stays put and the rest order around it.

/**
 * Applies the moves to the current order, as the page's insertBefore calls would.
 * @param {number[]} current
 * @param {[number, number | null][]} moves each row and the row it goes before, null for last
 */
const apply = (current, moves) => {
  const rows = [...current];
  for (const [id, before] of moves) {
    const at = rows.indexOf(id);
    if (at >= 0) rows.splice(at, 1);
    rows.splice(before === null ? rows.length : rows.indexOf(before), 0, id);
  }
  return rows;
};

test("with nothing held, the rows take the wanted order", () => {
  const { order, moves } = rowPlacement([1, 2, 3, 4], [4, 2, 1, 3], new Set());
  expect(order).toEqual([4, 2, 1, 3]);
  expect(apply([1, 2, 3, 4], moves)).toEqual(order);
});

test("a held row keeps its place and is never moved, and the rest order around it", () => {
  const current = [1, 2, 3, 4];
  const { order, moves } = rowPlacement(current, [4, 3, 2, 1], new Set([2]));
  expect(order).toEqual([4, 2, 3, 1]);
  expect(moves.map(([id]) => id)).not.toContain(2);
  expect(apply(current, moves)).toEqual(order);
});

test("rows already in place aren't moved, and new rows come in around held ones", () => {
  expect(rowPlacement([1, 2, 3], [1, 2, 3], new Set([2])).moves).toEqual([]);
  const { order, moves } = rowPlacement([1, 2, 3], [5, 3, 2, 1, 6], new Set([1, 3]));
  expect(order).toEqual([1, 5, 3, 2, 6]);
  expect(moves.map(([id]) => id).filter((id) => id === 1 || id === 3)).toEqual([]);
  expect(apply([1, 2, 3], moves)).toEqual(order);
});

test("a held row leaving the table, as a hide does, still leaves it", () => {
  const { order, moves } = rowPlacement([1, 2, 3], [3, 1], new Set([2]));
  expect(order).toEqual([3, 1]);
  expect(apply([1, 2, 3], moves).filter((id) => id !== 2)).toEqual(order);
});

test("unranked rows added to a ranked session keep the ranked rows' order (the ranking unchanged)", () => {
  /** @param {number} id @param {number | null} slot */
  const ranked = (id, slot) => ({ ...candidate(id), ranking: slot === null ? null : { slot } });
  const before = candidateRows([ranked(1, 2), ranked(2, 1)]).shown.map(({ id }) => id);
  const after = candidateRows([ranked(1, 2), ranked(2, 1), ranked(3, null), ranked(4, null)]);
  const ids = after.shown.map(({ id }) => id);
  expect(ids.slice(0, 2)).toEqual(before);
  expect(rowPlacement(before, ids, new Set()).moves).toEqual([
    [4, null],
    [3, 4],
  ]);
});

test("a held row coming into the table, as Show again sends it, comes in", () => {
  const { order, moves } = rowPlacement([1, 3], [1, 2, 3], new Set([2]));
  expect(order).toEqual([1, 2, 3]);
  expect(moves).toEqual([[2, 3]]);
});

test("a search's points fold under the shown one nearest, which nests under the base", () => {
  const { shown } = candidateRows([
    candidate(1),
    candidate(2, { parent: 1, foldedUnder: 4 }),
    candidate(3, { parent: 1, foldedUnder: null }),
    candidate(4, { parent: 1, foldedUnder: null }),
    candidate(5, { parent: 1, foldedUnder: 3 }),
    // A nudge of a folded point folds with it.
    candidate(6, { parent: 5 }),
    candidate(7, { parent: 1 }),
  ]);
  expect(shown.map(({ id, depth, foldedUnder }) => [id, depth, foldedUnder])).toEqual([
    [1, 0, null],
    [3, 1, null],
    [5, 2, 3],
    [6, 3, 3],
    [4, 1, null],
    [2, 2, 4],
    [7, 1, null],
  ]);
});

test("points folded under a hidden shown point stay in the table, under their own parent", () => {
  const { shown, hidden } = candidateRows([
    candidate(1),
    candidate(2, { parent: 1, foldedUnder: null, hidden: true }),
    candidate(3, { parent: 1, foldedUnder: 2 }),
    candidate(4, { parent: 1, foldedUnder: 9 }), // a shown point that isn't in the table
  ]);
  expect(hidden).toEqual([2]);
  expect(shown.map(({ id, depth, foldedUnder }) => [id, depth, foldedUnder])).toEqual([
    [1, 0, null],
    [3, 1, null],
    [4, 1, null],
  ]);
  expect(foldedOut(shown, new Set(), new Set())).toEqual(new Set());
});

test("a closed fold hides its rows except an open fold's and a held row", () => {
  const { shown } = candidateRows([
    candidate(1),
    candidate(2, { parent: 1, foldedUnder: null }),
    candidate(3, { parent: 1, foldedUnder: 2 }),
    candidate(4, { parent: 1, foldedUnder: 2 }),
    candidate(5, { parent: 1, foldedUnder: null }),
    candidate(6, { parent: 1, foldedUnder: 5 }),
  ]);
  expect(foldedOut(shown, new Set(), new Set())).toEqual(new Set([3, 4, 6]));
  // A playing or in-use row stays in sight, as a held row keeps its place.
  expect(foldedOut(shown, new Set(), new Set([4]))).toEqual(new Set([3, 6]));
  expect(foldedOut(shown, new Set([5]), new Set())).toEqual(new Set([3, 4]));
});

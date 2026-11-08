// The map of a brief's candidates (decision 0057): each excerpt in the cell its descriptors
// name, the elite by search score or, with no model, by fewest range misses and then the
// newest; ends from the brief's range or the excerpts' percentiles; coverage from the cells.
/** @import { ArchiveEntry } from "../../src/domain/build-archive.js" */
import { expect, test } from "vitest";
import {
  archiveCoverage,
  axisEnds,
  besideEmpty,
  buildArchive,
  END_PERCENTILES,
} from "../../src/domain/build-archive.js";

const AXES = [
  { bins: 4, low: 0, high: 4 },
  { bins: 2, low: 10, high: 20 },
];

/**
 * @param {number} candidateId
 * @param {number[]} values
 * @param {Partial<ArchiveEntry>} [rest]
 * @returns {ArchiveEntry}
 */
const entry = (candidateId, values, rest = {}) => ({
  candidateId,
  createdAt: candidateId,
  values,
  score: null,
  misses: 0,
  ...rest,
});

test("scripted candidates land in their cells, values past an end in its edge cell", () => {
  const archive = buildArchive(AXES, [
    entry(1, [0.5, 11]),
    entry(2, [3.99, 19]),
    entry(3, [-7, 25]),
    entry(4, [4, 15]),
  ]);
  expect(archive.shape).toEqual([4, 2]);
  expect(archive.total).toBe(8);
  expect(archive.cells.map(({ index, elite }) => [index, elite.candidateId])).toEqual([
    [[0, 0], 1],
    [[0, 1], 3],
    [[3, 1], 4],
  ]);
  // 4 is the axis's high end, which the last bin holds, and the newer of the two misses none.
  expect(archive.cells.find(({ index }) => index.join() === "3,1")?.count).toBe(2);
});

test("with a model the elite is the best by search score, whatever its misses", () => {
  const archive = buildArchive(AXES, [
    entry(1, [1, 11], { score: 0.2, misses: 0 }),
    entry(2, [1, 11], { score: 0.9, misses: 3 }),
    entry(3, [1, 11], { score: 0.5, misses: 0 }),
  ]);
  expect(archive.cells[0]?.elite.candidateId).toBe(2);
  expect(archive.cells[0]?.count).toBe(3);
});

test("with no model the elite has the fewest range misses, then is the newest", () => {
  const archive = buildArchive(AXES, [
    entry(1, [1, 11], { misses: 1 }),
    entry(2, [1, 11], { misses: 0, createdAt: 5 }),
    entry(3, [1, 11], { misses: 0, createdAt: 9 }),
    entry(4, [1, 11], { misses: 2, createdAt: 20 }),
  ]);
  expect(archive.cells[0]?.elite.candidateId).toBe(3);
});

test("an excerpt the model scored beats one it couldn't, as one with no sound analysis", () => {
  const archive = buildArchive(AXES, [
    entry(1, [1, 11], { score: null, misses: 0, createdAt: 9 }),
    entry(2, [1, 11], { score: -3, misses: 4, createdAt: 1 }),
  ]);
  expect(archive.cells[0]?.elite.candidateId).toBe(2);
});

test("an axis's ends come from the brief's range, an open end from the excerpts' percentiles", () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  expect(END_PERCENTILES).toEqual([10, 90]);
  expect(axisEnds(values, [2.5, 7.5])).toEqual({ low: 2.5, high: 7.5 });
  expect(axisEnds(values, [null, 7.5])).toEqual({ low: 1, high: 7.5 });
  expect(axisEnds(values, [4, null])).toEqual({ low: 4, high: 9 });
  expect(axisEnds(values, null)).toEqual({ low: 1, high: 9 });
});

test("an axis whose excerpts read alike, or that has none, has no ends", () => {
  expect(axisEnds([3, 3, 3], null)).toBeNull();
  expect(axisEnds([], null)).toBeNull();
  expect(axisEnds([], [1, 2])).toEqual({ low: 1, high: 2 });
  expect(axisEnds([5, 6], [7, null])).toBeNull();
});

test("coverage is filled cells over cells, and the fill starts only from elites beside an empty cell", () => {
  const axes = [
    { bins: 2, low: 0, high: 2 },
    { bins: 2, low: 0, high: 2 },
  ];
  const archive = buildArchive(axes, [
    entry(1, [0.5, 0.5]),
    entry(2, [1.5, 0.5]),
    entry(3, [0.5, 1.5]),
  ]);
  expect(archiveCoverage(archive)).toBe(3 / 4);
  // Cell [1, 1] is the empty one: 2 and 3 are beside it, 1 only diagonally.
  expect(besideEmpty(archive)).toEqual([
    { eliteId: 3, from: [0, 1], to: [1, 1], axis: 0, sign: 1 },
    { eliteId: 2, from: [1, 0], to: [1, 1], axis: 1, sign: 1 },
  ]);
  const full = buildArchive(axes, [
    ...[0.5, 1.5].flatMap((x) => [entry(9, [x, 0.5]), entry(8, [x, 1.5])]),
  ]);
  expect(archiveCoverage(full)).toBe(1);
  expect(besideEmpty(full)).toEqual([]);
});

test("a map over the cell limit, or with one axis, is refused", () => {
  expect(() =>
    buildArchive(
      [
        { bins: 17, low: 0, high: 1 },
        { bins: 16, low: 0, high: 1 },
      ],
      [],
    ),
  ).toThrow(/256 cells/);
  expect(() => buildArchive([{ bins: 8, low: 0, high: 1 }], [])).toThrow(/two or three axes/);
});

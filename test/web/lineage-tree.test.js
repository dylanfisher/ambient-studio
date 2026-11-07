import { expect, test } from "vitest";
import { lineageTree } from "../../src/web/lineage-tree.js";

/**
 * @param {number} id
 * @param {unknown[]} [parentIds]
 */
const node = (id, parentIds = []) => ({ id, parentIds });

/**
 * The tree as nested ids, for comparing.
 * @param {ReturnType<typeof lineageTree>} branches
 * @returns {unknown[]}
 */
const ids = (branches) =>
  branches.map(({ node: { id }, children, parentMissing }) =>
    children.length === 0 && parentMissing === null
      ? id
      : { id, ...(parentMissing !== null && { parentMissing }), children: ids(children) },
  );

test("nests each node under its first parent, in the order given, over three generations", () => {
  const tree = lineageTree([
    node(1),
    node(2, [1]),
    node(3),
    node(4, [2]),
    node(5, [1]),
    node(6, [4]),
  ]);
  expect(ids(tree)).toEqual([
    {
      id: 1,
      children: [{ id: 2, children: [{ id: 4, children: [6] }] }, 5],
    },
    3,
  ]);
});

test("a node whose parent isn't listed is a root that names its parent", () => {
  const tree = lineageTree([node(2, [9]), node(3, [2])]);
  expect(ids(tree)).toEqual([{ id: 2, parentMissing: 9, children: [3] }]);
});

test("a parent listed after its child doesn't take it, so no loop can form", () => {
  const tree = lineageTree([node(1, [2]), node(2, [1])]);
  expect(ids(tree)).toEqual([{ id: 1, parentMissing: 2, children: [2] }]);
});

test("an empty list is an empty tree", () => {
  expect(lineageTree([])).toEqual([]);
});

// A vibe's lineage as a tree (decision 0039): each node under its first parent, so the lineage
// page can draw it as nested lists. No DOM, so the nesting is tested on its own.

/** @typedef {{ id: number, parentIds: readonly unknown[] }} LineageNode */

/**
 * @template {LineageNode} N
 * @typedef {object} Branch
 * @property {N} node
 * @property {Branch<N>[]} children in the order the nodes were given
 * @property {number | null} parentMissing the parent of a root that has one, which isn't in
 *   the list (removed, or made outside a session); null for a root with none, and for a child
 */

/**
 * Nests each node under its first parent. A parent must come before its children, as it does
 * in the route's id order, since a candidate is made after its base; a node whose parent isn't
 * listed before it is a root, so the tree can't loop.
 * @template {LineageNode} N
 * @param {readonly N[]} nodes oldest first
 * @returns {Branch<N>[]} the roots
 */
export function lineageTree(nodes) {
  /** @type {Map<number, Branch<N>>} */
  const branches = new Map();
  /** @type {Branch<N>[]} */
  const roots = [];
  for (const node of nodes) {
    const [first] = node.parentIds;
    const parentId = typeof first === "number" ? first : null;
    const parent = parentId === null ? undefined : branches.get(parentId);
    /** @type {Branch<N>} */
    const branch = { node, children: [], parentMissing: parent ? null : parentId };
    if (parent) parent.children.push(branch);
    else roots.push(branch);
    branches.set(node.id, branch);
  }
  return roots;
}

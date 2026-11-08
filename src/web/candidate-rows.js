// The order and nesting of the session table's rows (decision 0049): each candidate under the
// one it was made from, so lineage shows at a glance, and the hidden ones apart. A revised pair
// (0036) is one place in the table, since the page shows one of the two: its members sit side
// by side and a child of either nests under both. In a ranked session (0046) the roots follow
// their places in the ranking, a pair by its better member's, and the unranked come after in
// the order given; children stay under their parent in the order given, so lineage still reads.
// A search's points (0054) nest under the shown point each folds under, and the page closes them
// until the owner opens that point's fold. No DOM, so the layout is tested on its own.
import { lineageTree } from "./lineage-tree.js";

/**
 * @typedef {object} RowCandidate
 * @property {number} id
 * @property {readonly unknown[]} parentIds
 * @property {{ firstTryId: number, revisionId: number } | null} pair
 * @property {boolean} hidden
 * @property {{ slot: number } | null} [ranking] its excerpt's place in the shown order
 * @property {{ foldedUnder: number | null } | null} [search] a search point's place: the shown
 *   point it folds under, or null when it is shown
 */

/**
 * A row of the table.
 * @typedef {object} CandidateRow
 * @property {number} id
 * @property {number} depth 0 for a root
 * @property {number | null} parentMissing the parent of a root that has one, which isn't in the
 *   table: hidden, or of another session; null otherwise
 * @property {number | null} foldedUnder the shown search point whose fold holds the row, itself
 *   or one it was made from; null for a row no fold holds
 */

/**
 * The nodes with each after its parent, as `lineageTree` needs: a search point can fold under a
 * shown point made after it. A node waits for a listed parent and follows it at once; the rest
 * keep their order.
 * @param {readonly { id: number, parentIds: number[] }[]} nodes
 */
function parentsFirst(nodes) {
  const listed = new Set(nodes.map(({ id }) => id));
  /** @type {Set<number>} */
  const placed = new Set();
  /** @type {Map<number, typeof nodes[number][]>} */
  const waiting = new Map();
  /** @type {typeof nodes[number][]} */
  const ordered = [];
  /** @param {typeof nodes[number]} node */
  const place = (node) => {
    ordered.push(node);
    placed.add(node.id);
    const next = waiting.get(node.id) ?? [];
    waiting.delete(node.id);
    for (const child of next) place(child);
  };
  for (const node of nodes) {
    const [parent] = node.parentIds;
    if (parent !== undefined && listed.has(parent) && !placed.has(parent)) {
      waiting.set(parent, [...(waiting.get(parent) ?? []), node]);
    } else place(node);
  }
  // A node whose parent never came, which a loop of parents would leave, keeps its place last.
  for (const left of waiting.values()) ordered.push(...left);
  return ordered;
}

/**
 * Lays out the session's candidates. A parent comes before its children, as in the route's id
 * order. A revised pair is hidden whole when either member is, so the page never shows half of
 * one; a child of a hidden candidate stays in the table as a root that names it.
 * @param {readonly RowCandidate[]} candidates oldest first
 * @returns {{ shown: CandidateRow[], hidden: number[] }} `hidden` in the order given
 */
export function candidateRows(candidates) {
  /** @param {RowCandidate} candidate the id of the place it takes */
  const placeOf = (candidate) => candidate.pair?.firstTryId ?? candidate.id;
  /** @type {Map<number, number>} each candidate's place, by id */
  const places = new Map(candidates.map((candidate) => [candidate.id, placeOf(candidate)]));
  /** @type {Map<number, number>} each folded search point's place, by the place it folds under */
  const folds = new Map();
  /** @type {Map<number, RowCandidate[]>} each place's members, in the order given */
  const members = new Map();
  for (const candidate of candidates) {
    const place = placeOf(candidate);
    members.set(place, [...(members.get(place) ?? []), candidate]);
  }
  const hiddenPlaces = new Set(
    [...members].filter(([, list]) => list.some((c) => c.hidden)).map(([place]) => place),
  );

  const nodes = [...members]
    .filter(([place]) => !hiddenPlaces.has(place))
    .map(([place, list]) => {
      const lead = /** @type {RowCandidate} */ (list[0]);
      const [first] = lead.parentIds;
      const under = lead.search?.foldedUnder ?? null;
      if (under !== null) folds.set(place, places.get(under) ?? under);
      const from = under ?? first;
      const parent = typeof from === "number" ? (places.get(from) ?? from) : null;
      return { id: place, parentIds: parent === null ? [] : [parent] };
    });

  /** @type {CandidateRow[]} */
  const shown = [];
  /**
   * @param {ReturnType<typeof lineageTree<{ id: number, parentIds: number[] }>>} branches
   * @param {number} depth
   * @param {number | null} held the fold holding these branches, if any
   */
  const walk = (branches, depth, held) => {
    for (const { node, children, parentMissing } of branches) {
      const foldedUnder = held ?? folds.get(node.id) ?? null;
      for (const { id } of members.get(node.id) ?? []) {
        shown.push({ id, depth, parentMissing, foldedUnder });
      }
      walk(children, depth + 1, foldedUnder);
    }
  };
  /** @param {number} place the best slot of its members; unranked places sort last */
  const slotOf = (place) =>
    Math.min(...(members.get(place) ?? []).map((c) => c.ranking?.slot ?? Number.POSITIVE_INFINITY));
  // `sort` is stable, so unranked roots, and roots of an unranked session, keep their order.
  const roots = lineageTree(parentsFirst(nodes)).sort(
    (x, y) => slotOf(x.node.id) - slotOf(y.node.id) || 0,
  );
  walk(roots, 0, null);
  const hidden = candidates.filter((c) => hiddenPlaces.has(placeOf(c))).map((c) => c.id);
  return { shown, hidden };
}

/**
 * Where each row of one table goes, without moving a held row: one whose excerpt plays or that
 * `card-hold.js` holds. Safari pauses an `<audio>` and blurs a field taken out of the page, even
 * for a move, so a held row keeps its place among the rows that stay and the rest take the
 * wanted order around it. A held row leaving the table, as a hide sends it, still leaves.
 * @param {readonly number[]} current the table's rows now, in order
 * @param {readonly number[]} wanted the order `candidateRows` gives
 * @param {ReadonlySet<number>} held
 * @returns {{ order: number[], moves: [number, number | null][] }} the order the table takes,
 *   and the moves that make it, each a row and the row it goes before (null for last), in turn
 */
export function rowPlacement(current, wanted, held) {
  const wantedSet = new Set(wanted);
  const staying = current.filter((id) => wantedSet.has(id));
  /** @type {(number | undefined)[]} */
  const order = new Array(wanted.length);
  for (const [index, id] of staying.entries()) if (held.has(id)) order[index] = id;
  const fixed = new Set(order);
  const free = wanted.filter((id) => !fixed.has(id));
  for (let i = 0; i < order.length; i++) order[i] ??= free.shift();
  const placed = /** @type {number[]} */ (order);

  // From the end, each row that isn't already before the one after it moves there; a held row
  // in the table never moves, and becomes the one the next row goes before. A row coming from
  // the other table always moves in, held or not, as Show again sends it.
  const rows = [...current];
  /** @type {[number, number | null][]} */
  const moves = [];
  /** @type {number | null} */
  let next = null;
  for (const id of [...placed].reverse()) {
    const at = rows.indexOf(id);
    if (at < 0 || (!held.has(id) && (rows[at + 1] ?? null) !== next)) {
      if (at >= 0) rows.splice(at, 1);
      rows.splice(next === null ? rows.length : rows.indexOf(next), 0, id);
      moves.push([id, next]);
    }
    next = id;
  }
  return { order: placed, moves };
}

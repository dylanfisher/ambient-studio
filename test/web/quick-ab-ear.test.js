// Quick A/B's search-by-ear mode (decision 0055), over a fake fetch: a choice is saved as the
// other modes save one and then told to the search, whose reply holds the next pair; a skip is
// saved and told the same way; a choice that failed to save is told nothing; Undo takes nothing
// back; a search still drawing its pair is read again until it asks.
import { afterEach, expect, test, vi } from "vitest";
import { abRatingBody } from "../../src/web/ab-rating.js";
import { createEarSession, NO_UNDO } from "../../src/web/quick-ab-ear.js";

const SESSION = "/api/sessions/5";
const EAR = `${SESSION}/ear-search`;

/** @param {number} id */
const playable = (id) => ({
  id,
  genomeId: 100 + id,
  seed: 7,
  excerpt: { renderId: 200 + id, url: `/audio/${200 + id}`, duration: 25 },
});

/**
 * The search's state at `query`, with `best` against `challenger`.
 * @param {number} query
 * @param {number} best
 * @param {number} challenger
 * @param {Partial<{ phase: string, stopped: boolean }>} [more]
 */
const asking = (query, best, challenger, more = {}) => ({
  phase: "asking",
  query,
  budget: 20,
  answered: query,
  best: playable(best),
  challenger: playable(challenger),
  stopped: false,
  error: null,
  ...more,
});

/**
 * @typedef {{ status: number, body: unknown }} Reply
 * @typedef {{ method: string, path: string, body: any }} Call
 */

/** @param {(call: Call) => Reply | undefined} answer */
function stubServer(answer) {
  /** @type {Call[]} */
  const calls = [];
  vi.stubGlobal("fetch", async (/** @type {string} */ path, /** @type {RequestInit} */ init) => {
    const call = {
      method: init.method ?? "GET",
      path,
      body: init.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const reply = answer(call);
    if (!reply) throw new Error(`no reply scripted for ${call.method} ${path}`);
    return {
      ok: reply.status < 300,
      status: reply.status,
      text: async () => JSON.stringify(reply.body),
    };
  });
  return calls;
}

const ok = (/** @type {unknown} */ body) => ({ status: 200, body });
const PAIR = { a: 201, b: 202, orderSeed: 3, leftSide: "b" };
const PLAYED = { left: 0.75, right: 0.5 };

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A server whose search asks `first` and answers each told choice with `next`.
 * @param {{ first: unknown[], next?: unknown, rating?: (call: Call) => Reply }} script `first`
 *   holds the states the search reads as before it asks, in turn
 */
function server({ first, next, rating = () => ok({ id: 41 }) }) {
  const reads = [...first];
  return stubServer((call) => {
    if (call.path === SESSION) return ok({ id: 5, vibeId: 9 });
    if (call.path === EAR) return ok(reads.length > 1 ? reads.shift() : reads[0]);
    if (call.path === `${SESSION}/ab-pairs`) {
      return ok({ ...PAIR, a: call.body.a, b: call.body.b });
    }
    if (call.path === `${SESSION}/ab-ratings`) return rating(call);
    if (call.path === `${EAR}/answers`) return ok(next);
    if (call.path === `${EAR}/stop`)
      return ok({ ...asking(0, 1, 2), phase: "done", stopped: true });
    return undefined;
  });
}

async function started() {
  let clock = 1000;
  const session = createEarSession({
    sessionId: 5,
    now: () => clock++,
    pause: async () => {},
    onChange: () => {},
  });
  await session.load();
  return session;
}

/** @param {Call[]} calls @param {string} path */
const posts = (calls, path) => calls.filter((c) => c.method === "POST" && c.path === path);

test("a choice is an ordinary A/B rating, then told to the search, and the reply's pair shows", async () => {
  const calls = server({ first: [asking(0, 1, 2)], next: asking(1, 2, 3) });
  const session = await started();
  const view = session.view();
  expect(view).toMatchObject({ phase: "pair", champion: 1, mode: "champion", remaining: 20 });
  // leftSide b puts the new point, side b, on the left.
  expect(view.shown?.left.id).toBe(2);
  await session.choose("b", PLAYED);

  const [pairDraw] = posts(calls, `${SESSION}/ab-pairs`);
  expect(pairDraw?.body).toEqual({ a: 201, b: 202 });
  const [rating] = posts(calls, `${SESSION}/ab-ratings`);
  // The body the other modes send for the same pair and choice.
  expect(rating?.body).toEqual(abRatingBody(/** @type {any} */ (PAIR), "b", PLAYED, 1));
  expect(posts(calls, `${EAR}/answers`).map((c) => c.body)).toEqual([{ query: 0, ratingId: 41 }]);
  expect(session.view()).toMatchObject({ phase: "pair", champion: 2, remaining: 19 });
  expect(session.view().shown?.ids).toEqual([2, 3]);
  expect(session.unsaved()).toBe(false);
});

test("a skip is saved and told like any choice; the search reads it as nothing", async () => {
  const calls = server({ first: [asking(0, 1, 2)], next: asking(1, 1, 4) });
  const session = await started();
  await session.choose("skip", PLAYED);
  expect(posts(calls, `${SESSION}/ab-ratings`).map((c) => c.body.outcome)).toEqual(["skip"]);
  expect(posts(calls, `${EAR}/answers`)).toHaveLength(1);
  expect(session.view().shown?.ids).toEqual([1, 4]);
});

test("a choice that failed to save is told nothing, and the pair stays to choose again", async () => {
  const calls = server({
    first: [asking(0, 1, 2)],
    rating: () => ({ status: 409, body: { error: "session 5 has stopped" } }),
  });
  const session = await started();
  await session.choose("a", PLAYED);
  expect(posts(calls, `${EAR}/answers`)).toEqual([]);
  expect(session.view()).toMatchObject({ phase: "pair", saving: 0 });
  expect(session.view().message).toMatch(/wasn't saved: session 5 has stopped/);
});

test("Undo takes nothing back, and a search still drawing is read again until it asks", async () => {
  const preparing = { ...asking(0, 1, 2), phase: "preparing", challenger: null };
  const calls = server({ first: [preparing, preparing, asking(0, 1, 2)] });
  const session = await started();
  expect(calls.filter((c) => c.path === EAR)).toHaveLength(3);
  expect(session.view().phase).toBe("pair");
  await session.undo();
  expect(session.view().message).toBe(NO_UNDO);
  expect(posts(calls, `${SESSION}/ab-ratings`)).toEqual([]);
});

test("Stop ends the search, and the page shows it done", async () => {
  server({ first: [asking(0, 1, 2)] });
  const session = await started();
  await session.stop();
  expect(session.view()).toMatchObject({ phase: "done", shown: null, remaining: 0 });
});

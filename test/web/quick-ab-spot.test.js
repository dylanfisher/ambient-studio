// Quick A/B's spot-check mode (decision 0059), over a fake fetch: the session's pairs not yet
// rated are played in turn with the sides their stored seed drew, each choice is saved as an
// ordinary A/B rating in the pair's session with that seed, a pair already rated or with no
// excerpt is passed over, and a failed save keeps the pair.
import { afterEach, expect, test, vi } from "vitest";
import { abRatingBody } from "../../src/web/ab-rating.js";
import { PHASE } from "../../src/web/quick-ab-session.js";
import { createSpotSession, NO_SPOT_UNDO } from "../../src/web/quick-ab-spot.js";

const SESSION = "/api/sessions/5";

/** @param {number} id */
const playable = (id) => ({
  id,
  genomeId: 100 + id,
  seed: 7,
  excerpt: { renderId: 200 + id, url: `/audio/${200 + id}`, duration: 25 },
});

/**
 * A spot-check pair of candidates `a` (the search's) and `b`, sides from `orderSeed`.
 * @param {number} a
 * @param {number} b
 * @param {{ rated?: boolean, leftSide?: "a" | "b", playable?: boolean }} [more]
 */
const spot = (a, b, { rated = false, leftSide = "a", playable: ready = true } = {}) => ({
  evaluationId: 1,
  run: "run-1",
  rank: 1,
  rated,
  pair: ready ? { a: 200 + a, b: 200 + b, orderSeed: 1000 + a, leftSide } : null,
  a: ready ? playable(a) : null,
  b: ready ? playable(b) : null,
});

/** @typedef {{ method: string, path: string, body: any }} Call */

/**
 * @param {unknown[]} pairs
 * @param {(call: Call) => { status: number, body: unknown }} [rating]
 */
function server(pairs, rating = () => ({ status: 200, body: { id: 41 } })) {
  /** @type {Call[]} */
  const calls = [];
  vi.stubGlobal("fetch", async (/** @type {string} */ path, /** @type {RequestInit} */ init) => {
    const call = {
      method: init.method ?? "GET",
      path,
      body: init.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    const reply =
      path === SESSION
        ? { status: 200, body: { id: 5, vibeId: 9 } }
        : path === `${SESSION}/spot-checks`
          ? { status: 200, body: { sessionId: 5, stopped: false, pairs } }
          : path === `${SESSION}/ab-ratings`
            ? rating(call)
            : undefined;
    if (!reply) throw new Error(`no reply scripted for ${call.method} ${path}`);
    return {
      ok: reply.status < 300,
      status: reply.status,
      text: async () => JSON.stringify(reply.body),
    };
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const PLAYED = { left: 0.75, right: 0.5 };

test("each pair not yet rated plays with its stored sides and saves in the pair's session with its seed", async () => {
  const pairs = [
    spot(1, 2, { rated: true }),
    spot(3, 4, { leftSide: "b" }),
    spot(5, 6, { playable: false }),
    spot(7, 8),
  ];
  const calls = server(pairs);
  let clock = 0;
  const session = createSpotSession({ sessionId: 5, now: () => clock, onChange: () => {} });
  await session.load();
  const first = session.view();
  expect(first.phase).toBe(PHASE.pair);
  expect(first.spot).toEqual({ total: 4, rated: 1, missing: 1, stopped: false });
  expect(first.remaining).toBe(2);
  // The seed put side b, the control, on the left.
  expect(first.shown).toMatchObject({ left: { id: 4 }, right: { id: 3 }, ids: [3, 4] });

  clock = 1500;
  await session.choose("a", PLAYED);
  const saved = calls.filter((c) => c.path === `${SESSION}/ab-ratings`);
  expect(saved).toEqual([
    {
      method: "POST",
      path: `${SESSION}/ab-ratings`,
      body: abRatingBody(/** @type {any} */ (pairs[1]).pair, "a", PLAYED, 1500),
    },
  ]);
  expect(saved[0]?.body).toMatchObject({ a: 203, b: 204, orderSeed: 1003 });
  expect(session.view().shown).toMatchObject({ left: { id: 7 }, right: { id: 8 } });
  expect(session.view().message).toBe("Pair 2: right was better.");

  await session.choose("tie", PLAYED);
  const done = session.view();
  expect(done.phase).toBe(PHASE.done);
  expect(done.shown).toBeNull();
  expect(done.spot).toMatchObject({ rated: 3, missing: 1 });
});

test("a failed save keeps the pair to choose again, and undo takes nothing back", async () => {
  server([spot(1, 2)], () => ({ status: 409, body: { error: "session 5 has stopped" } }));
  const session = createSpotSession({ sessionId: 5, now: () => 0, onChange: () => {} });
  await session.load();
  await session.choose("b", PLAYED);
  expect(session.view().message).toBe(
    "Your choice on pair 1 wasn't saved: session 5 has stopped Choose again.",
  );
  expect(session.view().shown).toMatchObject({ ids: [1, 2] });
  await session.undo();
  expect(session.view().message).toBe(NO_SPOT_UNDO);
});

test("a stopped session shows no pair", async () => {
  vi.stubGlobal("fetch", async (/** @type {string} */ path) => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify(
        path === SESSION
          ? { id: 5, vibeId: 9 }
          : { sessionId: 5, stopped: true, pairs: [spot(1, 2)] },
      ),
  }));
  const session = createSpotSession({ sessionId: 5, now: () => 0, onChange: () => {} });
  await session.load();
  expect(session.view()).toMatchObject({ phase: PHASE.done, shown: null, spot: { stopped: true } });
});

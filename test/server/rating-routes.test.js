// Ratings through the HTTP routes (decision 0027): every kind stored with what was heard, kept
// as rated audio, and read back after a restart (phase 2's acceptance 4); A/B order from the
// logged seed.
/** @import { Studio } from "../support/studio.js" */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { AB_ORDER_SEEDS, abOrder } from "../../src/domain/ab-order.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import { addFeedback, listRatedAudio, listRatedGenomes } from "../../src/server/rating-store.js";
import { getRender, putRender } from "../../src/server/render-store.js";
import { MAX_CHARS, MAX_TAGS } from "../../src/server/request-fields.js";
import { GENOMES, removeStudio, startStudio } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

/** Draws the test sets before each call that takes one; 0.25 once they run out. */
const draws = /** @type {number[]} */ ([]);

/** A session on a vibe with two rendered candidates. */
async function setup() {
  draws.length = 0;
  const studio = await startStudio({ random: () => draws.shift() ?? 0.25 });
  studios.push(studio);
  const { vibe, session } = await studio.openSession();
  await studio.generate(session.id, GENOMES);
  const { candidates } = await studio.ok("GET", `/api/sessions/${session.id}/candidates`);
  const [one, two] = candidates;
  return { ...studio, vibe, session, one, two };
}

/** The first seed from 0 whose order is `side`. */
const seedFor = (/** @type {"a" | "b"} */ side) => {
  let seed = 0;
  while (abOrder(seed) !== side) seed++;
  return seed;
};

describe("ratings", () => {
  test("every kind is stored and read back after the server restarts", async () => {
    const { server, ok, vibe, session, one, two } = await setup();
    const at = `/api/sessions/${session.id}`;
    const r1 = one.excerpt.renderId;
    const r2 = two.excerpt.renderId;
    const note = await ok("POST", `/api/vibes/${vibe.id}/notes`, { text: "less shimmer" });
    const up = await ok("POST", `${at}/thumbs`, {
      renderId: r1,
      direction: "up",
      note: "warm and slow",
      playedFraction: 0.8,
      timeTakenMs: 4200,
    });
    const down = await ok("POST", `${at}/thumbs`, {
      renderId: r2,
      direction: "down",
      playedFraction: 0.3,
      timeTakenMs: 2100,
    });
    const more = await ok("POST", `${at}/macro-feedback`, {
      renderId: r1,
      macro: "brightness",
      direction: "more",
      playedFraction: 1,
      timeTakenMs: 6000,
    });
    /** @type {any[]} */
    const ratings = [];
    for (const outcome of ["a", "tie", "skip"]) {
      const pair = await ok("POST", `${at}/ab-pairs`, { a: r1, b: r2 });
      ratings.push(
        await ok("POST", `${at}/ab-ratings`, {
          a: pair.a,
          b: pair.b,
          orderSeed: pair.orderSeed,
          outcome,
          aPlayedFraction: 0.9,
          bPlayedFraction: 0.6,
          timeTakenMs: 9000,
        }),
      );
    }
    const sketch = await ok("POST", `${at}/sketches`, {
      candidateId: one.id,
      renderId: r1,
      notes: "keep the slow swell",
      tags: ["cold", "slow"],
    });

    expect(up).toMatchObject({ kind: "thumbs", note: "warm and slow", genomeId: one.genomeId });
    expect(up).toMatchObject({ seed: one.seed, offset: one.excerpt.offset, duration: 25 });
    expect(up).toMatchObject({ engineVersion: ENGINE_VERSION, sessionId: session.id });
    expect(up.vibeRevisionId).toBe(vibe.revision.id);
    expect(down.note).toBeNull();
    expect(more).toMatchObject({ kind: "macro", macro: "brightness", direction: "more" });
    expect(more.macroValue).toEqual({ min: 0.7, max: 0.7, mean: expect.closeTo(0.7, 12) });
    expect(ratings.map((r) => r.outcome)).toEqual(["a", "tie", "skip"]);
    expect(ratings[0].a).toMatchObject({ genomeId: one.genomeId, playedFraction: 0.9 });
    expect(ratings[0].b).toMatchObject({ genomeId: two.genomeId, playedFraction: 0.6 });
    expect(ratings[0].a).toMatchObject({ rank: null, score: null, wildcard: null });

    await server.restart();
    const after = await ok("GET", `/api/vibes/${vibe.id}/ratings`);
    expect(after.feedback).toEqual([up, down, more]);
    expect(after.ratings).toEqual(ratings);
    expect(after.sketches).toEqual([sketch]);
    expect((await ok("GET", `/api/vibes/${vibe.id}`)).notes).toEqual([note]);
  });

  test("the A/B route stores the order abOrder gives for its logged seed", async () => {
    const { server, ok, session, one, two } = await setup();
    const at = `/api/sessions/${session.id}`;
    for (const side of /** @type {const} */ (["a", "b"])) {
      const seed = seedFor(side);
      draws.push(seed / AB_ORDER_SEEDS);
      const pair = await ok("POST", `${at}/ab-pairs`, {
        a: one.excerpt.renderId,
        b: two.excerpt.renderId,
      });
      expect(pair).toMatchObject({ orderSeed: seed, leftSide: side });
      const rating = await ok("POST", `${at}/ab-ratings`, {
        a: pair.a,
        b: pair.b,
        orderSeed: pair.orderSeed,
        outcome: "b",
        aPlayedFraction: 1,
        bPlayedFraction: 1,
        timeTakenMs: 3000,
      });
      expect(rating).toMatchObject({ orderSeed: seed, leftSide: side });
    }
    const pair = { a: one.excerpt.renderId, b: one.excerpt.renderId };
    expect((await server.api("POST", `${at}/ab-pairs`, pair)).status).toBe(400);
  });

  test("a rating writes one rated_audio row whose file exists, reused by the next", async () => {
    const { server, ok, session, one } = await setup();
    const at = `/api/sessions/${session.id}`;
    const thumbs = {
      renderId: one.excerpt.renderId,
      direction: "up",
      playedFraction: 0.5,
      timeTakenMs: 1000,
    };
    expect(listRatedAudio(server.store)).toEqual([]);
    const first = await ok("POST", `${at}/thumbs`, thumbs);
    const rows = listRatedAudio(server.store);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first.ratedAudioId);
    expect(existsSync(join(server.paths.ratedAudio, /** @type {any} */ (rows[0]).file))).toBe(true);
    await ok("POST", `${at}/thumbs`, { ...thumbs, direction: "down" });
    expect(listRatedAudio(server.store)).toHaveLength(1);
  });

  test("a refused rating keeps no rated audio and stores no row", async () => {
    const { server, ok, vibe, session, one, two } = await setup();
    const at = `/api/sessions/${session.id}`;
    const thumbs = { renderId: one.excerpt.renderId, direction: "up", timeTakenMs: 1000 };
    for (const playedFraction of [-0.1, 1.5, "half"]) {
      const reply = await server.api("POST", `${at}/thumbs`, { ...thumbs, playedFraction });
      expect(reply.status).toBe(400);
      expect(reply.json().error).toMatch(/^playedFraction must be a number from 0 to 1/);
    }
    const macro = await server.api("POST", `${at}/macro-feedback`, {
      renderId: one.excerpt.renderId,
      macro: "sparkle",
      direction: "more",
      playedFraction: 1,
      timeTakenMs: 1,
    });
    expect(macro.status).toBe(400);
    expect(macro.json().error).toMatch(/^macro must be one of brightness/);
    const ab = await server.api("POST", `${at}/ab-ratings`, {
      a: one.excerpt.renderId,
      b: two.excerpt.renderId,
      orderSeed: 3,
      outcome: "draw",
      aPlayedFraction: 1,
      bPlayedFraction: 1,
      timeTakenMs: 1,
    });
    expect(ab.status).toBe(400);
    expect(listRatedAudio(server.store)).toEqual([]);
    const stored = await ok("GET", `/api/vibes/${vibe.id}/ratings`);
    expect(stored).toEqual({ ratings: [], feedback: [], sketches: [] });
  });

  test("a note, a sketch's notes or its tags past their limits are 400s naming them", async () => {
    const { server, ok, vibe, session, one } = await setup();
    const at = `/api/sessions/${session.id}`;
    const renderId = one.excerpt.renderId;
    const longNote = "x".repeat(MAX_CHARS.note + 1);
    const thumbs = await server.api("POST", `${at}/thumbs`, {
      renderId,
      direction: "up",
      note: longNote,
      playedFraction: 1,
      timeTakenMs: 1,
    });
    expect(thumbs.status).toBe(400);
    expect(thumbs.json().error).toBe(
      `note must be at most ${MAX_CHARS.note} characters, got ${MAX_CHARS.note + 1}`,
    );
    const sketch = { candidateId: one.id, renderId, notes: "", tags: ["cold"] };
    /** @type {[Record<string, unknown>, RegExp][]} */
    const refusals = [
      [{ notes: longNote }, /^notes must be at most \d+ characters/],
      [
        { tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`) },
        /^tags must hold at most/,
      ],
      [{ tags: ["x".repeat(MAX_CHARS.tag + 1)] }, /^tags\[0\] must be at most \d+ characters/],
    ];
    for (const [edit, message] of refusals) {
      const reply = await server.api("POST", `${at}/sketches`, { ...sketch, ...edit });
      expect(reply.status).toBe(400);
      expect(reply.json().error).toMatch(message);
    }
    const stored = await ok("GET", `/api/vibes/${vibe.id}/ratings`);
    expect(stored).toEqual({ ratings: [], feedback: [], sketches: [] });
    expect(listRatedAudio(server.store)).toEqual([]);
  });

  test("a render made by another producer is refused with a 409", async () => {
    const { server, session, one } = await setup();
    const render = /** @type {any} */ (getRender(server.store, one.excerpt.renderId));
    const { id, createdAt, ...draft } = render;
    const { render: stale } = putRender(server.store, { ...draft, producer: "engine-1 old" });
    const reply = await server.api("POST", `/api/sessions/${session.id}/thumbs`, {
      renderId: stale.id,
      direction: "up",
      playedFraction: 1,
      timeTakenMs: 1,
    });
    expect(reply.status).toBe(409);
    expect(reply.json().error).toMatch(/render the excerpt again/);
  });

  test("a stopped session takes no ratings", async () => {
    const { server, ok, session, one } = await setup();
    await ok("POST", `/api/sessions/${session.id}/stop`, {});
    const reply = await server.api("POST", `/api/sessions/${session.id}/thumbs`, {
      renderId: one.excerpt.renderId,
      direction: "up",
      playedFraction: 1,
      timeTakenMs: 1,
    });
    expect(reply.status).toBe(409);
  });
});

// One session with two rendered candidates serves every test here, since rendering them is most
// of a test's time. Each test uses its own candidate and macro, or thumbs on a candidate no
// other test gives thumbs, so none sees another's rows.
describe("undo and replace (0031)", () => {
  /** @type {Awaited<ReturnType<typeof setup>>} */
  let shared;
  beforeAll(async () => {
    shared = await setup();
    // afterEach removes the studios in the list; this one lasts until afterAll.
    studios.splice(studios.indexOf(shared), 1);
  });
  afterAll(() => removeStudio(shared));

  /**
   * Posts macro feedback or thumbs on `candidate`'s excerpt in the shared session.
   * @param {any} candidate
   */
  const poster = (candidate) => ({
    /** @param {"more" | "less"} direction @param {string} macro */
    macro: (direction, macro) =>
      shared.ok("POST", `/api/sessions/${shared.session.id}/macro-feedback`, {
        renderId: candidate.excerpt.renderId,
        macro,
        direction,
        playedFraction: 1,
        timeTakenMs: 1000,
      }),
    /** @param {"up" | "down"} direction */
    thumbs: (direction) =>
      shared.ok("POST", `/api/sessions/${shared.session.id}/thumbs`, {
        renderId: candidate.excerpt.renderId,
        direction,
        playedFraction: 1,
        timeTakenMs: 1000,
      }),
  });

  /**
   * The feedback rows with these ids, removed ones too, oldest first.
   * @param {...number} ids
   */
  const rows = (...ids) =>
    shared.server.store.db
      .prepare(
        `SELECT id, direction, removedReason FROM feedback WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY id`,
      )
      .all(...ids);

  /** The shared session's candidate with this id, as the list gives it. */
  const listed = async (/** @type {number} */ id) =>
    (await shared.ok("GET", `/api/sessions/${shared.session.id}/candidates`)).candidates.find(
      (/** @type {any} */ c) => c.id === id,
    );

  test("the other direction on a macro replaces the live row, marking the old one", async () => {
    const { one } = shared;
    const more = await poster(one).macro("more", "brightness");
    const less = await poster(one).macro("less", "brightness");
    expect(less.id).not.toBe(more.id);
    expect(rows(more.id, less.id)).toEqual([
      { id: more.id, direction: "more", removedReason: "replaced" },
      { id: less.id, direction: "less", removedReason: null },
    ]);
    // Another macro on the same candidate is its own state.
    const warmer = await poster(one).macro("more", "warmth");
    expect(rows(more.id, less.id, warmer.id)).toHaveLength(3);
    const { feedback } = await listed(one.id);
    expect(feedback.macros).toMatchObject({
      brightness: { id: less.id, direction: "less" },
      warmth: { id: warmer.id, direction: "more" },
    });
  });

  test("the same direction twice keeps one row and returns it", async () => {
    const { server, session, two } = shared;
    const before = server.store.db
      .prepare("SELECT COUNT(*) AS n FROM feedback WHERE sessionId = ?")
      .get(session.id)?.n;
    const first = await poster(two).macro("more", "density");
    expect(await poster(two).macro("more", "density")).toEqual(first);
    const up = await poster(two).thumbs("up");
    expect(await poster(two).thumbs("up")).toEqual(up);
    const after = server.store.db
      .prepare("SELECT COUNT(*) AS n FROM feedback WHERE sessionId = ?")
      .get(session.id)?.n;
    expect(Number(after) - Number(before)).toBe(2);
  });

  test("thumbs hold one live direction per candidate", async () => {
    const { server, ok, vibe, one } = shared;
    const up = await poster(one).thumbs("up");
    const down = await poster(one).thumbs("down");
    expect(rows(up.id, down.id).map((r) => r.removedReason)).toEqual(["replaced", null]);
    const { feedback } = await ok("GET", `/api/vibes/${vibe.id}/ratings`);
    expect(feedback.map((/** @type {any} */ f) => f.id)).not.toContain(up.id);
    // The replaced up counts for nothing: the genome scores -1, not 0 (0024).
    const scores = listRatedGenomes(server.store, vibe.id);
    expect(scores.find((s) => s.genomeId === one.genomeId)?.score).toBe(-1);
    expect((await listed(one.id)).feedback.thumbs).toEqual({
      id: down.id,
      direction: "down",
      note: null,
    });
  });

  test("remove marks the row undone, and removing it again changes nothing", async () => {
    const { server, ok, vibe, session, two } = shared;
    const more = await poster(two).macro("more", "motion");
    const path = `/api/sessions/${session.id}/feedback/${more.id}/remove`;
    const removed = await ok("POST", path, {});
    expect(removed).toMatchObject({ id: more.id, removedReason: "undone" });
    expect(removed.removedAt).toEqual(expect.any(Number));
    expect(await ok("POST", path, {})).toEqual(removed);
    const { feedback } = await ok("GET", `/api/vibes/${vibe.id}/ratings`);
    expect(feedback.map((/** @type {any} */ f) => f.id)).not.toContain(more.id);
    expect((await listed(two.id)).feedback.macros).not.toHaveProperty("motion");
    // The heard excerpt stays kept: the removed row still names it.
    expect(listRatedAudio(server.store).map((a) => a.id)).toContain(more.ratedAudioId);
    // After an undo the same direction is a new row.
    const again = await poster(two).macro("more", "motion");
    expect(again.id).not.toBe(more.id);
  });

  test("remove clears every live row of the candidate's kind and macro, as pre-2m data has two", async () => {
    const { server, ok, session, one, two } = shared;
    // setFeedback keeps one live row, so the second is planted directly.
    const plant = (/** @type {any} */ row, /** @type {string} */ direction) => {
      const { id, createdAt, removedAt, removedReason, ...draft } = row;
      return addFeedback(server.store, { ...draft, direction });
    };
    const more = await poster(one).macro("more", "tension");
    const less = plant(more, "less");
    const other = await poster(one).macro("more", "space");
    const up = await poster(two).thumbs("up");
    const down = plant(up, "down");
    const live = (/** @type {number[]} */ ids) =>
      rows(...ids)
        .filter((r) => r.removedReason === null)
        .map((r) => r.id);
    expect(live([more.id, less.id])).toHaveLength(2);

    await ok("POST", `/api/sessions/${session.id}/feedback/${more.id}/remove`, {});
    expect(live([more.id, less.id])).toEqual([]);
    expect(rows(more.id, less.id).map((r) => r.removedReason)).toEqual(["undone", "undone"]);
    // Another macro on the same candidate stays.
    expect(live([other.id])).toEqual([other.id]);
    expect((await listed(one.id)).feedback.macros).not.toHaveProperty("tension");

    await ok("POST", `/api/sessions/${session.id}/feedback/${down.id}/remove`, {});
    expect(live([up.id, down.id])).toEqual([]);
    expect((await listed(two.id)).feedback.thumbs).toBeNull();
    // The concurrent-posts test counts live rows of "space" across the session.
    await ok("POST", `/api/sessions/${session.id}/feedback/${other.id}/remove`, {});
  });

  test("an A/B rating can be removed, once", async () => {
    const { ok, vibe, session, one, two } = shared;
    const at = `/api/sessions/${session.id}`;
    const pair = await ok("POST", `${at}/ab-pairs`, {
      a: one.excerpt.renderId,
      b: two.excerpt.renderId,
    });
    const rating = await ok("POST", `${at}/ab-ratings`, {
      a: pair.a,
      b: pair.b,
      orderSeed: pair.orderSeed,
      outcome: "a",
      aPlayedFraction: 1,
      bPlayedFraction: 1,
      timeTakenMs: 1000,
    });
    const path = `${at}/ab-ratings/${rating.id}/remove`;
    const removed = await ok("POST", path, {});
    expect(removed).toMatchObject({ id: rating.id, outcome: "a", removedReason: "undone" });
    expect(await ok("POST", path, {})).toEqual(removed);
    const { ratings } = await ok("GET", `/api/vibes/${vibe.id}/ratings`);
    expect(ratings.map((/** @type {any} */ r) => r.id)).not.toContain(rating.id);
  });

  test("a row of another session, or none, is a 404", async () => {
    const { server, ok, vibe, session, two } = shared;
    const up = await poster(two).thumbs("up");
    const other = await ok("POST", `/api/vibes/${vibe.id}/sessions`, {});
    for (const path of [
      `/api/sessions/${other.id}/feedback/${up.id}/remove`,
      `/api/sessions/${session.id}/feedback/999999/remove`,
      `/api/sessions/${session.id}/ab-ratings/999999/remove`,
    ]) {
      expect((await server.api("POST", path, {})).status).toBe(404);
    }
  });

  test("two posts at once leave one live row", async () => {
    const { server, session, two } = shared;
    const body = (/** @type {string} */ direction) => ({
      renderId: two.excerpt.renderId,
      macro: "space",
      direction,
      playedFraction: 1,
      timeTakenMs: 1000,
    });
    const path = `/api/sessions/${session.id}/macro-feedback`;
    for (const directions of [
      ["more", "more"],
      ["less", "more"],
    ]) {
      const replies = await Promise.all(directions.map((d) => server.api("POST", path, body(d))));
      expect(replies.map((r) => r.status)).toEqual([200, 200]);
      const live = server.store.db
        .prepare(
          "SELECT id FROM feedback WHERE sessionId = ? AND macro = 'space' AND removedAt IS NULL",
        )
        .all(session.id);
      expect(live).toHaveLength(1);
    }
  });
});

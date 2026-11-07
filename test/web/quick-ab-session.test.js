// The Quick A/B page's logic (decision 0048), over a fake fetch: ratings saved one at a time in
// the background, a failed save kept on screen until Retry saves it, undo only after the server
// removed the rating, a pair whose sides couldn't be drawn waiting for Retry, and a mode switch
// that keeps the pair shown. Replies settle on microtasks, so nothing waits on real time.
import { afterEach, expect, test, vi } from "vitest";
import { createQuickAbSession, unloadGuard } from "../../src/web/quick-ab-session.js";

const SESSION = "/api/sessions/5";

/**
 * @param {number} id
 * @param {boolean} [hidden]
 */
const candidate = (id, hidden = false) => ({
  id,
  genomeId: 100 + id,
  seed: 7,
  excerpt: { renderId: 200 + id, url: `/audio/${200 + id}`, duration: 25 },
  hidden,
});

/**
 * @typedef {{ status: number, body: unknown }} Reply
 * @typedef {{ method: string, path: string, body: any }} Call
 */

/**
 * A fake server: `answer` gives each request's reply, or a promise of one to hold it.
 * @param {(call: Call) => Reply | Promise<Reply> | undefined} answer
 */
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
    const reply = await answer(call);
    if (!reply) throw new Error(`no reply scripted for ${call.method} ${path}`);
    return {
      ok: reply.status < 300,
      status: reply.status,
      text: async () => JSON.stringify(reply.body),
    };
  });
  return calls;
}

/** A held reply and the function that releases it. */
function held() {
  /** @type {(reply: Reply) => void} */
  let release = () => {};
  /** @type {Promise<Reply>} */
  const reply = new Promise((resolve) => {
    release = resolve;
  });
  return { reply, release };
}

/** Runs every queued microtask chain to its end. */
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

const ok = (/** @type {unknown} */ body) => ({ status: 200, body });
const fail = (/** @type {string} */ error) => ({ status: 500, body: { error } });

/**
 * The routes a load reads, the pair route, and whatever else `more` answers.
 * @param {{ ids?: number[], hidden?: number[], ratings?: unknown[], more?: (call: Call) => Reply | Promise<Reply> | undefined }} [options]
 */
function server({ ids = [1, 2, 3], hidden = [], ratings = [], more = () => undefined } = {}) {
  let seeds = 0;
  return stubServer((call) => {
    if (call.path === SESSION) return ok({ id: 5, vibeId: 9 });
    if (call.path === `${SESSION}/candidates`)
      return ok({ candidates: ids.map((id) => candidate(id, hidden.includes(id))) });
    if (call.path === "/api/vibes/9/ratings") return ok({ ratings });
    const custom = more(call);
    if (custom) return custom;
    if (call.path === `${SESSION}/ab-pairs`) {
      return ok({ ...call.body, orderSeed: seeds++, leftSide: "a" });
    }
    if (call.path === `${SESSION}/ab-ratings`) return ok({ id: 40 + seeds });
    return undefined;
  });
}

/**
 * @param {{ onChange?: () => void, onError?: (error: Error) => void }} [hooks]
 */
function made({
  onChange = () => {},
  onError = (error) => {
    throw error;
  },
} = {}) {
  return createQuickAbSession({
    sessionId: 5,
    random: () => 0,
    now: () => 1000,
    onChange,
    onError,
  });
}

async function started() {
  const session = made();
  await session.load();
  return session;
}

const PLAYED = { left: 0.5, right: 0.5 };
/** @param {Call[]} calls @param {string} path */
const posts = (calls, path) =>
  calls.filter((c) => c.method === "POST" && c.path === `${SESSION}${path}`);

afterEach(() => {
  vi.unstubAllGlobals();
});

test("ratings are saved one at a time while the next pair shows at once", async () => {
  const first = held();
  let n = 0;
  const calls = server({
    more: (call) => (call.path.endsWith("/ab-ratings") && n++ === 0 ? first.reply : undefined),
  });
  const session = await started();
  await session.choose("a", PLAYED);
  expect(session.view()).toMatchObject({ phase: "pair", saving: 1 });
  await session.choose("a", PLAYED);
  await flush();
  // The second waits for the first.
  expect(posts(calls, "/ab-ratings")).toHaveLength(1);
  expect(session.view().saving).toBe(2);
  expect(session.unsaved()).toBe(true);
  first.release(ok({ id: 1 }));
  await flush();
  expect(posts(calls, "/ab-ratings")).toHaveLength(2);
  expect(session.view()).toMatchObject({ saving: 0, failed: [] });
  expect(session.unsaved()).toBe(false);
});

test("a failed save stays on screen past the next choice, blocks leaving, and Retry saves it", async () => {
  let failing = true;
  const calls = server({
    more: (call) =>
      call.path.endsWith("/ab-ratings") && failing ? fail("the session has stopped") : undefined,
  });
  const session = await started();
  await session.choose("a", PLAYED);
  await flush();
  failing = false;
  await session.choose("b", PLAYED);
  await flush();
  const view = session.view();
  expect(view.message).toMatch(/^Chose /);
  expect(view.failed).toMatchObject([
    {
      said: expect.stringMatching(/^Candidate #\d over Candidate #\d$/),
      error: "the session has stopped",
    },
  ]);
  expect(session.unsaved()).toBe(true);
  const event = { preventDefault: vi.fn(), returnValue: "x" };
  unloadGuard(session)(/** @type {any} */ (event));
  expect(event.preventDefault).toHaveBeenCalled();

  await session.retry();
  await flush();
  expect(session.view().failed).toEqual([]);
  expect(session.unsaved()).toBe(false);
  const sent = posts(calls, "/ab-ratings");
  expect(sent.map(({ body }) => body.outcome)).toEqual(["a", "b", "a"]);
  expect(sent[2]?.body).toEqual(sent[0]?.body);
});

test("a pair whose rating failed to save doesn't count as rated once discarded", async () => {
  server({ more: (call) => (call.path.endsWith("/ab-ratings") ? fail("down") : undefined) });
  const session = await started();
  await session.setMode("random");
  expect(session.view().remaining).toBe(3);
  await session.choose("a", PLAYED);
  await flush();
  // Held out while its save waits for Retry or Discard.
  expect(session.view().remaining).toBe(2);
  await session.discard(/** @type {{ id: number }} */ (session.view().failed[0]).id);
  // Discarded, it was never saved, so its pair can be drawn again.
  expect(session.view().remaining).toBe(3);
});

test("undo keeps the rating, with the error shown, when the server can't remove it", async () => {
  /** @type {Reply} */
  let removing = fail("database is locked");
  const calls = server({
    more: (call) => (call.path.endsWith("/remove") ? removing : undefined),
  });
  const session = await started();
  const rated = session.view().shown?.ids;
  await session.choose("a", PLAYED);
  await flush();
  const next = session.view().shown?.ids;
  await session.undo();
  expect(session.view().undoError).toMatch(/couldn't be taken back: database is locked/);
  expect(session.view().shown?.ids).toEqual(next);
  expect(session.unsaved()).toBe(false);

  removing = ok({});
  await session.undo();
  expect(session.view()).toMatchObject({
    undoError: null,
    message: expect.stringMatching(/^Took back/),
  });
  expect(session.view().shown?.ids).toEqual(rated);
  expect(posts(calls, "/ab-ratings/41/remove")).toHaveLength(2);
});

test("undo of a rating that never saved removes nothing on the server", async () => {
  const calls = server({
    more: (call) => (call.path.endsWith("/ab-ratings") ? fail("down") : undefined),
  });
  const session = await started();
  const rated = session.view().shown?.ids;
  await session.choose("tie", PLAYED);
  await flush();
  await session.undo();
  expect(session.view()).toMatchObject({ failed: [], shown: { ids: rated } });
  expect(calls.some(({ path }) => path.endsWith("/remove"))).toBe(false);
  expect(session.unsaved()).toBe(false);
});

test("a pair whose sides couldn't be drawn takes no choice until Retry draws it", async () => {
  let refusing = true;
  const calls = server({
    more: (call) => (call.path.endsWith("/ab-pairs") && refusing ? fail("busy") : undefined),
  });
  const session = await started();
  expect(session.view()).toMatchObject({ phase: "pairFailed", shown: null });
  expect(session.view().pairError).toMatch(/couldn't be drawn: busy/);
  const pairBefore = calls.find((c) => c.path.endsWith("/ab-pairs"))?.body;
  await session.choose("a", PLAYED);
  expect(posts(calls, "/ab-ratings")).toEqual([]);

  refusing = false;
  await session.retry();
  expect(session.view()).toMatchObject({ phase: "pair", pairError: null });
  // The same pair, not the one after it.
  expect(posts(calls, "/ab-pairs").at(-1)?.body).toEqual(pairBefore);
});

test("switching mode keeps the pair shown and draws no new one", async () => {
  const calls = server();
  const session = await started();
  const shown = session.view().shown;
  await session.setMode("random");
  expect(session.view().shown).toEqual(shown);
  expect(posts(calls, "/ab-pairs")).toHaveLength(1);
});

test("random mode leaves out pairs the session already has live ratings for", async () => {
  const heard = (/** @type {number} */ id) => ({ genomeId: 100 + id, seed: 7 });
  server({
    ratings: [
      { sessionId: 5, removedAt: null, a: heard(1), b: heard(3) },
      { sessionId: 5, removedAt: 123, a: heard(1), b: heard(2) },
      { sessionId: 6, removedAt: null, a: heard(2), b: heard(3) },
    ],
  });
  const session = await started();
  await session.setMode("random");
  expect(session.view().remaining).toBe(2);
});

test("a pair whose save failed isn't drawn again until it is retried or discarded", async () => {
  const calls = server({
    ids: [1, 2],
    more: (call) => (call.path.endsWith("/ab-ratings") ? fail("down") : undefined),
  });
  const session = await started();
  await session.setMode("random");
  await session.choose("a", PLAYED);
  await flush();
  // A switch on a run-out pool draws again; the only pair has a failed save, so it is held out
  // rather than offered to be rated a second time.
  await session.setMode("champion");
  await session.setMode("random");
  expect(session.view()).toMatchObject({ phase: "done", remaining: 0 });
  const [failed] = session.view().failed;
  await session.discard(/** @type {{ id: number }} */ (failed).id);
  expect(session.view()).toMatchObject({ failed: [] });
  expect(session.unsaved()).toBe(false);
  await session.setMode("champion");
  await session.setMode("random");
  expect(session.view().phase).toBe("pair");
  expect(posts(calls, "/ab-ratings")).toHaveLength(1);
});

test("undo of a save still sending says it is waiting", async () => {
  const sending = held();
  server({
    more: (call) =>
      call.path.endsWith("/remove")
        ? ok({})
        : call.path.endsWith("/ab-ratings")
          ? sending.reply
          : undefined,
  });
  const session = await started();
  await session.choose("a", PLAYED);
  const undone = session.undo();
  await flush();
  expect(session.view().message).toMatch(/^Waiting for the last save/);
  sending.release(ok({ id: 77 }));
  await undone;
  expect(session.view().message).toMatch(/^Took back/);
});

test("a fault in the page's render during a save leaves no save stuck, and is reported", async () => {
  /** @type {Error[]} */
  const reported = [];
  let throwing = false;
  const sending = held();
  let n = 0;
  server({
    more: (call) => (call.path.endsWith("/ab-ratings") && n++ === 0 ? sending.reply : undefined),
  });
  const session = made({
    onChange: () => {
      if (throwing) throw new Error("render broke");
    },
    onError: (error) => reported.push(error),
  });
  await session.load();
  await session.choose("a", PLAYED);
  await session.choose("b", PLAYED);
  throwing = true;
  sending.release(ok({ id: 77 }));
  await flush();
  throwing = false;
  expect(reported.map(({ message }) => message)).toContain("render broke");
  // The second save was still sent after the first one's render threw.
  expect(session.view().saving).toBe(0);
  expect(session.unsaved()).toBe(false);
});

test("a mode switch made while the pool loads is kept", async () => {
  const candidates = held();
  stubServer((call) => {
    if (call.path === SESSION) return ok({ id: 5, vibeId: 9 });
    if (call.path === `${SESSION}/candidates`) return candidates.reply;
    if (call.path === "/api/vibes/9/ratings") return ok({ ratings: [] });
    if (call.path === `${SESSION}/ab-pairs`)
      return ok({ ...call.body, orderSeed: 1, leftSide: "a" });
    return undefined;
  });
  const session = made();
  const loading = session.load();
  await flush();
  await session.setMode("random");
  candidates.release(ok({ candidates: [1, 2, 3].map((id) => candidate(id)) }));
  await loading;
  expect(session.view().mode).toBe("random");
});

test("hidden candidates are left out of the pool, and no pair names one", async () => {
  const calls = server({ ids: [1, 2, 3, 4], hidden: [2, 4] });
  const session = await started();
  expect(session.view()).toMatchObject({ phase: "pair", poolSize: 2 });
  expect(session.view().shown?.ids.slice().sort()).toEqual([1, 3]);
  expect(posts(calls, "/ab-pairs").map((c) => [c.body.a, c.body.b].sort())).toEqual([[201, 203]]);
});

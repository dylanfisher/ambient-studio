// Locking a candidate's values, listing and removing locks through the HTTP routes (decision
// 0035), against the fake omlx: a live lock reaches the next prompt and the stored candidate,
// a removed one doesn't, and its row stays. Candidates to lock from are written to the store,
// as fillStore does, since locking needs no render; one test goes through generation.
/** @import { Studio } from "../support/studio.js" */
import { afterEach, expect, test } from "vitest";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { getLock } from "../../src/server/lock-store.js";
import { GENOMES, removeStudio, startStudio } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

/**
 * Writes a candidate of the vibe straight to the store, with no generation or render; a null
 * genome stands for an answer that never parsed.
 * @param {Studio} studio
 * @param {any} vibe as the vibe route returns it
 * @param {unknown} genome
 */
function seedCandidate({ server }, vibe, genome) {
  const genomeId = genome === null ? null : putGenome(server.store, vibe.id, genome).id;
  return addCandidate(server.store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    genomeId,
    seed: 7,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent: null,
    rejectReason: genome === null ? "noJson" : null,
    lint: null,
    rejectedGenome: null,
  });
}

/** A session on `VIBE` with one valid candidate of the drone genome. */
async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  const { vibe, session } = await studio.openSession();
  const candidate = seedCandidate(studio, vibe, droneGenome);
  const locks = `/api/vibes/${vibe.id}/locks`;
  return { ...studio, vibe, session, candidate, locks };
}

const LOCKED = "Locked by the owner";

test("a lock taken from a candidate reaches the next prompt and the candidate; removed, it doesn't", async () => {
  const { server, omlx, ok, drive, generate, vibe, session, candidate, locks } = await setup();
  const made = await ok("POST", locks, { candidateId: candidate.id, path: "reverbDecay" });
  expect(made).toEqual({
    lock: expect.objectContaining({
      vibeId: vibe.id,
      candidateId: candidate.id,
      path: "reverbDecay",
      value: droneGenome.reverbDecay,
      voiceType: null,
      removedAt: null,
    }),
    removed: [],
    macros: [],
  });
  expect(await ok("GET", locks)).toEqual({ locks: [made.lock] });

  // GENOMES[1] is the drone with another reverb decay; the lock holds it at the drone's.
  await generate(session.id, [GENOMES[1]]);
  const user = omlx.requests.at(-1)?.body.messages[1].content;
  expect(user).toContain(`${LOCKED}; keep these values exactly:\nreverbDecay = 2`);
  const [second] = (await ok("GET", `/api/sessions/${session.id}/candidates`)).candidates;
  expect(second.genome.reverbDecay).toBe(droneGenome.reverbDecay);
  const row = server.store.db.prepare("SELECT locks, operatorParams FROM candidates WHERE id = ?");
  const stored = row.get(second.id);
  expect(JSON.parse(String(stored?.locks))).toEqual([{ path: "reverbDecay", value: 2 }]);
  expect(JSON.parse(String(stored?.operatorParams))).toEqual({
    locksChanged: ["reverbDecay"],
    locksFilled: [],
  });

  const removed = await ok("POST", `${locks}/${made.lock.id}/remove`, {});
  expect(removed).toMatchObject({ id: made.lock.id, removedReason: "unlocked" });
  expect(await ok("GET", locks)).toEqual({ locks: [] });
  // An answer with no genome is enough to read the prompt, and renders nothing.
  omlx.script({ tokens: ["no genome"] });
  const job = await ok("POST", `/api/sessions/${session.id}/candidates`, { count: 1 });
  await drive(server.jobs.settled(job.id));
  expect(omlx.requests.at(-1)?.body.messages[1].content).not.toContain(LOCKED);
  expect(getLock(server.store, made.lock.id)).toEqual(removed);
});

test("locking a voice's parameter names its type and offers the macros that move it", async () => {
  const { ok, candidate, locks } = await setup();
  const made = await ok("POST", locks, { candidateId: candidate.id, path: "voices.drone.cutoff" });
  expect(made.lock).toMatchObject({
    path: "voices.drone.cutoff",
    value: {
      points: [
        [0, 250],
        [3, 900, "smooth"],
      ],
    },
    voiceType: "drone",
  });
  expect(made.macros).toEqual(["brightness"]);
});

test("locking a whole voice covers the locks inside it, and a path inside it is then refused", async () => {
  const { server, ok, candidate, locks } = await setup();
  const level = await ok("POST", locks, { candidateId: candidate.id, path: "voices.drone.level" });
  const whole = await ok("POST", locks, { candidateId: candidate.id, path: "voices.drone" });
  expect(whole.removed).toEqual([
    expect.objectContaining({ id: level.lock.id, removedReason: "covered" }),
  ]);
  expect(whole.macros).toEqual(["brightness", "motion"]);
  const again = await ok("POST", locks, { candidateId: candidate.id, path: "voices.drone" });
  expect(again.removed).toEqual([
    expect.objectContaining({ id: whole.lock.id, removedReason: "replaced" }),
  ]);

  const inside = await server.api("POST", locks, {
    candidateId: candidate.id,
    path: "voices.drone.q",
  });
  expect(inside.status).toBe(409);
  expect(inside.json().error).toMatch(/inside voices\.drone, which is locked whole/);
});

test("malformed lock requests are refused with a 400 naming the problem", async () => {
  const studio = await setup();
  const { server, ok, vibe, candidate, locks, openSession } = studio;
  // A candidate whose answer never parsed has no genome; another vibe's has a genome of its own.
  const rejected = seedCandidate(studio, vibe, null);
  const elsewhere = seedCandidate(studio, (await openSession()).vibe, droneGenome);

  /** @type {[unknown, RegExp][]} */
  const cases = [
    [[], /the body must be a JSON object/],
    [{ candidateId: candidate.id }, /path must be a non-empty string/],
    [
      { candidateId: candidate.id, path: "x".repeat(100_000) },
      /^path must be at most 64 characters, got 100000$/,
    ],
    [{ path: "reverbDecay" }, /candidateId must be an integer/],
    [{ candidateId: candidate.id, path: "reverbDecay", value: 3 }, /unknown fields value/],
    [{ candidateId: "1", path: "reverbDecay" }, /candidateId must be an integer/],
    [{ candidateId: candidate.id, path: "shimmer" }, /shimmer names no parameter/],
    [{ candidateId: candidate.id, path: "voices.choir" }, /the candidate has no voice "choir"/],
    [{ candidateId: candidate.id + 1000, path: "width" }, /there is no candidate/],
    [{ candidateId: elsewhere.id, path: "width" }, /is not a candidate of vibe/],
    [{ candidateId: rejected.id, path: "width" }, /has no genome/],
  ];
  for (const [body, message] of cases) {
    const reply = await server.api("POST", locks, body);
    expect(reply.status, JSON.stringify(body)).toBe(400);
    expect(reply.json().error, JSON.stringify(body)).toMatch(message);
  }
  expect(await ok("GET", locks)).toEqual({ locks: [] });
});

test("an unknown vibe or lock is a 404, and a remove takes no fields", async () => {
  const { server, ok, candidate, locks, openSession } = await setup();
  const made = await ok("POST", locks, { candidateId: candidate.id, path: "width" });
  expect((await server.api("GET", "/api/vibes/999/locks")).status).toBe(404);
  expect((await server.api("POST", `${locks}/999/remove`, {})).status).toBe(404);
  const other = await openSession();
  const elsewhere = await server.api(
    "POST",
    `/api/vibes/${other.vibe.id}/locks/${made.lock.id}/remove`,
    {},
  );
  expect(elsewhere.status).toBe(404);
  const extra = await server.api("POST", `${locks}/${made.lock.id}/remove`, { why: "x" });
  expect(extra.status).toBe(400);
  expect(await ok("GET", locks)).toEqual({ locks: [made.lock] });
});

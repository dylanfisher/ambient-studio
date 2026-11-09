// Drafting a brief through the real server against the fake omlx (decision 0074): a new brief's
// one request holding the owner's words, its draft returned and nothing stored; a saved brief's
// rework holding the form's draft, stored as a generation of its revision while the brief keeps
// its revisions; one repair quoting the validators' errors; and a draft still invalid failing
// with its findings.
/** @import { Studio } from "../support/studio.js" */
import { afterEach, expect, test } from "vitest";
import { ROLE } from "../../src/domain/prompt-tokens.js";
import { getGeneration, listRequestGroup } from "../../src/server/generation-store.js";
import { TABLE } from "../../src/server/store.js";
import { listRevisions } from "../../src/server/vibe-store.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

const WORDS = "slow, dark, underwater drone, almost no rhythm, a little bell now and then";

const DRAFT = Object.freeze({
  name: "Underwater drone",
  brief: "A slow, dark drone heard from under water, with a struck bell now and then.",
  constraints: { pulse: "none", bellNotes: 2 },
  softTargets: { features: { centroidMean: [null, 700], onsetRate: [0, 0.1] } },
});

async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  return studio;
}

/** @param {unknown} value */
const tokens = (value) => ({ tokens: [JSON.stringify(value)] });

/**
 * Asks for a draft at `path` with the fake omlx answering `answers` in turn, and returns the
 * finished job.
 * @param {Studio} studio
 * @param {string} path
 * @param {unknown} current
 * @param {unknown[]} answers
 */
async function draft({ ok, omlx, drive, server }, path, current, answers) {
  omlx.script(...answers.map(tokens));
  const job = await ok("POST", path, { words: WORDS, current });
  await drive(server.jobs.settled(job.id));
  return ok("GET", `/api/jobs/${job.id}`);
}

/**
 * @param {Studio} studio
 * @param {number} i
 * @returns {any[]}
 */
function sent({ omlx }, i) {
  const request = omlx.requests[i];
  if (!request) throw new Error(`the fake omlx got no request ${i}`);
  return request.body.messages;
}

/** @param {Studio} studio */
const generationCount = ({ server }) =>
  Number(server.store.db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE.generations}`).get()?.n);

test("a new brief's one request holds the words, and the checked draft comes back unsaved", async () => {
  const studio = await setup();
  const finished = await draft(studio, "/api/brief-drafts", null, [DRAFT]);
  expect(finished.state).toBe("done");
  expect(finished.kind).toBe("draft-brief");
  expect(finished.result).toEqual({ draft: DRAFT, repaired: false, generationId: null });
  expect(studio.omlx.requests).toHaveLength(1);
  const [system, user] = sent(studio, 0);
  expect(system.role).toBe(ROLE.system);
  expect(system.content).toContain('"bellNotes": the most');
  expect(system.content).toContain('"centroidMean": spectral centroid');
  expect(user.content).toContain(JSON.stringify(WORDS));
  expect(user.content).not.toContain("The brief now");
  // No brief exists to store the request with, and none is made.
  expect(generationCount(studio)).toBe(0);
  expect((await studio.ok("GET", "/api/vibes")).vibes).toEqual([]);
});

test("a saved brief's rework sends the form's draft and stores the request, not a revision", async () => {
  const studio = await setup();
  const vibe = await studio.ok("POST", "/api/vibes", VIBE);
  // The form holds an edit that isn't saved, and a saved key other than the ranges.
  const current = { ...VIBE, name: "colder drone", softTargets: { features: {}, kept: 1 } };
  const finished = await draft(studio, `/api/vibes/${vibe.id}/drafts`, current, [DRAFT]);
  expect(finished.state).toBe("done");
  expect(finished.result.draft).toEqual(DRAFT);
  const [, user] = sent(studio, 0);
  expect(user.content).toContain(
    `The brief now, as JSON: ${JSON.stringify({ ...current, softTargets: { features: {} } })}`,
  );
  expect(user.content).toContain(JSON.stringify(WORDS));

  const generation = getGeneration(studio.server.store, finished.result.generationId);
  expect(generation?.requestGroup).toMatch(new RegExp(`^vibe-${vibe.id}-draft-\\d+$`));
  expect(generation?.vibeRevisionId).toBe(vibe.revision.id);
  expect(generation?.repairRound).toBe(0);
  expect(listRevisions(studio.server.store, vibe.id)).toHaveLength(1);
});

test("an invalid draft gets one repair quoting the validators' errors", async () => {
  const studio = await setup();
  const vibe = await studio.ok("POST", "/api/vibes", VIBE);
  const wrong = {
    ...DRAFT,
    constraints: { bellNotes: 90 },
    softTargets: { features: { lowEndShare: [0.2, 3] } },
  };
  const finished = await draft(studio, `/api/vibes/${vibe.id}/drafts`, VIBE, [wrong, DRAFT]);
  expect(finished.state).toBe("done");
  expect(finished.result).toMatchObject({ draft: DRAFT, repaired: true });
  const repair = sent(studio, 1);
  expect(repair.slice(0, 2)).toEqual(sent(studio, 0));
  expect(repair[2]).toEqual({ role: ROLE.assistant, content: JSON.stringify(wrong) });
  expect(repair[3].content).toContain("- $.constraints.bellNotes (constraints): ");
  expect(repair[3].content).toContain(
    "- $.softTargets.features.lowEndShare[1] (softTargets): must be from 0 to 1, got 3",
  );
  const kept = getGeneration(studio.server.store, finished.result.generationId);
  const group = listRequestGroup(studio.server.store, String(kept?.requestGroup));
  expect(group.map(({ repairsId }) => repairsId)).toEqual([null, group[0]?.id]);
});

test("a draft still invalid after its repair fails with its findings, and one with nothing to repair gets none", async () => {
  const studio = await setup();
  const blank = { ...DRAFT, name: " " };
  const failed = await draft(studio, "/api/brief-drafts", null, [blank, blank]);
  expect(failed.state).toBe("failed");
  expect(failed.error).toMatch(/still invalid after one repair/);
  expect(failed.error).toContain("- $.name (name): must be a non-empty string");
  expect(studio.omlx.requests).toHaveLength(2);
  expect(sent(studio, 1)[3].content).toContain("$.name (name)");

  studio.omlx.script({ tokens: ["A slow drone would suit this."] });
  const job = await studio.ok("POST", "/api/brief-drafts", { words: WORDS, current: null });
  await studio.drive(studio.server.jobs.settled(job.id));
  const prose = await studio.ok("GET", `/api/jobs/${job.id}`);
  expect(prose.state).toBe("failed");
  expect(prose.error).toMatch(/invalid, with nothing to repair/);
  expect(studio.omlx.requests).toHaveLength(3);
});

test("the routes refuse bad words, a bad form and a second draft while one runs", async () => {
  const studio = await setup();
  const { server } = studio;
  const empty = await server.api("POST", "/api/brief-drafts", { words: " ", current: null });
  expect(empty.status).toBe(400);
  const bad = await server.api("POST", "/api/brief-drafts", {
    words: WORDS,
    current: { ...VIBE, constraints: { bellNotes: 90 } },
  });
  expect(bad.status).toBe(400);
  expect(bad.body.toString()).toContain("the constraints are invalid");
  expect(
    (await server.api("POST", "/api/vibes/9/drafts", { words: WORDS, current: null })).status,
  ).toBe(404);
  // A new brief's form may hold no name or description yet.
  studio.omlx.script({ tokens: [JSON.stringify(DRAFT)], holdAfter: 0 });
  const first = await studio.ok("POST", "/api/brief-drafts", {
    words: WORDS,
    current: { name: "", brief: "", constraints: {}, softTargets: {} },
  });
  const second = await server.api("POST", "/api/brief-drafts", { words: WORDS, current: null });
  expect(second.status).toBe(409);
  expect(second.json().jobId).toBe(first.id);
  // release() frees only a request the fake holds, so wait for the job to send it.
  await studio.omlx.waitForRequests(1);
  studio.omlx.release();
  await studio.drive(server.jobs.settled(first.id));
});

// Proposing a track through the real server against the fake omlx (decision 0067): one request
// holding the brief, the arc and every sketch; a valid answer stored as the track's first
// revision with its generation; one repair quoting the errors, the length finding among them;
// an elite the model names kept as a sketch; nothing rendered; edits saved as new revisions; and
// the share of valid proposals. Sketches and map candidates are written to the store, as
// track-routes.test.js writes them.
/** @import { Studio } from "../support/studio.js" */
import { afterEach, expect, test } from "vitest";
import { OPERATOR } from "../../src/domain/operator.js";
import { ROLE } from "../../src/domain/prompt-tokens.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requestGroupName } from "../../src/server/generate-candidates.js";
import {
  addCandidate,
  addGeneration,
  getGeneration,
  listRequestGroup,
  putGenome,
} from "../../src/server/generation-store.js";
import { addSketch, getSketch } from "../../src/server/rating-store.js";
import { TABLE } from "../../src/server/store.js";
import { listTrackRevisions } from "../../src/server/track-store.js";
import { getVibe } from "../../src/server/vibe-store.js";
import { mapGenome, seedMapCandidate } from "../support/map-fixtures.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

const ARC = "emerge, plateau, dissolve";

/**
 * A kept sketch of the drone genome, written straight to the store.
 * @param {Studio} studio
 * @param {any} vibe as the vibe route returns it
 * @param {string} intent
 */
function seedSketch({ server }, vibe, intent) {
  const candidate = addCandidate(server.store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: null,
    genomeId: putGenome(server.store, vibe.id, droneGenome).id,
    seed: 7,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent,
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  return addSketch(server.store, {
    candidateId: candidate.id,
    notes: `notes of ${intent}`,
    tags: ["cold"],
  });
}

async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  const vibe = await studio.ok("POST", "/api/vibes", VIBE);
  const sketches = [
    seedSketch(studio, vibe, "a cold drone"),
    seedSketch(studio, vibe, "a thin drone"),
  ];
  const ids = /** @type {[number, number]} */ (sketches.map(({ id }) => id));
  return { ...studio, vibe, sketches, ids };
}

/**
 * Two sections, the first `first` s and the second 300 s, with an 8 s crossfade, each part with
 * its line of text drawn from the arc (0082).
 * @param {number} a the first section's sketch
 * @param {number} b the second's
 * @param {number} first
 * @param {string} [key] how the second section names its material
 */
const answer = (a, b, first, key = "sketchId") => ({
  sections: [
    { sketchId: a, offset: 0, seconds: first, text: "the drone emerges from silence" },
    { [key]: b, offset: 0, seconds: 300, text: "a plateau, then it dissolves" },
  ],
  transitions: [{ kind: "crossfade", seconds: 8, text: "the drone thins as the pad comes in" }],
  lanes: [
    {
      macro: "brightness",
      points: [
        [0, 0],
        [600, -0.2, "smooth"],
      ],
    },
  ],
});

/** @param {unknown} value */
const tokens = (value) => ({ tokens: [JSON.stringify(value)] });

/**
 * Proposes a 600 s track with the fake omlx answering `answers` in turn, and returns the finished
 * job.
 * @param {Awaited<ReturnType<typeof setup>>} studio
 * @param {unknown[]} answers
 */
async function propose({ ok, omlx, drive, server, vibe }, answers) {
  omlx.script(...answers.map(tokens));
  const job = await ok("POST", `/api/vibes/${vibe.id}/proposals`, {
    name: "first light",
    length: 600,
    arc: ARC,
  });
  await drive(server.jobs.settled(job.id));
  return ok("GET", `/api/jobs/${job.id}`);
}

/**
 * The messages of the fake omlx's request `i`, from 0.
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
const renderCount = ({ server }) =>
  Number(server.store.db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE.renders}`).get()?.n);

test("one request holds the brief, the arc and every sketch, and a valid answer becomes the first revision", async () => {
  const studio = await setup();
  const [a, b] = studio.ids;
  const finished = await propose(studio, [answer(a, b, 308)]);
  expect(finished.state).toBe("done");
  expect(studio.omlx.requests).toHaveLength(1);
  const [system, user] = sent(studio, 0);
  expect(system.role).toBe(ROLE.system);
  expect(user.content).toContain(`Brief: ${VIBE.name}\n${VIBE.brief}`);
  expect(user.content).toContain(JSON.stringify(ARC));
  for (const sketch of studio.sketches) {
    expect(user.content).toMatch(new RegExp(`^sketch ${sketch.id}: 60 s; intent "`, "m"));
    expect(user.content).toContain(`notes "${sketch.notes}"`);
  }

  const { trackId, revisionId, generationId, repaired } = finished.result;
  expect(repaired).toBe(false);
  const generation = getGeneration(studio.server.store, generationId);
  expect(generation?.requestGroup).toMatch(new RegExp(`^vibe-${studio.vibe.id}-arrange-\\d+$`));
  expect(generation?.repairRound).toBe(0);
  const revisions = listTrackRevisions(studio.server.store, trackId);
  expect(revisions.map(({ id }) => id)).toEqual([revisionId]);
  const given = answer(a, b, 308);
  // The prompt asks for a line on every part, and the stored revision keeps each (0082).
  expect(system.content).toContain(`"text": "<what happens here>"`);
  expect(revisions[0]?.arrangement).toEqual({
    ...given,
    sections: given.sections.map((section) => ({ ...section, developmentId: null })),
    length: 600,
    arc: ARC,
    proposal: generationId,
  });
  expect(revisions[0]?.note).toBe("Proposed by the model");
  // Proposing renders nothing and starts no other job.
  expect(renderCount(studio)).toBe(0);
  expect(studio.server.jobs.list().map(({ kind }) => kind)).toEqual(["propose"]);

  const opened = await studio.ok("GET", `/api/tracks/${trackId}`);
  expect(opened.revisions[0]).toMatchObject({
    length: 600,
    arrangement: { proposal: generationId },
  });
});

test("an invalid answer gets one repair quoting its errors, the length among them", async () => {
  const studio = await setup();
  const [a, b] = studio.ids;
  const wrong = {
    ...answer(a, b, 200),
    transitions: [{ kind: "morph", seconds: 3, curve: "smooth", text: "" }],
  };
  const finished = await propose(studio, [wrong, answer(a, b, 300)]);
  expect(finished.state).toBe("done");
  expect(studio.omlx.requests).toHaveLength(2);
  const repair = sent(studio, 1);
  expect(repair.slice(0, 2)).toEqual(sent(studio, 0));
  expect(repair[2]).toEqual({ role: ROLE.assistant, content: JSON.stringify(wrong) });
  expect(repair[3].content).toContain(
    "- $.transitions[0].seconds (arrangement): a morph must be at least 8 s",
  );

  // A valid shape too far off the length to scale is named too.
  const short = await propose(studio, [answer(a, b, 100), answer(a, b, 100)]);
  expect(short.state).toBe("failed");
  const lengthRepair = sent(studio, 3);
  expect(lengthRepair[3].content).toContain(
    "- $.sections (length): the track plays 392 s (every section's seconds less every transition's); the owner asked for 600 s, so it must play from 570 to 630 s",
  );
  expect(short.error).toMatch(/still invalid after one repair/);
  expect(short.error).toContain("(length)");

  const { generationId } = finished.result;
  const kept = getGeneration(studio.server.store, generationId);
  expect(kept).toMatchObject({ repairRound: 1 });
  const group = listRequestGroup(studio.server.store, String(kept?.requestGroup));
  expect(group.map(({ repairsId }) => repairsId)).toEqual([null, group[0]?.id]);
  expect(listTrackRevisions(studio.server.store, finished.result.trackId)[0]?.note).toBe(
    "Proposed by the model, after one repair",
  );
  // The failed proposal made no track.
  const { tracks } = await studio.ok("GET", `/api/vibes/${studio.vibe.id}/tracks`);
  expect(tracks.map((/** @type {any} */ track) => track.id)).toEqual([finished.result.trackId]);

  const share = await studio.ok("GET", `/api/vibes/${studio.vibe.id}/proposals`);
  expect(share).toEqual({ asked: 2, valid: 1, firstTry: 0, invalid: 1, failed: 0 });
});

test("an answer off the length but near it is scaled to it, with no repair, and says so", async () => {
  const studio = await setup();
  const [a, b] = studio.ids;
  // 200 + 300 less an 8 s crossfade plays 492 s of the 600 asked for.
  const finished = await propose(studio, [answer(a, b, 200)]);
  expect(finished.state).toBe("done");
  expect(studio.omlx.requests).toHaveLength(1);
  const [revision] = listTrackRevisions(studio.server.store, finished.result.trackId);
  expect(revision?.note).toBe(
    "Proposed by the model; its sections scaled from 492 s to play 600 s",
  );
  expect(revision?.arrangement.sections.map((/** @type {any} */ s) => s.seconds)).toEqual([
    243, 365,
  ]);
});

test("an answer with nothing to repair gets no repair, and the share counts it invalid", async () => {
  const studio = await setup();
  studio.omlx.script({ tokens: ["I would start with the cold drone."] });
  const job = await studio.ok("POST", `/api/vibes/${studio.vibe.id}/proposals`, {
    name: "t",
    length: 600,
    arc: ARC,
  });
  await studio.drive(studio.server.jobs.settled(job.id));
  const finished = await studio.ok("GET", `/api/jobs/${job.id}`);
  expect(finished.state).toBe("failed");
  expect(finished.error).toMatch(/invalid, with nothing to repair/);
  expect(studio.omlx.requests).toHaveLength(1);
  expect(await studio.ok("GET", `/api/vibes/${studio.vibe.id}/proposals`)).toMatchObject({
    asked: 1,
    invalid: 1,
  });
});

test("an elite the model names is kept as a sketch, and the section names it", async () => {
  const studio = await setup();
  const { server, vibe } = studio;
  const session = await studio.ok("POST", `/api/vibes/${vibe.id}/sessions`, {});
  const elite = await seedMapCandidate(server.store, server.paths, {
    vibeId: vibe.id,
    vibeRevisionId: vibe.revision.id,
    sessionId: session.id,
    target: VIBE.constraints.loudness,
    genome: mapGenome(0.4),
    heard: { centroidMean: 600 },
    intent: "a moving drone",
  });
  await studio.ok("POST", `/api/vibes/${vibe.id}/axes`, {
    axes: [
      { source: "feature", name: "centroidMean", low: 200, high: 1000 },
      { source: "macro", name: "motion", low: 0, high: 1 },
    ],
  });
  const before = renderCount(studio);
  const [a] = studio.ids;
  const finished = await propose(studio, [answer(a, elite.id, 308, "eliteId")]);
  expect(finished.state).toBe("done");
  const user = sent(studio, 0)[1].content;
  expect(user).toMatch(
    new RegExp(`^elite ${elite.id}: 60 s; intent "a moving drone"; measured `, "m"),
  );
  expect(finished.result.keptElites).toEqual([elite.id]);
  const [revision] = listTrackRevisions(server.store, finished.result.trackId);
  const sketchId = revision?.arrangement.sections[1]?.sketchId;
  expect(getSketch(server.store, /** @type {number} */ (sketchId))).toMatchObject({
    candidateId: elite.id,
    notes: "",
    tags: [],
  });
  expect(renderCount(studio)).toBe(before);
  expect(getVibe(server.store, vibe.id)).toBeDefined();
});

test("editing a proposal saves new revisions and leaves the proposal's as it was", async () => {
  const studio = await setup();
  const [a, b] = studio.ids;
  const finished = await propose(studio, [answer(a, b, 308)]);
  const path = `/api/tracks/${finished.result.trackId}`;
  const [proposed] = (await studio.ok("GET", path)).revisions;
  const reordered = {
    ...proposed.arrangement,
    sections: [...proposed.arrangement.sections].reverse(),
  };
  await studio.ok("POST", `${path}/revisions`, { arrangement: reordered, note: "reordered" });
  const resized = {
    ...reordered,
    sections: reordered.sections.map((/** @type {any} */ s, /** @type {number} */ i) =>
      i === 0 ? { ...s, seconds: 280, offset: 10 } : s,
    ),
  };
  await studio.ok("POST", `${path}/revisions`, { arrangement: resized, note: "resized" });
  const { revisions } = await studio.ok("GET", path);
  expect(revisions.map((/** @type {any} */ r) => r.note)).toEqual([
    "Proposed by the model",
    "reordered",
    "resized",
  ]);
  expect(revisions[0]).toEqual(proposed);
  expect(renderCount(studio)).toBe(0);
});

test("a proposal's ask is checked before anything is sent", async () => {
  const studio = await setup();
  const path = `/api/vibes/${studio.vibe.id}/proposals`;
  for (const [body, message] of /** @type {[unknown, RegExp][]} */ ([
    [{ name: "t", length: 60, arc: ARC }, /\$\.length: must be ≥ 180|\$\.length/],
    [{ name: "t", length: 600, arc: "two\nlines" }, /\$\.arc: must be one line/],
    [{ name: "t", length: 600 }, /needs a length in seconds and an arc/],
    [{ name: "t", length: 600, arc: ARC, regionId: 9 }, /region 9 isn't attached/],
  ])) {
    const reply = await studio.server.api("POST", path, body);
    expect(reply.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
    expect(reply.json().error).toMatch(message);
  }
  expect(studio.omlx.requests).toHaveLength(0);
});

/**
 * Rows in `table`.
 * @param {Studio} studio
 * @param {string} table
 */
const rows = ({ server }, table) =>
  Number(server.store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);

/**
 * The tracks, revisions and sketches stored now, the two seeded sketches included.
 * @param {Studio} studio
 */
const stored = (studio) => ({
  tracks: rows(studio, TABLE.tracks),
  revisions: rows(studio, TABLE.trackRevisions),
  sketches: rows(studio, TABLE.sketches),
});
const NOTHING_MADE = { tracks: 0, revisions: 0, sketches: 2 };

/**
 * One elite on the brief's map, not kept as a sketch.
 * @param {Awaited<ReturnType<typeof setup>>} studio
 */
async function seedElite(studio) {
  const { server, vibe } = studio;
  const session = await studio.ok("POST", `/api/vibes/${vibe.id}/sessions`, {});
  const elite = await seedMapCandidate(server.store, server.paths, {
    vibeId: vibe.id,
    vibeRevisionId: vibe.revision.id,
    sessionId: session.id,
    target: VIBE.constraints.loudness,
    genome: mapGenome(0.4),
    heard: { centroidMean: 600 },
  });
  await studio.ok("POST", `/api/vibes/${vibe.id}/axes`, {
    axes: [
      { source: "feature", name: "centroidMean", low: 200, high: 1000 },
      { source: "macro", name: "motion", low: 0, high: 1 },
    ],
  });
  return elite;
}

test("when storing a valid proposal throws, its elite's sketch goes back with the track", async () => {
  const studio = await setup();
  const elite = await seedElite(studio);
  // The store refuses the track, after the elite's sketch is written in the same transaction.
  studio.server.store.db.exec(
    `CREATE TEMP TRIGGER refuse_tracks BEFORE INSERT ON ${TABLE.tracks}
       BEGIN SELECT RAISE(ABORT, 'the test refuses tracks'); END`,
  );
  const finished = await propose(studio, [answer(studio.ids[0], elite.id, 308, "eliteId")]);
  expect(finished.state).toBe("failed");
  expect(finished.error).toContain("the test refuses tracks");
  expect(stored(studio)).toEqual(NOTHING_MADE);
});

test("a cancel while the model answers ends the job cancelled and stores no track or sketch", async () => {
  const studio = await setup();
  // An elite on the map, so a sketch kept of it would be counted.
  await seedElite(studio);
  studio.omlx.script({ tokens: ['{"sections": '], holdAfter: 0 });
  const job = await studio.ok("POST", `/api/vibes/${studio.vibe.id}/proposals`, {
    name: "t",
    length: 600,
    arc: ARC,
  });
  await studio.omlx.waitForRequests(1);
  await studio.ok("POST", `/api/jobs/${job.id}/cancel`, {});
  await studio.drive(studio.server.jobs.settled(job.id));
  studio.omlx.release();
  expect((await studio.ok("GET", `/api/jobs/${job.id}`)).state).toBe("cancelled");
  expect(stored(studio)).toEqual(NOTHING_MADE);
});

test("a cut-off answer gets no repair, and a request the queue fails counts as failed", async () => {
  const studio = await setup();
  studio.omlx.script({ tokens: ['{"sections": [', "]"], finishReason: "length" });
  const cut = await propose(studio, []);
  expect(cut.state).toBe("failed");
  expect(cut.error).toMatch(/invalid, with nothing to repair[\s\S]*cut off/);
  expect(studio.omlx.requests).toHaveLength(1);

  studio.omlx.script({ status: 500, body: "the model fell over" });
  const broken = await propose(studio, []);
  expect(broken.state).toBe("failed");
  expect(studio.omlx.requests).toHaveLength(2);
  expect(await studio.ok("GET", `/api/vibes/${studio.vibe.id}/proposals`)).toEqual({
    asked: 2,
    valid: 0,
    firstTry: 0,
    invalid: 1,
    failed: 1,
  });
  expect(stored(studio)).toEqual(NOTHING_MADE);
});

test("the share counts only the brief's own arrange groups", async () => {
  const studio = await setup();
  const finished = await propose(studio, [answer(...studio.ids, 308)]);
  const store = studio.server.store;
  const row = /** @type {import("../../src/server/generation-store.js").Generation} */ (
    getGeneration(store, finished.result.generationId)
  );
  const { id, createdAt, removedAt, removedReason, ...draft } = row;
  const other = await studio.ok("POST", "/api/vibes", { ...VIBE, name: "other" });
  // Another brief's proposal, and another operator's group on this brief, both unanswered.
  addGeneration(store, { ...draft, requestGroup: requestGroupName(other.id, 5, OPERATOR.arrange) });
  addGeneration(store, {
    ...draft,
    requestGroup: requestGroupName(studio.vibe.id, 5, OPERATOR.explore),
  });
  // A brief whose id starts with this one's, as 11 does 1, is another brief too.
  addGeneration(store, { ...draft, requestGroup: `vibe-${studio.vibe.id}1-arrange-5` });
  expect(await studio.ok("GET", `/api/vibes/${studio.vibe.id}/proposals`)).toEqual({
    asked: 1,
    valid: 1,
    firstTry: 1,
    invalid: 0,
    failed: 0,
  });
  expect(await studio.ok("GET", `/api/vibes/${other.id}/proposals`)).toMatchObject({
    asked: 1,
    invalid: 1,
  });
});

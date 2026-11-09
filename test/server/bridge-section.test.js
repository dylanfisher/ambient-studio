// A bridge through the real server against the fake omlx (decision 0081, acceptance 5): one
// request from the join's words with both neighbors as fixed ends, a repair quoting an end
// rule; the bridge stored as the track's development, marked a bridge; placed between the two
// sections, both its joins hold as weaves. Between two keys it is two halves, the second read
// from the first. A cancel stores nothing.
/** @import { Studio } from "../support/studio.js" */
import { afterEach, expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { bridgedArrangement } from "../../src/domain/bridge-plan.js";
import { BRIDGE_RULE } from "../../src/domain/check-bridge.js";
import { sectionMorph } from "../../src/domain/section-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { getDevelopment, listDevelopments } from "../../src/server/development-store.js";
import { addCandidate, getGenome, putGenome } from "../../src/server/generation-store.js";
import { addSketch } from "../../src/server/rating-store.js";
import { TABLE } from "../../src/server/store.js";
import { sectionSources } from "../../src/server/track-manifest.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

const SEED = 11;
const [drone] = droneGenome.voices;
const base = { ...droneGenome, fadeIn: 0, fadeOut: 0 };
/** The outgoing sketch: the drone. */
const OUT = { ...base, duration: 120, voices: [drone] };
/** The incoming sketch: a pad and the drone at another root, in the same key. */
const INTO = {
  ...base,
  duration: 120,
  voices: [
    { id: "pad", type: "pad", level: -16 },
    { ...drone, root: 49 },
  ],
};
const WORDS = "the drone holds while the pad rises under it";

/**
 * A kept sketch of `genome`, written straight to the store, at seed 11.
 * @param {Studio} studio
 * @param {any} vibe as the vibe route returns it
 * @param {object} genome
 */
function seedSketch({ server }, vibe, genome) {
  const candidate = addCandidate(server.store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: null,
    genomeId: putGenome(server.store, vibe.id, genome).id,
    seed: SEED,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent: null,
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  return addSketch(server.store, { candidateId: candidate.id, notes: "", tags: [] });
}

/**
 * Two 100 s sections, the outgoing sketch then `into`, joined by an 8 s crossfade with words.
 * @param {object} [into]
 */
async function setup(into = INTO) {
  const studio = await startStudio();
  studios.push(studio);
  const vibe = await studio.ok("POST", "/api/vibes", VIBE);
  const out = seedSketch(studio, vibe, OUT);
  const incoming = seedSketch(studio, vibe, into);
  const { track } = await studio.ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "dusk" });
  const arrangement = {
    ...emptyArrangement(),
    sections: [
      { sketchId: out.id, offset: 0, seconds: 100, text: "", developmentId: null },
      { sketchId: incoming.id, offset: 0, seconds: 100, text: "", developmentId: null },
    ],
    transitions: [{ kind: "crossfade", seconds: 8, text: WORDS }],
  };
  const revision = await studio.ok("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement,
    note: "two",
  });
  return { ...studio, vibe, out, incoming, track, revision, arrangement };
}

/** @param {unknown} value */
const tokens = (value) => ({ tokens: [JSON.stringify(value)] });

/**
 * Bridges transition 1 of the saved revision with `seconds`, the fake omlx answering `answers`
 * in turn, and returns the finished job.
 * @param {Awaited<ReturnType<typeof setup>>} studio
 * @param {number} seconds
 * @param {unknown[]} answers
 */
async function bridge({ ok, omlx, drive, server, track, revision }, seconds, answers) {
  omlx.script(...answers.map(tokens));
  const job = await ok("POST", `/api/tracks/${track.id}/bridge`, {
    revisionId: revision.id,
    transition: 0,
    seconds,
  });
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

/**
 * The finished bridge placed in the arrangement and saved, and each join's morph read from
 * the store as the track's render reads it.
 * @param {Awaited<ReturnType<typeof setup>>} studio
 * @param {any} result the job's
 */
async function place({ ok, server, track, arrangement }, result) {
  const bridged = bridgedArrangement(arrangement, 0, result.plan, result.developmentIds, WORDS);
  await ok("POST", `/api/tracks/${track.id}/revisions`, { arrangement: bridged, note: "bridged" });
  const { genomes } = sectionSources(server.store, bridged);
  return { bridged, morphs: bridged.transitions.map((_, i) => sectionMorph(bridged, i, genomes)) };
}

/** The 60 s bridge: the drone throughout, the pad from 20 s. */
const BRIDGE = {
  ...base,
  duration: 60,
  voices: [
    { ...drone, start: 0, end: 60 },
    { id: "pad", type: "pad", level: -16, start: 20 },
  ],
};

test("one request and a repair quoting an end rule write a bridge whose joins both weave", async () => {
  const studio = await setup();
  const { server, ok, track, out } = studio;
  const sketches = server.store.db.prepare(`SELECT * FROM ${TABLE.sketches}`).all();
  const wrong = { ...BRIDGE, voices: [BRIDGE.voices[0]] };
  const finished = await bridge(studio, 60, [wrong, BRIDGE]);
  expect(finished.error).toBeNull();
  expect(studio.omlx.requests).toHaveLength(2);

  const [, user] = sent(studio, 0);
  for (const part of [
    "Section 2 of 3, 60 s, is a bridge the owner asked for between section 1 and section 3",
    `as a JSON string: ${JSON.stringify(WORDS)}`,
    "a 16 s weave joins it to section 1 and a 16 s weave to section 3",
  ]) {
    expect(user.content).toContain(part);
  }
  expect(user.content).toMatch(
    /Where section 1 ends, the state this bridge starts in:\nGlobals: [^\n]*key 2[^\n]*\nVoices sounding: drone \(drone\)/,
  );
  expect(user.content).toMatch(
    /Where section 3 starts, the state this bridge ends in:\n[^\n]*\nVoices sounding: [^\n]*pad \(pad\)/,
  );
  // The repair quotes the end rule's finding with its path.
  expect(sent(studio, 1)[3].content).toContain(
    `- $.voices (${BRIDGE_RULE.end}): must hold voice pad, a pad, up to 60 s, as it sounds where section 3 starts`,
  );

  const { developmentIds, plan, repaired } = finished.result;
  expect(repaired).toEqual([true]);
  expect(plan).toMatchObject({ into: 16, out: 16, middle: null });
  const [id] = developmentIds;
  const development = getDevelopment(server.store, id);
  expect(development).toMatchObject({
    trackId: track.id,
    sketchId: out.id,
    text: WORDS,
    // Where the outgoing section ends on its sketch: the plain sketch plays on from there.
    offset: 100,
    seconds: 60,
    seed: SEED,
    bridge: true,
  });
  expect(getGenome(server.store, development?.genomeId ?? 0)?.genome).toEqual(
    requireGenome(BRIDGE, "bridge"),
  );
  const read = await ok("GET", `/api/tracks/${track.id}`);
  expect(read.developments).toEqual([expect.objectContaining({ id, bridge: true })]);
  // A bridge is a development: no sketch was made.
  expect(server.store.db.prepare(`SELECT * FROM ${TABLE.sketches}`).all()).toEqual(sketches);

  const { bridged, morphs } = await place(studio, finished.result);
  expect(bridged.transitions.map(({ kind, seconds }) => [kind, seconds])).toEqual([
    ["weave", 16],
    ["weave", 16],
  ]);
  expect(morphs.map((morph) => morph?.ok)).toEqual([true, true]);
});

test("a bridge between two keys is two halves, the second written from the first", async () => {
  const studio = await setup({ ...INTO, key: 5 });
  const { server, out, incoming } = studio;
  const noise = { id: "air", type: "noise", level: -20 };
  const first = {
    ...base,
    duration: 60,
    voices: [
      { ...drone, end: 50 },
      { ...noise, start: 30 },
    ],
  };
  const second = {
    ...base,
    key: 5,
    duration: 60,
    voices: [
      { ...noise, start: 0, end: 40 },
      { id: "pad", type: "pad", level: -16, start: 12 },
      { ...drone, root: 49, start: 20 },
    ],
  };
  const finished = await bridge(studio, 120, [first, second]);
  expect(finished.error).toBeNull();
  expect(studio.omlx.requests).toHaveLength(2);
  expect(sent(studio, 0)[1].content).toContain("is the first half of a bridge");
  expect(sent(studio, 1)[1].content).toMatch(
    /Where section 2, the first half, ends, the state this half starts in:\n[^\n]*key 2[^\n]*\nVoices sounding: air \(noise\)/,
  );
  const { developmentIds, plan } = finished.result;
  expect(plan).toMatchObject({ middle: 8, differs: ["key"], keyless: true });
  expect(
    developmentIds.map((/** @type {number} */ id) => getDevelopment(server.store, id)),
  ).toEqual([
    expect.objectContaining({ sketchId: out.id, seconds: 60, bridge: true, offset: 100 }),
    // The second half plays the incoming sketch, from the 60 s before where its section starts.
    expect.objectContaining({ sketchId: incoming.id, seconds: 60, bridge: true, offset: 0 }),
  ]);
  const { bridged, morphs } = await place(studio, finished.result);
  expect(bridged.transitions.map(({ kind }) => kind)).toEqual(["weave", "crossfade", "weave"]);
  expect(morphs.map((morph) => morph?.ok ?? null)).toEqual([true, null, true]);
});

test("a cancel during the second half stores neither half", async () => {
  const studio = await setup({ ...INTO, key: 5 });
  const noise = { id: "air", type: "noise", level: -20, start: 30 };
  studio.omlx.script(tokens({ ...base, duration: 60, voices: [{ ...drone, end: 50 }, noise] }), {
    tokens: ['{"duration": '],
    holdAfter: 0,
  });
  const job = await studio.ok("POST", `/api/tracks/${studio.track.id}/bridge`, {
    revisionId: studio.revision.id,
    transition: 0,
    seconds: 120,
  });
  await studio.drive(studio.omlx.waitForRequests(2));
  await studio.ok("POST", `/api/jobs/${job.id}/cancel`, {});
  await studio.drive(studio.server.jobs.settled(job.id));
  studio.omlx.release();
  expect((await studio.ok("GET", `/api/jobs/${job.id}`)).state).toBe("cancelled");
  expect(listDevelopments(studio.server.store, studio.track.id)).toEqual([]);
});

test("the route refuses a transition that isn't one, a length out of range, and a second job", async () => {
  const studio = await setup({ ...INTO, key: 5 });
  const { server, track, revision } = studio;
  const path = `/api/tracks/${track.id}/bridge`;
  const outside = await server.api("POST", path, {
    revisionId: revision.id,
    transition: 1,
    seconds: 60,
  });
  expect(outside.status).toBe(400);
  const halves = await server.api("POST", path, {
    revisionId: revision.id,
    transition: 0,
    seconds: 90,
  });
  expect(halves.status).toBe(409);
  expect(halves.json().error).toContain("two halves of at least 60 s each");
  const long = await server.api("POST", path, {
    revisionId: revision.id,
    transition: 0,
    seconds: 901,
  });
  expect(long.status).toBe(400);
  studio.omlx.script({ tokens: ['{"duration": '], holdAfter: 0 });
  const job = await studio.ok("POST", path, {
    revisionId: revision.id,
    transition: 0,
    seconds: 120,
  });
  await studio.omlx.waitForRequests(1);
  const second = await server.api("POST", path, {
    revisionId: revision.id,
    transition: 0,
    seconds: 120,
  });
  expect(second.status).toBe(409);
  expect(second.json().error).toContain("already being written");
  await studio.ok("POST", `/api/jobs/${job.id}/cancel`, {});
  await studio.drive(server.jobs.settled(job.id));
  studio.omlx.release();
});

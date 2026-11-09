// Developing a section through the real server against the fake omlx (decision 0079, acceptance
// 3): one request holding the section's words, the sketch's genome and readings and its
// neighbors; one repair quoting the errors; the genome stored as the track's development with
// the sketch's seed; the section plays it; the track renders and re-renders from its manifest
// to the same hash; the sketch's rows are never written; a cancel or a failure stores nothing.
/** @import { Studio } from "../support/studio.js" */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { SECONDS_RULE } from "../../src/domain/check-development.js";
import { OPERATOR } from "../../src/domain/operator.js";
import { ROLE } from "../../src/domain/prompt-tokens.js";
import { conciseGenome } from "../../src/engine/canonical-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { getDevelopment, listDevelopments } from "../../src/server/development-store.js";
import { requestGroupPattern } from "../../src/server/generate-candidates.js";
import {
  addCandidate,
  getGeneration,
  getGenome,
  putGenome,
} from "../../src/server/generation-store.js";
import { genomeHash } from "../../src/server/genome-hash.js";
import { addSketch } from "../../src/server/rating-store.js";
import { rerenderTrack } from "../../src/server/render-track.js";
import { TABLE } from "../../src/server/store.js";
import { listTrackRevisions } from "../../src/server/track-store.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

const SEED = 11;

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
    intent: "a cold drone",
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  return addSketch(server.store, { candidateId: candidate.id, notes: "", tags: [] });
}

const WORDS = "a pad comes in halfway and the drone thins out";

/** Two 10 s sections of one drone sketch around 60 s of another, with 2 s crossfades; the
 * middle one is worded and runs past its sketch's end. */
async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  const vibe = await studio.ok("POST", "/api/vibes", VIBE);
  const sketch = seedSketch(studio, vibe, droneGenome);
  const other = seedSketch(studio, vibe, { ...droneGenome, key: 5 });
  const { track } = await studio.ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "dawn" });
  const arrangement = {
    ...emptyArrangement(),
    arc: "emerge, plateau, dissolve",
    sections: [
      { sketchId: other.id, offset: 0, seconds: 10, text: "", developmentId: null },
      { sketchId: sketch.id, offset: 20, seconds: 60, text: WORDS, developmentId: null },
      { sketchId: other.id, offset: 30, seconds: 10, text: "", developmentId: null },
    ],
    transitions: [
      { kind: "crossfade", seconds: 2, text: "" },
      { kind: "crossfade", seconds: 2, text: "" },
    ],
  };
  const revision = await studio.ok("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement,
    note: "three",
  });
  return { ...studio, vibe, sketch, other, track, revision, arrangement };
}

/** The drone at the section's 60 s, falling, and a pad entering at 30 s, no fades. */
const DEVELOPED = {
  ...droneGenome,
  duration: 60,
  fadeIn: 0,
  fadeOut: 0,
  voices: [
    {
      ...droneGenome.voices[0],
      level: {
        points: [
          [0, -10],
          [60, -18, "smooth"],
        ],
      },
    },
    { id: "pad", type: "pad", level: -16, start: 30 },
  ],
};

/** @param {unknown} value */
const tokens = (value) => ({ tokens: [JSON.stringify(value)] });

/**
 * Every row a sketch is made of, to hold unchanged.
 * @param {Awaited<ReturnType<typeof setup>>} studio
 */
function sketchRows({ server, sketch }) {
  const { db } = server.store;
  return {
    sketches: db.prepare(`SELECT * FROM ${TABLE.sketches} ORDER BY id`).all(),
    candidates: db.prepare(`SELECT * FROM ${TABLE.candidates} ORDER BY id`).all(),
    genome: db
      .prepare(
        `SELECT g.* FROM ${TABLE.genomes} g JOIN ${TABLE.candidates} c ON c.genomeId = g.id
          JOIN ${TABLE.sketches} s ON s.candidateId = c.id WHERE s.id = ?`,
      )
      .all(sketch.id),
  };
}

/**
 * Develops section 2 of the saved revision with the fake omlx answering `answers` in turn, and
 * returns the finished job.
 * @param {Awaited<ReturnType<typeof setup>>} studio
 * @param {unknown[]} answers
 */
async function develop({ ok, omlx, drive, server, track, revision }, answers) {
  omlx.script(...answers.map(tokens));
  const job = await ok("POST", `/api/tracks/${track.id}/develop`, {
    revisionId: revision.id,
    section: 1,
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

test("one request and one repair write a development of the section's seconds at the sketch's seed", async () => {
  const studio = await setup();
  const { server, ok, track, sketch, vibe } = studio;
  const before = sketchRows(studio);
  const wrong = { ...DEVELOPED, duration: 90 };
  const finished = await develop(studio, [wrong, DEVELOPED]);
  expect(finished.error).toBeNull();
  expect(finished.state).toBe("done");

  // The first prompt holds the words, the sketch's genome and readings, and both neighbors.
  expect(studio.omlx.requests).toHaveLength(2);
  const [system, user] = sent(studio, 0);
  expect(system.role).toBe(ROLE.system);
  expect(user.content).toContain(`Brief: ${VIBE.name}\n${VIBE.brief}`);
  expect(user.content).toContain(JSON.stringify("emerge, plateau, dissolve"));
  expect(user.content).toContain(`as a JSON string: ${JSON.stringify(WORDS)}`);
  expect(user.content).toContain(`Section 2 of 3, 60 s. It plays sketch ${sketch.id} from 20 s`);
  expect(user.content).toContain(conciseGenome(requireGenome(droneGenome, "drone")));
  expect(user.content).toContain("read in short lines:\nWhole piece:");
  expect(user.content).toContain("was made:\n");
  expect(user.content).toMatch(
    /Where section 1 ends, as this section starts:\nGlobals: [^\n]*key 5/,
  );
  expect(user.content).toMatch(
    /Where section 3 starts, as this section ends:\nGlobals: [^\n]*key 5/,
  );
  // The repair quotes the finding and asks again.
  const repair = sent(studio, 1);
  expect(repair.slice(0, 2)).toEqual(sent(studio, 0));
  expect(repair[2]).toEqual({ role: ROLE.assistant, content: JSON.stringify(wrong) });
  expect(repair[3].content).toContain(
    `- $.duration (${SECONDS_RULE}): must be the section's 60 s, got 90`,
  );

  const { developmentId, generationId, repaired, index } = finished.result;
  expect({ repaired, index }).toEqual({ repaired: true, index: 1 });
  const generation = getGeneration(server.store, generationId);
  expect(generation?.repairRound).toBe(1);
  expect(generation?.requestGroup).toMatch(
    new RegExp(`^${requestGroupPattern(vibe.id, OPERATOR.develop).replace("%", "\\d+")}$`),
  );
  const development = getDevelopment(server.store, developmentId);
  expect(development).toMatchObject({
    trackId: track.id,
    sketchId: sketch.id,
    text: WORDS,
    offset: 20,
    seconds: 60,
    seed: SEED,
    generationId,
    removedAt: null,
  });
  const stored = getGenome(server.store, /** @type {number} */ (development?.genomeId));
  expect(stored?.genome).toEqual(requireGenome(DEVELOPED, "developed"));
  // Nothing the sketch is made of was written, and no candidate or sketch was added.
  expect(sketchRows(studio)).toEqual(before);
  // Developing writes no revision: the timeline saves one when it takes the development.
  expect(listTrackRevisions(server.store, track.id)).toHaveLength(2);
  // The track lists its developments for the timeline.
  const read = await ok("GET", `/api/tracks/${track.id}`);
  expect(read.developments).toEqual([
    expect.objectContaining({ id: developmentId, sketchId: sketch.id, offset: 20, seconds: 60 }),
  ]);
});

test("a developed section renders, and re-renders from its manifest to the same hash", async () => {
  const studio = await setup();
  const { server, ok, track, arrangement } = studio;
  // A cheap development, rendered alone as the track: a genome lasts 60 s at least, and two
  // renders of it are what this checks.
  const [drone] = droneGenome.voices;
  const cheap = {
    ...DEVELOPED,
    reverbDecay: 1,
    voices: [{ ...drone, partials: 4, level: DEVELOPED.voices[0]?.level }],
  };
  const finished = await develop(studio, [cheap]);
  expect(finished.error).toBeNull();
  expect(finished.result.repaired).toBe(false);
  const { developmentId } = finished.result;
  const developed = {
    ...arrangement,
    sections: arrangement.sections.map((section, i) =>
      i === 1 ? { ...section, offset: 0, developmentId } : section,
    ),
  };
  await ok("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement: developed,
    note: "Section 2 developed",
  });
  const revision = await ok("POST", `/api/tracks/${track.id}/revisions`, {
    // 10 s of it from 20 s on its timeline, alone: a window of a development as of a sketch.
    arrangement: {
      ...emptyArrangement(),
      sections: [{ ...developed.sections[1], offset: 20, seconds: 10 }],
    },
    note: "10 s of section 2 alone",
  });
  // A section that names another sketch's development is refused with its path.
  const wrong = await server.api("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement: {
      ...developed,
      sections: developed.sections.map((section, i) =>
        i === 0 ? { ...section, developmentId } : section,
      ),
    },
    note: "",
  });
  expect(wrong.status).toBe(400);
  expect(wrong.json().error).toContain("$.sections[0].developmentId: development");

  const before = sketchRows(studio);
  const job = await ok("POST", `/api/tracks/${track.id}/render`, { revisionId: revision.id });
  await server.jobs.settled(job.id);
  const rendered = await ok("GET", `/api/jobs/${job.id}`);
  expect(rendered.error).toBeNull();
  const manifest = JSON.parse(
    await readFile(
      join(server.paths.trackRenders, String(track.id), rendered.result.key, "manifest.json"),
      "utf8",
    ),
  );
  const [section] = manifest.sections;
  expect(section).toMatchObject({ developmentId, seed: SEED, offset: 20, duration: 10 });
  expect(section.genome).toEqual(requireGenome(cheap, "cheap"));
  expect(section.genomeHash).toBe(genomeHash(section.genome));
  const temp = await mkdtemp(join(server.paths.trackRenders, "rerender-"));
  try {
    expect(await rerenderTrack(manifest, { tempDir: temp })).toEqual({
      pcmSha256: manifest.pcmSha256,
    });
  } finally {
    await rm(temp, { recursive: true });
  }
  expect(sketchRows(studio)).toEqual(before);
});

test("the section's player renders its development's window at the sketch's seed", async () => {
  const studio = await setup();
  const { server, ok, track, arrangement } = studio;
  const { developmentId } = (await develop(studio, [DEVELOPED])).result;
  const section = { ...arrangement.sections[1], offset: 30, seconds: 10, developmentId };
  const job = await ok("POST", `/api/tracks/${track.id}/section-audio`, section);
  await server.jobs.settled(job.id);
  const done = await ok("GET", `/api/jobs/${job.id}`);
  expect(done.error).toBeNull();
  const render = server.store.db
    .prepare(`SELECT * FROM ${TABLE.renders} WHERE id = ?`)
    .get(done.result.renderId);
  const development = getDevelopment(server.store, developmentId);
  expect(render).toMatchObject({
    genomeId: development?.genomeId,
    seed: SEED,
    offset: 30,
    duration: 10,
  });
});

test("developing again keeps the earlier development", async () => {
  const studio = await setup();
  const first = await develop(studio, [DEVELOPED]);
  const second = await develop(studio, [{ ...DEVELOPED, delayLevel: -30 }]);
  expect(listDevelopments(studio.server.store, studio.track.id).map(({ id }) => id)).toEqual([
    first.result.developmentId,
    second.result.developmentId,
  ]);
});

test("a cut-off answer gets no repair, an answer still invalid fails, and neither stores anything", async () => {
  const studio = await setup();
  const before = sketchRows(studio);
  studio.omlx.script({ tokens: ['{"duration": ', "10"], finishReason: "length" });
  const cut = await develop(studio, []);
  expect(cut.state).toBe("failed");
  expect(cut.error).toMatch(/invalid, with nothing to repair[\s\S]*cut off/);
  expect(studio.omlx.requests).toHaveLength(1);
  const wrong = { ...DEVELOPED, duration: 90 };
  const still = await develop(studio, [wrong, wrong]);
  expect(still.state).toBe("failed");
  expect(still.error).toMatch(/still invalid after one repair/);
  expect(listDevelopments(studio.server.store, studio.track.id)).toEqual([]);
  expect(sketchRows(studio)).toEqual(before);
});

test("a cancel while the model answers ends the job cancelled and stores no development", async () => {
  const studio = await setup();
  studio.omlx.script({ tokens: ['{"duration": '], holdAfter: 0 });
  const job = await studio.ok("POST", `/api/tracks/${studio.track.id}/develop`, {
    revisionId: studio.revision.id,
    section: 1,
  });
  await studio.omlx.waitForRequests(1);
  await studio.ok("POST", `/api/jobs/${job.id}/cancel`, {});
  await studio.drive(studio.server.jobs.settled(job.id));
  studio.omlx.release();
  expect((await studio.ok("GET", `/api/jobs/${job.id}`)).state).toBe("cancelled");
  expect(listDevelopments(studio.server.store, studio.track.id)).toEqual([]);
});

test("the route refuses a version not the track's, a section that isn't one or is under 60 s, and a second job", async () => {
  const studio = await setup();
  const { server, track, revision } = studio;
  const path = `/api/tracks/${track.id}/develop`;
  const missing = await server.api("POST", path, { revisionId: 9999, section: 0 });
  expect(missing.status).toBe(404);
  const outside = await server.api("POST", path, { revisionId: revision.id, section: 3 });
  expect(outside.status).toBe(400);
  const short = await server.api("POST", path, { revisionId: revision.id, section: 0 });
  expect(short.status).toBe(409);
  expect(short.json().error).toContain("at least 60 s to be developed");
  studio.omlx.script({ tokens: ['{"duration": '], holdAfter: 0 });
  const job = await studio.ok("POST", path, { revisionId: revision.id, section: 1 });
  await studio.omlx.waitForRequests(1);
  const second = await server.api("POST", path, { revisionId: revision.id, section: 1 });
  expect(second.status).toBe(409);
  expect(second.json().error).toContain("already being developed");
  expect(studio.omlx.requests).toHaveLength(1);
  await studio.ok("POST", `/api/jobs/${job.id}/cancel`, {});
  await studio.drive(server.jobs.settled(job.id));
  studio.omlx.release();
});

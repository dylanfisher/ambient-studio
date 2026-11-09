// Developing every section of a track through the real server against the fake omlx (decision
// 0082, acceptance 6): one owner-started job sends TD.3's request for each section in order,
// one at a time, each reading the section before it as it was just developed; each development
// is stored as it is written, so a cancel keeps those finished; a section already developed is
// kept unless the owner asks again, a bridge is always kept, and one under 60 s is skipped.
/** @import { Studio } from "../support/studio.js" */
import { afterEach, expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { DEVELOP_PLAN } from "../../src/domain/develop-plan.js";
import { JOB_KIND } from "../../src/domain/job-kind.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { listDevelopments } from "../../src/server/development-store.js";
import { listTrackRevisions } from "../../src/server/track-store.js";
import { SKETCH_SEED, seedSketch } from "../support/seed-sketch.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

const [drone] = droneGenome.voices;
const WORDS = ["the drone emerges", "a pad joins it", "", "it all thins out"];

/**
 * Four sections of two drone sketches, the third under 60 s, with 2 s crossfades.
 */
async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  const vibe = await studio.ok("POST", "/api/vibes", VIBE);
  const a = seedSketch(studio, vibe, droneGenome);
  const b = seedSketch(studio, vibe, { ...droneGenome, reverbDecay: 4 });
  const { track } = await studio.ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "dawn" });
  const sketches = [a, b, a, b];
  const arrangement = {
    ...emptyArrangement(),
    arc: "emerge, plateau, dissolve",
    sections: sketches.map((sketch, i) => ({
      sketchId: sketch.id,
      offset: 0,
      seconds: i === 2 ? 30 : 60,
      text: /** @type {string} */ (WORDS[i]),
      developmentId: null,
    })),
    transitions: Array.from({ length: 3 }, () => ({ kind: "crossfade", seconds: 2, text: "" })),
  };
  const revision = await studio.ok("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement,
    note: "four",
  });
  return { ...studio, vibe, sketches, track, revision, arrangement };
}

/**
 * Section `n`'s development, 60 s: the drone, and a pad named for the section that enters at
 * 30 s and plays to the end, so the next section's prompt shows which one it read.
 * @param {number} n from 1
 */
const developed = (n) => ({
  ...droneGenome,
  duration: 60,
  fadeIn: 0,
  fadeOut: 0,
  voices: [drone, { id: `pad-${n}`, type: "pad", level: -16, start: 30 }],
});

/** @param {unknown} value */
const tokens = (value) => ({ tokens: [JSON.stringify(value)] });

/**
 * @param {Studio} studio
 * @param {number} i
 * @returns {string} the user message of the fake omlx's request `i`
 */
function asked({ omlx }, i) {
  const request = omlx.requests[i];
  if (!request) throw new Error(`the fake omlx got no request ${i}`);
  return request.body.messages[1].content;
}

/**
 * Starts "Develop every section" on the saved revision.
 * @param {Awaited<ReturnType<typeof setup>>} studio
 * @param {{ again?: boolean, revisionId?: number }} [given]
 */
const start = ({ ok, track, revision }, { again = false, revisionId = revision.id } = {}) =>
  ok("POST", `/api/tracks/${track.id}/develop-all`, { revisionId, again });

/**
 * Develops every section with the fake omlx answering `answers` in turn, and returns the
 * finished job.
 * @param {Awaited<ReturnType<typeof setup>>} studio
 * @param {unknown[]} answers
 * @param {{ again?: boolean, revisionId?: number }} [given]
 */
async function developAll(studio, answers, given) {
  studio.omlx.script(...answers.map(tokens));
  const job = await start(studio, given);
  await studio.drive(studio.server.jobs.settled(job.id));
  return studio.ok("GET", `/api/jobs/${job.id}`);
}

test("develops every section in order, each prompt reading the section before as just developed", async () => {
  const studio = await setup();
  const { server, track, sketches } = studio;
  const finished = await developAll(studio, [developed(1), developed(2), developed(4)]);
  expect(finished.error).toBeNull();
  expect(finished.state).toBe("done");
  expect(finished.kind).toBe(JOB_KIND.developTrack);

  // One request a section, one at a time, in order; the 30 s section is skipped.
  expect(studio.omlx.requests).toHaveLength(3);
  expect(asked(studio, 0)).toContain("Section 1 of 4, 60 s.");
  expect(asked(studio, 0)).toContain(JSON.stringify(WORDS[0]));
  expect(asked(studio, 1)).toContain("Section 2 of 4, 60 s.");
  expect(asked(studio, 2)).toContain("Section 4 of 4, 60 s.");
  // Section 2's prompt meets section 1 as it was just developed, pad and all; section 1's met
  // section 2's plain sketch, which has no pad.
  expect(asked(studio, 1)).toMatch(
    /Where section 1 ends, as this section starts:\n[^\n]*\nVoices sounding: [^\n]*pad-1 \(pad\)/,
  );
  expect(asked(studio, 0)).not.toContain("pad-");
  // Section 4 meets section 3's plain sketch: it was too short to develop.
  expect(asked(studio, 2)).not.toContain("pad-2");

  const stored = listDevelopments(server.store, track.id);
  expect(stored).toEqual([
    expect.objectContaining({ sketchId: sketches[0]?.id, text: WORDS[0], offset: 0, seconds: 60 }),
    expect.objectContaining({ sketchId: sketches[1]?.id, text: WORDS[1], offset: 0, seconds: 60 }),
    expect.objectContaining({ sketchId: sketches[3]?.id, text: WORDS[3], offset: 0, seconds: 60 }),
  ]);
  for (const development of stored) {
    expect(development).toMatchObject({ seed: SKETCH_SEED, bridge: false });
  }
  expect(finished.result).toMatchObject({
    trackId: track.id,
    plan: [DEVELOP_PLAN.develop, DEVELOP_PLAN.develop, DEVELOP_PLAN.short, DEVELOP_PLAN.develop],
    developed: stored.map(({ id }, i) => ({ index: [0, 1, 3][i], developmentId: id })),
  });
  // The job writes no revision: the timeline saves one with every development placed.
  expect(listTrackRevisions(server.store, track.id)).toHaveLength(2);
});

test("a cancel after the second section keeps the first two developments", async () => {
  const studio = await setup();
  const { server, track, omlx, sketches } = studio;
  omlx.script(tokens(developed(1)), tokens(developed(2)), {
    tokens: ['{"duration": '],
    holdAfter: 0,
  });
  const job = await start(studio);
  await studio.drive(omlx.waitForRequests(3));
  await studio.ok("POST", `/api/jobs/${job.id}/cancel`, {});
  await studio.drive(server.jobs.settled(job.id));
  omlx.release();
  expect((await studio.ok("GET", `/api/jobs/${job.id}`)).state).toBe("cancelled");
  expect(listDevelopments(server.store, track.id).map(({ sketchId }) => sketchId)).toEqual([
    sketches[0]?.id,
    sketches[1]?.id,
  ]);
});

test("a section already developed is kept, unless the owner asks to develop it again", async () => {
  const studio = await setup();
  const { server, ok, track, revision, arrangement } = studio;
  studio.omlx.script(tokens(developed(2)));
  const single = await ok("POST", `/api/tracks/${track.id}/develop`, {
    revisionId: revision.id,
    section: 1,
  });
  await studio.drive(server.jobs.settled(single.id));
  const { developmentId } = (await ok("GET", `/api/jobs/${single.id}`)).result;
  const saved = await ok("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement: {
      ...arrangement,
      sections: arrangement.sections.map((section, i) =>
        i === 1 ? { ...section, developmentId } : section,
      ),
    },
    note: "Section 2 developed",
  });
  const before = studio.omlx.requests.length;

  const kept = await developAll(studio, [developed(1), developed(4)], { revisionId: saved.id });
  expect(kept.error).toBeNull();
  expect(kept.result.plan).toEqual([
    DEVELOP_PLAN.develop,
    DEVELOP_PLAN.kept,
    DEVELOP_PLAN.short,
    DEVELOP_PLAN.develop,
  ]);
  expect(studio.omlx.requests).toHaveLength(before + 2);
  // Section 1 meets the kept development of section 2 where it starts.
  expect(asked(studio, before)).toMatch(/Where section 2 starts, as this section ends:\n/);

  const again = await developAll(studio, [developed(1), developed(2), developed(4)], {
    revisionId: saved.id,
    again: true,
  });
  expect(again.error).toBeNull();
  expect(again.result.plan[1]).toBe(DEVELOP_PLAN.develop);
  // The earlier development of section 2 stays stored beside the new one.
  expect(listDevelopments(server.store, track.id).map(({ id }) => id)).toContain(developmentId);
  expect(listDevelopments(server.store, track.id)).toHaveLength(1 + 2 + 3);
});

test("the route refuses a version with nothing to develop, and a second develop or bridge job", async () => {
  const studio = await setup();
  const { server, ok, track, arrangement, revision } = studio;
  const path = `/api/tracks/${track.id}/develop-all`;
  const short = await ok("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement: {
      ...arrangement,
      sections: arrangement.sections.map((section) => ({ ...section, seconds: 30 })),
    },
    note: "short",
  });
  const none = await server.api("POST", path, { revisionId: short.id, again: false });
  expect(none.status).toBe(409);
  expect(none.json().error).toContain("No section of this version can be developed");
  const bad = await server.api("POST", path, { revisionId: revision.id, again: "yes" });
  expect(bad.status).toBe(400);

  studio.omlx.script({ tokens: ['{"duration": '], holdAfter: 0 });
  const job = await start(studio);
  await studio.omlx.waitForRequests(1);
  const second = await server.api("POST", path, { revisionId: revision.id, again: false });
  expect(second.status).toBe(409);
  expect(second.json().error).toContain("Every section is being developed");
  const single = await server.api("POST", `/api/tracks/${track.id}/develop`, {
    revisionId: revision.id,
    section: 0,
  });
  expect(single.status).toBe(409);
  expect(single.json().error).toContain("Every section is being developed");
  expect(studio.omlx.requests).toHaveLength(1);
  await ok("POST", `/api/jobs/${job.id}/cancel`, {});
  await studio.drive(server.jobs.settled(job.id));
  studio.omlx.release();
});

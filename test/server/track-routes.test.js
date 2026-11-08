// The track routes (decision 0061) through the real server: create a track of a vibe, save
// arrangements as revisions, refuse a malformed one with its paths, list the vibe's sketches as
// material, remove a track and keep its rows, and render one section's window to play. Sketches
// are written to the store, as lock-routes.test.js writes candidates, since only the section's
// player renders.
/** @import { Studio } from "../support/studio.js" */
import { afterEach, expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { addSketch } from "../../src/server/rating-store.js";
import { listTrackRevisions } from "../../src/server/track-store.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

/**
 * A kept sketch of the drone genome, written straight to the store.
 * @param {Studio} studio
 * @param {any} vibe as the vibe route returns it
 */
function seedSketch({ server }, vibe) {
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
    intent: "a slow cold drone",
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  return addSketch(server.store, { candidateId: candidate.id, notes: "keep", tags: ["cold"] });
}

async function setup() {
  const studio = await startStudio();
  studios.push(studio);
  const vibe = await studio.ok("POST", "/api/vibes", VIBE);
  const sketch = seedSketch(studio, vibe);
  return { ...studio, vibe, sketch };
}

/** @param {number} sketchId */
const twoSections = (sketchId) => ({
  ...emptyArrangement(),
  sections: [
    { sketchId, offset: 0, seconds: 30 },
    { sketchId, offset: 20, seconds: 40 },
  ],
  transitions: [{ kind: "crossfade", seconds: 8 }],
});

test("a track is made with an empty first revision, and each save appends one", async () => {
  const { ok, vibe, sketch } = await setup();
  const made = await ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "first light" });
  expect(made.track).toMatchObject({ vibeId: vibe.id, name: "first light" });
  expect(made.revision.arrangement).toEqual(emptyArrangement());
  const path = `/api/tracks/${made.track.id}`;
  const arrangement = twoSections(sketch.id);
  const saved = await ok("POST", `${path}/revisions`, { arrangement, note: "two" });
  expect(saved).toMatchObject({ arrangement, note: "two", length: 62 });
  await ok("POST", `${path}/revisions`, { arrangement, note: "" });

  const read = await ok("GET", path);
  expect(read.track.id).toBe(made.track.id);
  expect(read.vibe).toEqual({ id: vibe.id, name: VIBE.name });
  expect(read.revisions.map((/** @type {any} */ row) => row.note)).toEqual(["", "two", ""]);
  expect(read.revisions.map((/** @type {any} */ row) => row.length)).toEqual([0, 62, 62]);
  expect(read.sketches).toEqual([
    {
      id: sketch.id,
      candidateId: sketch.candidateId,
      intent: "a slow cold drone",
      notes: "keep",
      tags: ["cold"],
      duration: droneGenome.duration,
      excerpt: null,
    },
  ]);
  const listed = await ok("GET", `/api/vibes/${vibe.id}/tracks`);
  expect(listed.tracks.map((/** @type {any} */ row) => [row.id, row.revision.note])).toEqual([
    [made.track.id, ""],
  ]);
});

test("a malformed arrangement is refused with every path, and nothing is saved", async () => {
  const { server, ok, vibe, sketch } = await setup();
  const { track } = await ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "t" });
  const arrangement = twoSections(sketch.id);
  arrangement.sections[0] = { sketchId: 999, offset: 0, seconds: 30 };
  arrangement.sections[1] = { sketchId: sketch.id, offset: 61, seconds: 40 };
  const reply = await server.api("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement,
    note: "",
  });
  expect(reply.status).toBe(400);
  const { error } = reply.json();
  expect(error).toContain("$.sections[0].sketchId: there is no sketch 999");
  expect(error).toContain("$.sections[1].offset: must be under its sketch's 60 s");
  expect(listTrackRevisions(server.store, track.id)).toHaveLength(1);
});

test("a sketch of another brief can't be placed", async () => {
  const studio = await setup();
  const { ok, server, vibe } = studio;
  const other = await ok("POST", "/api/vibes", { ...VIBE, name: "other" });
  const elsewhere = seedSketch(studio, other);
  const { track } = await ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "t" });
  const arrangement = {
    ...emptyArrangement(),
    sections: [{ sketchId: elsewhere.id, offset: 0, seconds: 30 }],
  };
  const reply = await server.api("POST", `/api/tracks/${track.id}/revisions`, {
    arrangement,
    note: "",
  });
  expect(reply.status).toBe(400);
  expect(reply.json().error).toMatch(/\$\.sections\[0\]\.sketchId: sketch \d+ is of another vibe/);
});

test("a removed track keeps its rows and answers 404", async () => {
  const { server, ok, vibe } = await setup();
  const { track } = await ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "gone" });
  const removed = await ok("POST", `/api/tracks/${track.id}/remove`, {});
  expect(removed.track.removedReason).toBe("removed");
  expect((await server.api("GET", `/api/tracks/${track.id}`)).status).toBe(404);
  expect((await ok("GET", `/api/vibes/${vibe.id}/tracks`)).tracks).toEqual([]);
  expect(listTrackRevisions(server.store, track.id)).toHaveLength(1);
});

test("a section's player renders its own window, cut at the sketch's end", async () => {
  const { server, ok, vibe, sketch } = await setup();
  const { track } = await ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "t" });
  const path = `/api/tracks/${track.id}/section-audio`;
  const job = await ok("POST", path, { sketchId: sketch.id, offset: 48, seconds: 30 });
  expect(job.kind).toBe("section-audio");
  await server.jobs.settled(job.id);
  const done = await ok("GET", `/api/jobs/${job.id}`);
  expect(done.state).toBe("done");
  expect(done.result).toMatchObject({ offset: 48, duration: 12, cached: false });
  const audio = await server.request("GET", done.result.url);
  expect(audio.status).toBe(200);
  expect(audio.headers["content-type"]).toBe("audio/mpeg");

  const again = await ok("POST", path, { sketchId: sketch.id, offset: 48, seconds: 30 });
  await server.jobs.settled(again.id);
  expect((await ok("GET", `/api/jobs/${again.id}`)).result).toMatchObject({
    renderId: done.result.renderId,
    cached: true,
  });
  const refused = await server.api("POST", path, { sketchId: sketch.id, offset: 60, seconds: 30 });
  expect(refused.status).toBe(400);
  expect(refused.json().error).toContain("$.sections[0].offset");
});

test("a second section job while one is unfinished is a 409 naming it", async () => {
  const { server, ok, vibe, sketch } = await setup();
  const { track } = await ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "t" });
  // A job holding the runner keeps the section job queued, with no race on its render.
  /** @type {() => void} */
  let release = () => {};
  const held = server.jobs.add(
    "hold",
    () => new Promise((resolve) => (release = () => resolve(null))),
  );
  const path = `/api/tracks/${track.id}/section-audio`;
  const first = await ok("POST", path, { sketchId: sketch.id, offset: 0, seconds: 10 });
  const second = await server.api("POST", path, { sketchId: sketch.id, offset: 20, seconds: 10 });
  expect(second.status).toBe(409);
  expect(second.json()).toMatchObject({
    jobId: first.id,
    error: expect.stringContaining(`already being rendered to play (job ${first.id})`),
  });
  server.jobs.cancel(first.id);
  release();
  await server.jobs.settled(held.id);
});

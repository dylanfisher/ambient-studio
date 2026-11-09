// The material panel's actions (decision 0066), with no DOM. Placing an elite goes through the
// real server's sketch and track routes: it is kept as a sketch first, then placed as a section,
// and the revision saves. A steer's setting moves a step from the section's position, its best
// point is kept as a sketch, and the swap keeps the section's window. Candidates and their
// excerpts are seeded in the store, and nothing is rendered.
/** @import { Render } from "../../src/server/render-store.js" */
/** @import { Studio } from "../support/studio.js" */
import { afterEach, expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import { addRatedAudio } from "../../src/server/rating-store.js";
import { getRender } from "../../src/server/render-store.js";
import { getVibe } from "../../src/server/vibe-store.js";
import { NO_OPEN_SESSION } from "../../src/web/brief-jobs.js";
import {
  keepSteered,
  placeElite,
  STEER_STEP,
  SWAP,
  steerBody,
  steerSetting,
  steerSwap,
  swapSketch,
  TOWARD,
} from "../../src/web/material-actions.js";
import { materialPanel } from "../../src/web/material-panel.js";
import { mapGenome, seedMapCandidate } from "../support/map-fixtures.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

test("an elite placed is kept as a sketch first, then becomes a section that saves", async () => {
  const studio = await startStudio();
  studios.push(studio);
  const { ok, server } = studio;
  const { vibe, session } = await studio.openSession();
  const row = /** @type {NonNullable<ReturnType<typeof getVibe>>} */ (
    getVibe(server.store, vibe.id)
  );
  for (const [motion, centroidMean] of /** @type {[number, number][]} */ ([
    [0.2, 300],
    [0.8, 900],
  ])) {
    await seedMapCandidate(server.store, server.paths, {
      vibeId: vibe.id,
      vibeRevisionId: row.revision.id,
      sessionId: session.id,
      target: VIBE.constraints.loudness,
      genome: mapGenome(motion),
      heard: { centroidMean },
    });
  }
  await ok("POST", `/api/vibes/${vibe.id}/axes`, {
    axes: [
      { source: "feature", name: "centroidMean" },
      { source: "macro", name: "motion" },
    ],
  });
  const { track } = await ok("POST", `/api/vibes/${vibe.id}/tracks`, { name: "placed" });
  const trackPath = `/api/tracks/${track.id}`;
  const archive = await ok("GET", `/api/vibes/${vibe.id}/archive`);
  // Each excerpt's rated copy, so keeping it as a sketch renders nothing again.
  for (const { renderId } of archive.cells) {
    const { genomeId, seed, offset, duration, target } = /** @type {Render} */ (
      getRender(server.store, renderId)
    );
    addRatedAudio(server.store, {
      genomeId,
      seed,
      offset,
      duration,
      target,
      engineVersion: ENGINE_VERSION,
      file: `heard-${renderId}.flac`,
      pcmSha256: "0".repeat(64),
      gainDb: 0,
    });
  }
  const read = await ok("GET", trackPath);
  expect(read.sketches).toEqual([]);
  const panel = materialPanel({ sketches: read.sketches, archive, steering: null, regions: [] });
  const elite = /** @type {(typeof panel.elites)[number]} */ (panel.elites[0]);
  expect(elite.sketchId).toBeNull();

  const io = {
    sessionId: session.id,
    keep: (/** @type {string} */ path, /** @type {Record<string, unknown>} */ body) =>
      ok("POST", path, body),
    reload: async () => (await ok("GET", trackPath)).sketches,
  };
  const placed = await placeElite(emptyArrangement(), null, elite, {
    ...io,
    sketches: read.sketches,
  });
  expect(placed.made).toBe(true);
  expect(placed.sketch.candidateId).toBe(elite.cell.candidateId);
  expect(placed.index).toBe(0);
  expect(placed.arrangement.sections).toEqual([
    {
      sketchId: placed.sketch.id,
      offset: 0,
      seconds: expect.any(Number),
      text: "",
      developmentId: null,
    },
  ]);
  const saved = await ok("POST", `${trackPath}/revisions`, {
    arrangement: placed.arrangement,
    note: "",
  });
  expect(saved.arrangement.sections[0].sketchId).toBe(placed.sketch.id);

  // Placed again, the elite names the sketch it was kept as, and no second one is kept.
  const sketches = await io.reload();
  const again = materialPanel({ sketches, archive, steering: null, regions: [] }).elites[0];
  expect(again?.sketchId).toBe(placed.sketch.id);
  const twice = await placeElite(placed.arrangement, 0, /** @type {typeof elite} */ (again), {
    ...io,
    sketches,
  });
  expect(twice).toMatchObject({ made: false, index: 1, sketch: { id: placed.sketch.id } });
  expect(twice.arrangement.sections.map(({ sketchId }) => sketchId)).toEqual([
    placed.sketch.id,
    placed.sketch.id,
  ]);
  expect(await io.reload()).toHaveLength(1);

  // An elite not yet kept needs an open session to be kept in.
  const other = /** @type {typeof elite} */ (panel.elites[1]);
  await expect(
    placeElite(emptyArrangement(), null, other, { ...io, sketches, sessionId: null }),
  ).rejects.toThrow(NO_OPEN_SESSION);
});

test("a steer aims a step from the section's position toward the end chosen, held in 0 to 1", () => {
  expect(steerSetting(0.4, TOWARD.far)).toBe(0.4 + STEER_STEP);
  expect(steerSetting(0.4, TOWARD.near)).toBeCloseTo(0.15, 10);
  expect(steerSetting(0.9, TOWARD.far)).toBe(1);
  expect(steerSetting(-0.3, TOWARD.near)).toBe(0);
  // A sketch not placed yet aims at the end itself.
  expect(steerSetting(null, TOWARD.far)).toBe(1);
  expect(steerSetting(null, TOWARD.near)).toBe(0);
  expect(steerBody(31, { directionId: 4, position: 0.5 }, TOWARD.far)).toEqual({
    candidateId: 31,
    directions: [{ id: 4, setting: 0.75 }],
  });
});

test("a steer's best point is kept as a sketch by its excerpt, and a steer with none says so", async () => {
  /** @type {[string, Record<string, unknown>][]} */
  const posted = [];
  const io = {
    sessionId: 3,
    candidates: async () => [
      { id: 40, excerpt: { renderId: 400 } },
      { id: 41, excerpt: { renderId: 410 } },
    ],
    keep: async (/** @type {string} */ path, /** @type {Record<string, unknown>} */ body) => {
      posted.push([path, body]);
      return { id: 9, candidateId: Number(body.candidateId), duration: 300 };
    },
  };
  const kept = await keepSteered({ best: { candidateId: 41, score: 0.3 } }, io);
  expect(kept).toEqual({ id: 9, candidateId: 41, duration: 300 });
  expect(posted).toEqual([
    ["/api/sessions/3/sketches", { candidateId: 41, renderId: 410, notes: "", tags: [] }],
  ]);
  await expect(keepSteered({ best: null }, io)).rejects.toThrow(/no point/);
  await expect(keepSteered({ best: { candidateId: 99, score: 0 } }, io)).rejects.toThrow(
    /candidate 99 has no excerpt/,
  );
});

test("a swap names the steered sketch and keeps the section's window", () => {
  const arrangement = {
    ...emptyArrangement(),
    sections: [
      { sketchId: 1, offset: 30, seconds: 120, text: "", developmentId: null },
      { sketchId: 2, offset: 0, seconds: 90, text: "brighter toward the end", developmentId: null },
    ],
    transitions: [{ kind: "crossfade", seconds: 8, text: "" }],
  };
  const swapped = swapSketch(arrangement, 1, 7);
  expect(swapped.sections).toEqual([
    { sketchId: 1, offset: 30, seconds: 120, text: "", developmentId: null },
    { sketchId: 7, offset: 0, seconds: 90, text: "brighter toward the end", developmentId: null },
  ]);
  expect(swapped.transitions).toBe(arrangement.transitions);
  expect(arrangement.sections[1]?.sketchId).toBe(2);
});

test("a finished steer swaps in only on the line of versions it started on, and only into its own section", () => {
  const from = { sketchId: 2, offset: 0, seconds: 90, text: "", developmentId: null };
  const other = { sketchId: 1, offset: 30, seconds: 120, text: "", developmentId: null };
  const arrangement = {
    ...emptyArrangement(),
    sections: [other, from],
    transitions: [{ kind: "crossfade", seconds: 8, text: "" }],
  };
  const started = { from, at: 1, openedThen: 3 };
  // Edited since but not saved: put on the timeline for the owner to save.
  expect(steerSwap({ ...started, arrangement, openedNow: 3, unsaved: true })).toEqual({
    kind: SWAP.edit,
    index: 1,
  });
  // Saved since, with the section moved first: saved in its new place.
  const moved = { ...arrangement, sections: [from, other] };
  expect(steerSwap({ ...started, arrangement: moved, openedNow: 3, unsaved: false })).toEqual({
    kind: SWAP.save,
    index: 0,
  });
  // Another version opened by hand, even one holding the same section: left alone.
  expect(steerSwap({ ...started, arrangement, openedNow: 4, unsaved: false })).toEqual({
    kind: SWAP.skip,
    reason: "another version was opened while it ran",
  });
  // The section removed since.
  const removed = { ...arrangement, sections: [other] };
  expect(steerSwap({ ...started, arrangement: removed, openedNow: 3, unsaved: true })).toEqual({
    kind: SWAP.skip,
    reason: "its section has changed or been removed since",
  });
  // Words written on the section since: still its window, so still swapped in.
  const worded = { ...arrangement, sections: [other, { ...from, text: "let it thin out" }] };
  expect(steerSwap({ ...started, arrangement: worded, openedNow: 3, unsaved: true })).toEqual({
    kind: SWAP.edit,
    index: 1,
  });
});

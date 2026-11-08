// A brief's map through the HTTP server (decision 0057): choosing its axes, which replaces the
// live ones and makes no revision, and reading the map, rebuilt from the stored candidates.
// Candidates and their excerpts are seeded in the store, nothing is rendered, and the brief has
// no taste model and no axis on sound, so no route reaches the sidecar.
/** @import { Studio } from "../support/studio.js" */
import { afterAll, beforeAll, expect, test } from "vitest";
import { getAttachment } from "../../src/server/attachment-store.js";
import { markRemoved, TABLE } from "../../src/server/store.js";
import { CHOOSE_AXES } from "../../src/server/vibe-archive.js";
import { getVibe } from "../../src/server/vibe-store.js";
import { mapGenome, seedMapCandidate } from "../support/map-fixtures.js";
import { removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio} */
let studio;

beforeAll(async () => {
  studio = await startStudio();
});
afterAll(async () => {
  await removeStudio(studio);
});

const TWO = [
  { source: "feature", name: "centroidMean" },
  { source: "macro", name: "motion" },
];

test("choosing axes stores one row each with its bins, replaces the live ones, and makes no revision", async () => {
  const vibe = await studio.ok("POST", "/api/vibes", { ...VIBE, name: "axes" });
  const path = `/api/vibes/${vibe.id}/axes`;
  const two = await studio.ok("POST", path, { axes: TWO });
  expect(two.axes.map((/** @type {any} */ row) => row.details)).toEqual([
    { source: "feature", name: "centroidMean", ends: [null, null], bins: 8 },
    { source: "macro", name: "motion", ends: [null, null], bins: 8 },
  ]);
  const three = await studio.ok("POST", path, {
    axes: [...TWO, { source: "feature", name: "flatness", low: 0.05, high: 0.4 }],
  });
  expect(three.axes.map((/** @type {any} */ row) => [row.details.bins, row.details.ends])).toEqual([
    [6, [null, null]],
    [6, [null, null]],
    [6, [0.05, 0.4]],
  ]);
  for (const { id } of two.axes) {
    expect(getAttachment(studio.server.store, id)?.removedReason).toBe("axes replaced");
  }
  const listed = await studio.ok("GET", `/api/vibes/${vibe.id}/attachments`);
  expect(listed.axes.map((/** @type {any} */ axis) => axis.name)).toEqual([
    "centroidMean",
    "motion",
    "flatness",
  ]);
  const { revisions } = await studio.ok("GET", `/api/vibes/${vibe.id}/revisions`);
  expect(revisions).toHaveLength(1);

  /** @type {[unknown, string | RegExp][]} */
  const cases = [
    [{ axes: TWO.slice(0, 1) }, "axes must be a list of two or three axes"],
    [{ axes: [...TWO, ...TWO] }, "axes must be a list of two or three axes"],
    [{ axes: [TWO[0], TWO[0]] }, "each axis must read something different"],
    [{ axes: [TWO[0], { source: "loudness" }] }, /^source must be one of feature, macro/],
    [{ axes: [TWO[0], { source: "feature", name: "truePeak" }] }, /not a feature a range may name/],
    [
      { axes: [TWO[0], { source: "direction", directionId: 999 }] },
      "direction 999 isn't on this brief",
    ],
    [
      { axes: [TWO[0], { source: "region", regionId: 5 }] },
      "region 5 isn't attached to this brief",
    ],
    [
      { axes: [TWO[0], { ...TWO[1], low: 0.8, high: 0.2 }] },
      "its low end must be under its high end",
    ],
    [{ axes: [TWO[0], { ...TWO[1], low: "a" }] }, "axes[1].low must be a number"],
  ];
  for (const [body, error] of cases) {
    const reply = await studio.server.api("POST", path, body);
    expect(reply.status, JSON.stringify(body)).toBe(400);
    expect(reply.json().error).toMatch(error);
  }
  // A refused choice keeps the axes there were.
  const after = await studio.ok("GET", `/api/vibes/${vibe.id}/attachments`);
  expect(after.axes).toHaveLength(3);
});

test("a fill is refused before it is added while the map has no axes, and fails with the reason on an empty map", async () => {
  const vibe = await studio.ok("POST", "/api/vibes", { ...VIBE, name: "fill" });
  const session = await studio.ok("POST", `/api/vibes/${vibe.id}/sessions`, {});
  const path = `/api/sessions/${session.id}/fills`;
  const refused = await studio.server.api("POST", path, {});
  expect(refused.status).toBe(409);
  expect(refused.json().error).toBe(CHOOSE_AXES);
  for (const body of [{ budget: 0 }, { budget: 401 }, { exploreShare: 1.5 }, { control: "yes" }]) {
    expect((await studio.server.api("POST", path, body)).status, JSON.stringify(body)).toBe(400);
  }
  await studio.ok("POST", `/api/vibes/${vibe.id}/axes`, { axes: TWO });
  const job = await studio.ok("POST", path, { budget: 3 });
  expect(job.kind).toBe("elite");
  await studio.server.jobs.settled(job.id);
  expect(studio.server.jobs.get(job.id)).toMatchObject({
    state: "failed",
    error: expect.stringMatching(/^Axis 1 of the map: Its ends can.t be set yet/),
  });
});

test("the map places each live valid candidate by its excerpt, its elite the fewest misses then the newest", async () => {
  const { store, paths } = studio.server;
  const made = await studio.ok("POST", "/api/vibes", {
    ...VIBE,
    name: "map",
    softTargets: { features: { centroidMean: [200, 1000], flatness: [0, 0.2] } },
  });
  const vibe = /** @type {NonNullable<ReturnType<typeof getVibe>>} */ (getVibe(store, made.id));
  const session = await studio.ok("POST", `/api/vibes/${vibe.id}/sessions`, {});
  const archivePath = `/api/vibes/${vibe.id}/archive`;
  const none = await studio.ok("GET", archivePath);
  expect(none).toMatchObject({ reason: CHOOSE_AXES, cells: [], coverage: 0 });

  /**
   * @param {number} centroid
   * @param {number} motion
   * @param {Record<string, unknown>} [rest]
   */
  const seed = (centroid, motion, rest = {}) =>
    seedMapCandidate(store, paths, {
      vibeId: vibe.id,
      vibeRevisionId: vibe.revision.id,
      sessionId: session.id,
      target: VIBE.constraints.loudness,
      genome: mapGenome(motion),
      heard: { centroidMean: centroid },
      ...rest,
    });
  const a = await seed(250, 0.1, { intent: "low and still" });
  const b = await seed(950, 0.9, { intent: "bright and moving" });
  const c = await seed(260, 0.12, { intent: "low, a little less still" });
  // Newer than c, in the same cell, but it misses the flatness range.
  const d = await seed(255, 0.11, { heard: { centroidMean: 255, flatness: 0.5 } });
  const removed = await seed(600, 0.5);
  markRemoved(store, TABLE.candidates, removed.id, "test");
  await seed(600, 0.6, { rejected: true });

  await studio.ok("POST", `/api/vibes/${vibe.id}/axes`, { axes: TWO });
  const map = await studio.ok("GET", archivePath);
  expect(map.reason).toBeNull();
  expect(map.model).toBe(false);
  // The centroid's ends are the brief's range; the motion's the excerpts' 10th and 90th
  // percentiles, which leave out the removed and the rejected candidate.
  const [centroid, motion] = map.axes;
  expect([centroid.low, centroid.high]).toEqual([200, 1000]);
  // A macro's value is its mean over the window, summed one second at a time.
  expect(motion.low).toBeCloseTo(0.1, 12);
  expect(motion.high).toBeCloseTo(0.9, 12);
  expect(map).toMatchObject({ shape: [8, 8], total: 64, filled: 2, placed: 4, unplaced: 0 });
  expect(map.coverage).toBe(2 / 64);
  expect(
    map.cells.map((/** @type {any} */ cell) => [cell.index, cell.candidateId, cell.count]),
  ).toEqual([
    [[0, 0], c.id, 3],
    [[7, 7], b.id, 1],
  ]);
  expect(map.cells[0]).toMatchObject({ intent: "low, a little less still", misses: 0 });
  expect([a.id, d.id]).not.toContain(map.cells[0].candidateId);

  // A low end the owner gives at or past the excerpts' 90th percentile says so.
  await studio.ok("POST", `/api/vibes/${vibe.id}/axes`, {
    axes: [TWO[0], { ...TWO[1], low: 0.95 }],
  });
  const crossed = await studio.ok("GET", archivePath);
  expect(crossed.cells).toEqual([]);
  expect(crossed.reason).toBe(
    "Its low end, 0.95, isn't under the high end the brief's excerpts give it (their 90th percentile); give the axis a high end too, or a lower low end.",
  );
});

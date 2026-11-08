// The map's fill job (decision 0057): medium nudges of elites beside empty cells, as many as the
// budget, the live locks kept, and a control of as many nudges from the starting elites, both
// coverages counted from the cells. The map's axes are two macros, which a genome names, so a
// scripted excerpt (a render row and an empty file) places each child with nothing rendered and
// no sidecar asked.
/** @import { Candidate } from "../../src/server/generation-store.js" */
/** @import { JobContext } from "../../src/server/job-runner.js" */
/** @import { PlaceExcerpt } from "../../src/server/fill-job.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { afterEach, expect, test } from "vitest";
import { ATTACHMENT_KIND, AXIS_BINS } from "../../src/domain/attachment-kind.js";
import { OPERATOR } from "../../src/domain/operator.js";
import { lockOn } from "../../src/domain/validate-lock.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { addAttachment } from "../../src/server/attachment-store.js";
import { fillJob, readFillResults } from "../../src/server/fill-job.js";
import { getCandidate, getGenome } from "../../src/server/generation-store.js";
import { setLock } from "../../src/server/lock-store.js";
import { startSession } from "../../src/server/session-store.js";
import { readArchive } from "../../src/server/vibe-archive.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { mapGenome, seedMapCandidate, seedMapRender } from "../support/map-fixtures.js";
import { VIBE } from "../support/studio.js";
import { testApp } from "../support/test-app.js";

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

const BINS = /** @type {number} */ (AXIS_BINS[2]);
const TARGET = VIBE.constraints.loudness;
const LOCKED = ["reverbDecay", "voices.drone.cutoff"];

/** @type {PlaceExcerpt} */
const scriptedPlace = async (app, candidate) => {
  await seedMapRender(app.store, app.paths, {
    genomeId: /** @type {number} */ (candidate.genomeId),
    target: TARGET,
    heard: {},
  });
  return { render: 1, embed: 0 };
};

/**
 * @param {TestApp["app"]} app
 * @param {Candidate} candidate
 */
const genomeOf = (app, candidate) =>
  requireGenome(
    getGenome(app.store, /** @type {number} */ (candidate.genomeId))?.genome,
    `candidate ${candidate.id}'s genome`,
  );

/**
 * The cell a genome's motion and brightness put it in, on ends 0 to 1.
 * @param {TestApp["app"]} app
 * @param {Candidate} candidate
 */
function cellOf(app, candidate) {
  const { macros } = genomeOf(app, candidate);
  return [macros?.motion, macros?.brightness].map((value) =>
    Math.min(BINS - 1, Math.floor(Number(value) * BINS)),
  );
}

/**
 * The candidates that store `operator`, oldest first.
 * @param {TestApp["app"]} app
 * @param {string} operator
 * @returns {Candidate[]}
 */
const withOperator = (app, operator) =>
  app.store.db
    .prepare("SELECT id FROM candidates WHERE operator = ? ORDER BY id")
    .all(operator)
    .map(({ id }) => /** @type {Candidate} */ (getCandidate(app.store, Number(id))));

/**
 * A brief whose map's axes are motion and brightness from 0 to 1, with three candidates in a
 * session: two in one cell, the newer the elite there, and one in another.
 */
async function mapApp() {
  const made = await testApp();
  apps.push(made);
  const { app } = made;
  const vibe = createVibe(app.store, VIBE);
  const session = startSession(app.store, vibe.id);
  /** @param {number} motion @param {number} brightness */
  const seed = (motion, brightness) =>
    seedMapCandidate(app.store, app.paths, {
      vibeId: vibe.id,
      vibeRevisionId: vibe.revision.id,
      sessionId: session.id,
      target: TARGET,
      genome: mapGenome(motion, brightness),
    });
  const older = await seed(0.31, 0.31);
  const elite = await seed(0.33, 0.33);
  const other = await seed(0.81, 0.62);
  for (const name of ["motion", "brightness"]) {
    addAttachment(app.store, {
      vibeId: vibe.id,
      kind: ATTACHMENT_KIND.axis,
      regionId: null,
      details: { source: "macro", name, ends: [0, 1], bins: BINS },
    });
  }
  return { app, vibe, session, seed, older, elite, other };
}

test("the fill stops at its budget, nudges only elites beside an empty cell, keeps the locks, and counts both coverages from the cells", async () => {
  const { app, vibe, session, older, elite, other } = await mapApp();
  const values = LOCKED.map((path) => {
    const taken = lockOn(mapGenome(0.33, 0.33), path);
    if (!taken.ok) throw new Error(taken.message);
    setLock(app.store, {
      vibeId: vibe.id,
      candidateId: elite.id,
      path,
      value: taken.lock.value,
      voiceType: taken.lock.voiceType ?? null,
    });
    return taken.lock.value;
  });
  const before = await readArchive(app, vibe.id, new AbortController().signal);
  expect(before.filled).toBe(2);

  /** @type {{ done: number, total: number }[]} */
  const reports = [];
  /** @type {JobContext} */
  const job = {
    signal: new AbortController().signal,
    progress: (done, total) => reports.push({ done, total }),
  };
  const budget = 6;
  const result = /** @type {any} */ (
    await fillJob(
      app,
      { vibeId: vibe.id, sessionId: session.id, budget, exploreShare: 0, control: true },
      { placeExcerpt: scriptedPlace },
    )(job)
  );
  expect(result.steps).toBe(budget);
  expect(result.explores).toBe(0);
  expect(Math.max(...reports.map(({ done }) => done))).toBe(2 * budget);

  const children = withOperator(app, OPERATOR.elite);
  const steps = new Set(
    children.map(({ operatorParams }) => /** @type {any} */ (operatorParams).step),
  );
  expect(steps.size).toBe(budget);
  for (const child of children) {
    expect(child.sessionId).toBe(session.id);
    expect(child.parentIds[0]).not.toBe(older.id);
    expect(child.operatorParams).toMatchObject({ stepSize: "medium" });
  }
  const valid = children.filter(({ genomeId }) => genomeId !== null);
  expect(valid.length).toBeGreaterThan(0);
  for (const child of valid) {
    const genome = genomeOf(app, child);
    expect(LOCKED.map((path) => lockOn(genome, path))).toEqual(
      values.map((value) =>
        expect.objectContaining({ ok: true, lock: expect.objectContaining({ value }) }),
      ),
    );
    // Each step aimed at a cell one step from its parent's along one axis.
    const parent = /** @type {Candidate} */ (
      getCandidate(app.store, /** @type {number} */ (child.parentIds[0]))
    );
    const to = /** @type {number[]} */ (/** @type {any} */ (child.operatorParams).to);
    const from = cellOf(app, parent);
    expect(
      to.reduce((sum, bin, i) => sum + Math.abs(bin - /** @type {number} */ (from[i])), 0),
    ).toBe(1);
  }

  const after = await readArchive(app, vibe.id, new AbortController().signal);
  expect(result.filled.start).toBe(2);
  expect(result.filled.fill).toBe(after.filled);
  expect(result.coverage.fill).toBe(after.filled / (BINS * BINS));

  // The control: as many nudges from the elites beside an empty cell at the start, outside any
  // session, and its coverage the cells they and the starting map fill.
  const control = withOperator(app, OPERATOR.eliteControl);
  expect(new Set(control.map(({ parentIds }) => parentIds[0]))).toEqual(
    new Set([elite.id, other.id]),
  );
  expect(control.every(({ sessionId }) => sessionId === null)).toBe(true);
  const placed = [elite, other, ...control.filter(({ genomeId }) => genomeId !== null)];
  const cells = new Set(placed.map((candidate) => cellOf(app, candidate).join()));
  expect(result.filled.control).toBe(cells.size);
  expect(result.coverage.control).toBe(cells.size / (BINS * BINS));
  expect(await readFillResults(app.paths.search, result.run)).toMatchObject({
    steps: budget,
    filled: result.filled,
    coverage: result.coverage,
  });
});

test("a share of the steps asks the model to explore from the elite toward the empty cell", async () => {
  const { app, vibe, session, seed, elite, other } = await mapApp();
  /** @type {{ baseId: number, direction: string | null }[]} */
  const asked = [];
  /** @type {import("../../src/server/fill-job.js").Explore} */
  const explore = (_app, request) => async () => {
    const from = /** @type {NonNullable<typeof request.explore>} */ (request.explore);
    asked.push({ baseId: from.base.id, direction: from.direction });
    const child = await seed(0.05 + 0.1 * asked.length, 0.95);
    return { candidateIds: [child.id] };
  };
  const job = { signal: new AbortController().signal, progress: () => undefined };
  const result = /** @type {any} */ (
    await fillJob(
      app,
      { vibeId: vibe.id, sessionId: session.id, budget: 4, exploreShare: 0.5, control: false },
      { placeExcerpt: scriptedPlace, explore },
    )(job)
  );
  expect(result).toMatchObject({ steps: 4, explores: 2, control: null });
  expect(result.coverage.control).toBeNull();
  expect(asked).toHaveLength(2);
  const words = ["more motion", "less motion", "more brightness", "less brightness"];
  for (const { baseId, direction } of asked) {
    expect([elite.id, other.id, ...result.candidateIds]).toContain(baseId);
    expect(words.map((way) => `Toward ${way}`)).toContain(direction);
  }
  expect(
    withOperator(app, OPERATOR.elite).map(
      ({ operatorParams }) => /** @type {any} */ (operatorParams).step,
    ),
  ).toEqual(expect.arrayContaining([0, 2]));
});

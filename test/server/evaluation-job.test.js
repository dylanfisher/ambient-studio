// The evaluation job run directly with a signal the test controls (decisions 0030 and 0040). No
// test reaches the real omlx. In revision mode each excerpt's render row is written to the store
// just before the job reads it, with features chosen by its genome, so nothing is rendered.
/** @import { App } from "../../src/server/routing.js" */
/** @import { JobContext } from "../../src/server/job-runner.js" */
/** @import { TestApp } from "../support/test-app.js" */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { REVISION_VERDICT } from "../../src/domain/evaluation-report.js";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { targetsText } from "../../src/domain/targets-text.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { currentExcerpt, excerptRequest } from "../../src/server/candidate-excerpt.js";
import { STREAM_SEEDS } from "../../src/server/candidate-job.js";
import { evaluationJob } from "../../src/server/evaluation-job.js";
import { listEvaluations } from "../../src/server/evaluation-store.js";
import {
  controlSeed,
  requestGroupName,
  revisionSeed,
} from "../../src/server/generate-candidates.js";
import {
  addCandidate,
  getCandidate,
  getGenome,
  putGenome,
} from "../../src/server/generation-store.js";
import { genomeHash } from "../../src/server/genome-hash.js";
import { locksInForce, setLock } from "../../src/server/lock-store.js";
import { PRODUCER } from "../../src/server/producer.js";
import { putRender } from "../../src/server/render-store.js";
import { createVibe, getVibe, reviseVibe } from "../../src/server/vibe-store.js";
import { driveGaps } from "../support/fake-clock.js";
import { VIBE } from "../support/studio.js";
import { testApp } from "../support/test-app.js";

/** @type {TestApp[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

test("a cancel that lands before the job listens for it, as during indexing, sends nothing", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx } = made;
  const vibe = createVibe(app.store, /** @type {any} */ (SEED_VIBES["cold-dorian"]));
  const run = evaluationJob(app, { vibeIds: [vibe.id], count: 2, revise: false });
  const signal = AbortSignal.abort(new Error("job 1 was cancelled"));

  await expect(run({ signal, progress: () => undefined })).rejects.toThrow(/cancelled/);
  expect(omlx.requests).toHaveLength(0);
  expect(listEvaluations(app.store)).toEqual([]);
});

test("progress counts candidates across every vibe, and says which one is being asked for", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx, clock } = made;
  const vibes = ["cold-dorian", "bell-field"].map((id) =>
    createVibe(app.store, /** @type {any} */ (SEED_VIBES[id])),
  );
  // Answers with no JSON are rejected without a repair, so each vibe takes one request.
  omlx.script({ tokens: ["no genome"] }, { tokens: ["no genome"] });
  /** @type {[number, number, string | null][]} */
  const reports = [];
  const run = evaluationJob(app, { vibeIds: vibes.map(({ id }) => id), count: 1, revise: false });
  await driveGaps(
    clock,
    app.config.queue.minGapMs,
    run({
      signal: new AbortController().signal,
      progress: (done, total, step) => reports.push([done, total, step]),
    }),
  );
  expect(reports).toEqual([
    [0, 2, null],
    [0, 2, "Asking the model for candidate 1 of 2"],
    [1, 2, null],
    [1, 2, "Asking the model for candidate 2 of 2"],
    [2, 2, null],
  ]);
});

test("the evaluation's prompt carries no locks while the vibe has some", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx, clock } = made;
  const vibe = createVibe(app.store, /** @type {any} */ (SEED_VIBES["cold-dorian"]));
  const candidate = addCandidate(app.store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: null,
    genomeId: putGenome(app.store, vibe.id, droneGenome).id,
    seed: 1,
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
  setLock(app.store, {
    vibeId: vibe.id,
    candidateId: candidate.id,
    path: "reverbDecay",
    value: droneGenome.reverbDecay,
    voiceType: null,
  });
  expect(locksInForce(app.store, vibe.id)).toHaveLength(1);
  omlx.script({ tokens: ["no genome"] });
  const run = evaluationJob(app, { vibeIds: [vibe.id], count: 1, revise: false });
  await driveGaps(
    clock,
    app.config.queue.minGapMs,
    run({ signal: new AbortController().signal, progress: () => undefined }),
  );
  expect(omlx.requests).toHaveLength(1);
  expect(omlx.requests[0]?.body.messages[1].content).not.toContain("Locked by the owner");
});

// Revision mode (decision 0040). Four genomes the test measures by hash: a first try inside the
// range, one outside it, a revision that lands inside and one that stays outside.
const RANGED = { ...VIBE, softTargets: { features: { lowEndShare: [null, 0.5] } } };
const FITS = { ...droneGenome, delayLevel: -30 };
const MISSES = { ...droneGenome, delayLevel: -31 };
const FIXED = { ...droneGenome, delayLevel: -32 };
const STILL = { ...droneGenome, delayLevel: -33 };
/** Two genomes inside the range whose excerpts fail a render check. */
const CLIPS = { ...droneGenome, delayLevel: -34 };
const CLIPS_AGAIN = { ...droneGenome, delayLevel: -35 };
const CLIPPING = { path: "$", rule: "clipping", message: "the excerpt clips 12 samples" };
/** Low-end share and failed checks by genome hash: a share under the range's 0.5 is inside. */
const MEASURES = new Map([
  [genomeHash(FITS), { lowEndShare: 0.3, findings: [] }],
  [genomeHash(MISSES), { lowEndShare: 0.8, findings: [] }],
  [genomeHash(FIXED), { lowEndShare: 0.3, findings: [] }],
  [genomeHash(STILL), { lowEndShare: 0.8, findings: [] }],
  [genomeHash(CLIPS), { lowEndShare: 0.3, findings: [CLIPPING] }],
  [genomeHash(CLIPS_AGAIN), { lowEndShare: 0.3, findings: [CLIPPING] }],
]);
const MISS = "low-end share is 0.8";
const MEASURED = "Measured on the excerpt: ";
/** The job's stream seed under the test app's `random`. */
const STREAM_SEED = Math.floor(0.25 * STREAM_SEEDS);

/** @param {unknown} genome */
const answer = (genome) => ({ tokens: [JSON.stringify({ intent: "a slow cold drone", genome })] });

/**
 * Writes a render row, and an empty file for it, for every candidate with a genome and no
 * excerpt yet, measured by `MEASURES`.
 * @param {App} app
 */
function seedExcerpts(app) {
  const { store, paths } = app;
  const rows = /** @type {{ id: number }[]} */ (
    store.db.prepare("SELECT id FROM candidates").all()
  );
  for (const { id } of rows) {
    const candidate = /** @type {any} */ (getCandidate(store, id));
    const request = excerptRequest(store, candidate);
    if (!request || currentExcerpt(store, paths.renderCache, candidate)) continue;
    const row = /** @type {any} */ (getGenome(store, request.genomeId));
    const measured = MEASURES.get(row.genomeHash);
    if (measured === undefined) throw new Error(`no measurement scripted for candidate ${id}`);
    const { lowEndShare, findings } = measured;
    const duration = EXCERPT_SECONDS;
    const offset = excerptOffset(row.genome, request.seed, duration);
    const file = `seeded-${id}.wav`;
    mkdirSync(paths.renderCache, { recursive: true });
    writeFileSync(join(paths.renderCache, file), "");
    putRender(store, {
      ...request,
      offset,
      duration,
      producer: PRODUCER,
      file,
      features: {
        raw: { loudness: -20, shortTermMax: -18, loudnessRange: 3, truePeak: -4 },
        heard: {
          gainDb: 4,
          centroidMean: 300,
          centroidSpread: 50,
          onsetRate: 0.1,
          lowEndShare,
          stereoWidth: 0.1,
          flatness: 0.01,
        },
      },
      checks: { ok: findings.length === 0, findings },
    });
  }
}

/**
 * Runs a revision-mode evaluation over new `RANGED` vibes, seeding each excerpt before it is
 * read. `onStep` sees each step sentence with the job's controller and the vibes' ids.
 * @param {TestApp} made
 * @param {number} vibes
 * @param {number} count
 * @param {(step: string, controller: AbortController, ids: number[]) => void} [onStep]
 */
function runRevisionMode(made, vibes, count, onStep) {
  const { app, clock } = made;
  const ids = Array.from({ length: vibes }, () => createVibe(app.store, RANGED).id);
  const controller = new AbortController();
  /** @type {string[]} */
  const steps = [];
  /** @type {JobContext} */
  const job = {
    signal: controller.signal,
    progress: (_done, _total, step) => {
      seedExcerpts(app);
      if (step === null) return;
      steps.push(step);
      onStep?.(step, controller, ids);
    },
  };
  const run = evaluationJob(app, { vibeIds: ids, count, revise: true });
  return { ids, steps, result: driveGaps(clock, app.config.queue.minGapMs, run(job)) };
}

/**
 * One vibe's answers as the plan scripts them: 24 first tries, every second one missing; of the
 * 12 that miss, the treatment fixes the first 10 and the control the 1st and the 11th, so 9 are
 * fixed by the treatment alone and 1 by the control alone. The arms are asked in the job's
 * order: the treatment first for an even pair, counted across the run from `firstPair`.
 * @param {number} firstPair
 */
function planScript(firstPair) {
  const answers = [];
  let k = 0;
  for (let i = 0; i < 24; i++) {
    if (i % 2 === 0) {
      answers.push(answer(FITS));
      continue;
    }
    answers.push(answer(MISSES));
    const treatment = answer(k < 10 ? FIXED : STILL);
    const control = answer(k === 0 || k === 10 ? FIXED : STILL);
    answers.push(...((firstPair + k) % 2 === 0 ? [treatment, control] : [control, treatment]));
    k++;
  }
  return answers;
}

test("the plan's script over two vibes: each reads its counts and is inconclusive, the pooled test passes", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx } = made;
  omlx.script(...planScript(0), ...planScript(12));
  const { ids, result } = runRevisionMode(made, 2, 24);
  const { evaluationId } = await result;

  expect(omlx.requests).toHaveLength(2 * (24 + 2 * 12));
  const [evaluation] = listEvaluations(app.store);
  expect(evaluation?.id).toBe(evaluationId);
  const { params, report } = /** @type {any} */ (evaluation);
  expect(params).toMatchObject({ vibeIds: ids, count: 24, revise: true, seed: STREAM_SEED });
  for (const vibe of report.vibes) {
    expect(vibe.ranges).toEqual(RANGED.softTargets.features);
    expect(vibe.revision).toMatchObject({
      measured: 24,
      firstTries: { count: 12, of: 24 },
      revised: 12,
      afterTreatment: { count: 10, of: 12 },
      afterControl: { count: 2, of: 12 },
      firstTriesAfterTreatment: { count: 22, of: 24 },
      pairs: { both: 1, treatmentOnly: 9, controlOnly: 1, neither: 1 },
      p: null,
      verdict: REVISION_VERDICT.inconclusive,
      unchanged: { treatment: 0, control: 0 },
    });
  }
  expect(report.overall.revision).toMatchObject({
    revised: 24,
    pairs: { both: 2, treatmentOnly: 18, controlOnly: 2, neither: 2 },
    verdict: REVISION_VERDICT.passes,
  });
  expect(report.overall.revision.p).toBeCloseTo(211 / 2 ** 20, 15);
  expect(report.revisionTiming.latencyMs.treatment.count).toBe(24);
  expect(report.revisionTiming.latencyMs.control.count).toBe(24);

  // The arms alternate: the control goes first in every odd pair.
  const followUps = omlx.requests.filter((r) => r.body.messages.length === 4);
  expect(followUps).toHaveLength(48);
  for (let k = 0; k < 24; k++) {
    const first = followUps[2 * k]?.body.messages[3].content;
    expect(first.includes(MEASURED), `pair ${k}`).toBe(k % 2 === 0);
  }

  const rows = /** @type {any[]} */ (
    app.store.db.prepare("SELECT id FROM candidates ORDER BY id").all()
  ).map(({ id }) => /** @type {any} */ (getCandidate(app.store, id)));
  const controls = rows.filter((c) => c.operator === "revise-control");
  expect(controls).toHaveLength(24);
  expect(rows.filter((c) => c.operator === "revise")).toHaveLength(24);
  expect(rows.every((c) => c.sessionId === null)).toBe(true);
  const firstTry = rows.find((c) => c.id === controls[0].parentIds[0]);
  const index = rows
    .filter((c) => c.operator === null && c.vibeRevisionId === firstTry.vibeRevisionId)
    .indexOf(firstTry);
  expect(controls[0].seed).toBe(controlSeed(STREAM_SEED, index));
  expect(controlSeed(STREAM_SEED, index)).not.toBe(revisionSeed(STREAM_SEED, index));
});

test("the arms differ only in the ask: the control holds the ranges and no measurement, and neither carries the vibe's locks", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx } = made;
  // The lock is taken once the run has made its vibe, before any revision is asked for.
  omlx.script(answer(MISSES), answer(FIXED), answer(MISSES));
  const { ids, steps, result } = runRevisionMode(made, 1, 1, (step) => {
    if (step !== "Asking the model for candidate 1 of 1") return;
    const vibeId = /** @type {number} */ (ids[0]);
    const candidate = addCandidate(app.store, {
      vibeRevisionId: /** @type {any} */ (getVibe(app.store, vibeId)).revision.id,
      generationId: null,
      sessionId: null,
      genomeId: putGenome(app.store, vibeId, FITS).id,
      seed: 1,
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
    setLock(app.store, {
      vibeId,
      candidateId: candidate.id,
      path: "reverbDecay",
      value: FITS.reverbDecay,
      voiceType: null,
    });
  });
  await result;
  expect(locksInForce(app.store, /** @type {number} */ (ids[0]))).toHaveLength(1);

  const [round0, treatment, control] = /** @type {[any, any, any]} */ (
    omlx.requests.map((r) => r.body)
  );
  expect(omlx.requests).toHaveLength(3);
  expect(treatment.messages.slice(0, 2)).toEqual(round0.messages);
  expect(control.messages.slice(0, 3)).toEqual(treatment.messages.slice(0, 3));
  for (const key of ["temperature", "top_p", "seed"]) {
    expect(treatment[key]).toBe(round0[key]);
    expect(control[key]).toBe(round0[key]);
  }
  const ranges = targetsText(/** @type {any} */ (RANGED.softTargets.features));
  const treatmentAsk = treatment.messages[3].content;
  const controlAsk = control.messages[3].content;
  expect(treatmentAsk).toContain(ranges);
  expect(treatmentAsk).toContain(MEASURED);
  expect(treatmentAsk).toContain(MISS);
  expect(controlAsk).toContain(ranges);
  expect(controlAsk).not.toContain("Measured");
  expect(controlAsk).not.toContain(MISS);
  expect(controlAsk).not.toContain("misses");
  for (const body of [round0, treatment, control]) {
    expect(JSON.stringify(body.messages)).not.toContain("Locked by the owner");
  }
  expect(steps).toContain("Asking the model for the control revision of candidate 1 of 1");
  expect(steps).toContain("Rendering the revision of candidate 1 of 1");
  expect(steps).not.toContain("Rendering the control revision of candidate 1 of 1");

  const [evaluation] = listEvaluations(app.store);
  expect(/** @type {any} */ (evaluation).report.overall.revision).toMatchObject({
    revised: 1,
    pairs: { treatmentOnly: 1 },
    unchanged: { treatment: 0, control: 1 },
  });
  const rows = /** @type {any[]} */ (
    app.store.db.prepare("SELECT id FROM candidates WHERE operator IS NOT NULL").all()
  ).map(({ id }) => /** @type {any} */ (getCandidate(app.store, id)));
  for (const row of rows) expect(row.locks).toEqual([]);
  const unchanged = rows.find((c) => c.operator === "revise-control");
  const first = getCandidate(app.store, unchanged.parentIds[0]);
  expect(unchanged.operatorParams).toMatchObject({ unchanged: true });
  expect(unchanged.seed).toBe(first?.seed);
  expect(requestGroupName(/** @type {number} */ (ids[0]), STREAM_SEED)).toBe(
    /** @type {any} */ (evaluation).report.vibes[0].requestGroup,
  );
});

test("a cancel during a revision's render stores the report, leaving the unfinished pair out", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx } = made;
  omlx.script(answer(FITS), answer(MISSES), answer(FIXED), answer(STILL));
  const { result } = runRevisionMode(made, 1, 3, (step, controller) => {
    if (step.startsWith("Rendering the revision"))
      controller.abort(new Error("job 1 was cancelled"));
  });
  await expect(result).rejects.toThrow(/cancelled/);
  expect(omlx.requests).toHaveLength(4);
  const [evaluation] = listEvaluations(app.store);
  const { report } = /** @type {any} */ (evaluation);
  expect(report.stopped).toMatch(/cancelled/);
  expect(report.overall).toMatchObject({ made: 2 });
  expect(report.overall.revision).toMatchObject({ measured: 1, revised: 0 });
});

test("a vibe whose ranges change while an earlier vibe runs is scored and reported against the new ones", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx } = made;
  // MISSES measures 0.8: outside the first ranges, inside the edited ones.
  omlx.script(answer(MISSES), answer(FIXED), answer(STILL), answer(MISSES));
  const edited = { lowEndShare: [null, 0.9] };
  const { ids, result } = runRevisionMode(made, 2, 1, (step, _controller, vibeIds) => {
    if (step !== "Asking the model for candidate 1 of 2") return;
    const vibeId = /** @type {number} */ (vibeIds[1]);
    reviseVibe(app.store, vibeId, { ...RANGED, softTargets: { features: edited } });
  });
  await result;
  expect(omlx.requests).toHaveLength(4);
  const [, second] = /** @type {any} */ (listEvaluations(app.store)[0]).report.vibes;
  expect(second.revisionId).toBe(getVibe(app.store, /** @type {number} */ (ids[1]))?.revision.id);
  expect(second.ranges).toEqual(edited);
  expect(second.revision).toMatchObject({ measured: 1, firstTries: { count: 1 }, revised: 0 });
});

test("a failed render check sends a first try back, and keeps a revision that fails one outside", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx } = made;
  // Pair 0: the treatment asks first; it clips again, and the control's answer fits.
  omlx.script(answer(CLIPS), answer(CLIPS_AGAIN), answer(FIXED));
  const { result } = runRevisionMode(made, 1, 1);
  await result;
  expect(omlx.requests).toHaveLength(3);
  const treatmentAsk = omlx.requests[1]?.body.messages[3].content;
  expect(treatmentAsk).toContain(`- $ (clipping): ${CLIPPING.message}`);
  expect(omlx.requests[2]?.body.messages[3].content).not.toContain("clipping");
  const { report } = /** @type {any} */ (listEvaluations(app.store)[0]);
  expect(report.overall.revision).toMatchObject({
    measured: 1,
    firstTries: { count: 0, of: 1 },
    revised: 1,
    pairs: { treatmentOnly: 0, controlOnly: 1 },
  });
});

test("a fault in a render stops the run with the report stored, and the job fails with it", async () => {
  const made = await testApp();
  apps.push(made);
  const { app, omlx } = made;
  omlx.script(answer(FITS), answer(FITS));
  const { result } = runRevisionMode(made, 1, 2, (step) => {
    if (step === "Rendering the excerpt for candidate 2 of 2")
      throw new Error("the renderer broke");
  });
  await expect(result).rejects.toThrow("the renderer broke");
  const { report } = /** @type {any} */ (listEvaluations(app.store)[0]);
  expect(report.stopped).toBe("the renderer broke");
  expect(report.overall).toMatchObject({ made: 2 });
  expect(report.overall.revision).toMatchObject({ measured: 1 });
});

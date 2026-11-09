// The evaluation job through its routes (decision 0030), against the fake omlx on a fake clock:
// the report's rates before and after repair, truncation apart, the randomGenome baseline, and
// that only the route starts an evaluation. No test reaches the real omlx.
/** @import { Scripted } from "../support/fake-omlx.js" */
/** @import { Studio } from "../support/studio.js" */
import { afterEach, describe, expect, test } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { listRequestGroup } from "../../src/server/generation-store.js";
import { randomGenomeScript } from "../support/random-genome-baseline.js";
import { SEED_GENOMES } from "../support/seed-genomes.js";
import { removeStudio, startStudio } from "../support/studio.js";
import { TEST_OMLX_KEY } from "../support/temp-root.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

/** @param {Parameters<typeof startStudio>[0]} [options] */
async function setup(options) {
  const studio = await startStudio(options);
  studios.push(studio);
  /** Loads every seed vibe and returns their ids, in the seeds' order. */
  const loadSeeds = async () => {
    /** @type {number[]} */
    const ids = [];
    for (const id of Object.keys(SEED_VIBES)) {
      ids.push((await studio.ok("POST", `/api/seed-vibes/${id}`, {})).id);
    }
    return ids;
  };
  /**
   * Starts an evaluation through its route, runs it to its end and returns the job's status.
   * @param {number[]} vibeIds
   * @param {number} count
   */
  const evaluate = async (vibeIds, count) => {
    const job = await studio.ok("POST", "/api/evaluations", { vibeIds, count });
    expect(job).toMatchObject({ kind: "evaluation" });
    await studio.drive(studio.server.jobs.settled(job.id));
    return studio.ok("GET", `/api/jobs/${job.id}`);
  };
  return { ...studio, loadSeeds, evaluate };
}

/** @param {unknown} genome */
const answer = (genome) => ({ tokens: [JSON.stringify({ intent: "as the vibe asks", genome })] });
/** @type {Scripted} */
const truncated = {
  tokens: ['{"intent": "a field', ' of bells", "genome": {"dur'],
  finishReason: "length",
};

/**
 * One vibe's script: `valid` answers its linter takes, `repairable` ones it rejects for their
 * loudness followed by a valid repair, and `cut` truncated ones, interleaved.
 * @param {string} seedId
 * @param {{ valid: number, repairable: number, cut: number }} mix
 * @returns {Scripted[]}
 */
function vibeScript(seedId, { valid, repairable, cut }) {
  const genome = SEED_GENOMES[seedId];
  const kinds = [
    ...Array(repairable).fill("repairable"),
    ...Array(cut).fill("cut"),
    ...Array(valid).fill("valid"),
  ];
  // Spread the odd ones through the run rather than leaving them at its start.
  const order = kinds.map((_, i) => kinds[(i * 5) % kinds.length]);
  return order.flatMap((kind) => {
    if (kind === "cut") return [truncated];
    if (kind === "valid") return [answer(genome)];
    return [answer({ ...genome, loudness: -20 }), answer(genome)];
  });
}

/** @param {any} rate */
const counted = (rate) => rate && { count: rate.count, of: rate.of };

describe("the evaluation job", () => {
  test("40 valid, 5 repairable and 3 truncated read 40/48 before repair, 45/48 after, 3 truncated", async () => {
    const { omlx, server, ok, loadSeeds, evaluate } = await setup();
    // The first three seeds, whose counts give the interval below.
    const vibeIds = (await loadSeeds()).slice(0, 3);
    const [cold, bells, tidal] = Object.keys(SEED_VIBES);
    omlx.script(
      ...vibeScript(/** @type {string} */ (cold), { valid: 14, repairable: 1, cut: 1 }),
      ...vibeScript(/** @type {string} */ (bells), { valid: 13, repairable: 2, cut: 1 }),
      ...vibeScript(/** @type {string} */ (tidal), { valid: 13, repairable: 2, cut: 1 }),
    );

    const job = await evaluate(vibeIds, 16);
    expect(job).toMatchObject({
      state: "done",
      error: null,
      progress: { done: 48, total: 48, step: null },
    });
    expect(omlx.requests).toHaveLength(53);
    expect(omlx.maxInFlight()).toBe(1);

    const evaluation = await ok("GET", `/api/evaluations/${job.result.evaluationId}`);
    expect((await ok("GET", "/api/evaluations")).evaluations).toEqual([evaluation]);
    const { params, report } = evaluation;
    expect(params).toMatchObject({
      vibeIds,
      count: 16,
      revise: false,
      sendResponseFormat: false,
      thinking: example.queue.thinking,
    });
    expect(report.overall).toMatchObject({
      requested: 48,
      made: 48,
      answered: 48,
      truncated: 3,
      requestFailed: 0,
    });
    expect(counted(report.overall.valid.beforeRepair)).toEqual({ count: 40, of: 48 });
    expect(counted(report.overall.valid.afterRepair)).toEqual({ count: 45, of: 48 });
    expect(report.overall.valid.afterRepair.low).toBeCloseTo(0.8316, 4);
    expect(report.overall.valid.afterRepair.high).toBeCloseTo(0.9785, 4);
    // The repairable answers fail only the linter, so they pass the schema on the first try.
    expect(counted(report.overall.schemaValid.beforeRepair)).toEqual({ count: 45, of: 48 });
    expect(counted(report.overall.schemaValid.afterRepair)).toEqual({ count: 45, of: 48 });
    expect(report.overall.rejects.firstTry).toMatchObject({ lintErrors: 5, schemaErrors: 0 });
    expect(report.overall.rejects.afterRepair).toMatchObject({ lintErrors: 0 });
    expect(report.overall.rejects.firstTry).not.toHaveProperty("truncated");

    expect(report.vibes.map((/** @type {any} */ v) => [v.vibeId, v.name])).toEqual(
      vibeIds.map((id, i) => [id, Object.values(SEED_VIBES)[i]?.name]),
    );
    expect(
      report.vibes.map((/** @type {any} */ v) => [
        counted(v.valid.beforeRepair),
        counted(v.valid.afterRepair),
        v.truncated,
      ]),
    ).toEqual([
      [{ count: 14, of: 16 }, { count: 15, of: 16 }, 1],
      [{ count: 13, of: 16 }, { count: 15, of: 16 }, 1],
      [{ count: 13, of: 16 }, { count: 15, of: 16 }, 1],
    ]);
    expect(report.latencyMs.firstTry.count).toBe(48);
    expect(report.latencyMs.repair.count).toBe(5);
    expect(report.firstTokenMs.firstTry.count).toBe(48);
    expect(report.responseFormat).toBe("notSent");
    // The fake sends no reasoning text, as a model that honoured thinking off would.
    expect(report.reasoning).toEqual({ answered: 53, withReasoning: 0 });
    expect(report.stopped).toBeNull();
    expect(report.overall.revision).toBeNull();
    expect(report.revisionTiming).toBeNull();

    // Every vibe used the run's one stream seed, outside any session.
    for (const vibe of report.vibes) {
      expect(vibe.requestGroup).toBe(`vibe-${vibe.vibeId}-stream-${params.seed}`);
      const generations = listRequestGroup(server.store, vibe.requestGroup);
      expect(generations.every((g) => g.sessionId === null)).toBe(true);
    }
  });

  test("a randomGenome baseline through the same pipeline passes the schema at 100%", async () => {
    const { omlx, ok, loadSeeds, evaluate } = await setup();
    const vibeIds = await loadSeeds();
    const count = 4;
    const { script, lintPasses } = randomGenomeScript(
      Object.values(SEED_VIBES).map((seed) => seed.constraints),
      count,
    );
    omlx.script(...script);

    const job = await evaluate(vibeIds, count);
    expect(job.state).toBe("done");
    expect(omlx.requests).toHaveLength(script.length);
    const { report } = await ok("GET", `/api/evaluations/${job.result.evaluationId}`);
    const all = vibeIds.length * count;
    expect(counted(report.overall.schemaValid.beforeRepair)).toEqual({ count: all, of: all });
    expect(counted(report.overall.schemaValid.afterRepair)).toEqual({ count: all, of: all });
    expect(counted(report.overall.valid.beforeRepair)).toEqual({ count: lintPasses, of: all });
  });

  test("revise: true starts revision mode, stored in the params and the report", async () => {
    const { omlx, server, ok, drive, loadSeeds } = await setup();
    const [vibeId] = await loadSeeds();
    // A rejected answer is neither rendered nor revised, so the run makes no excerpt.
    omlx.script({ tokens: ["no genome"] });
    const job = await ok("POST", "/api/evaluations", { vibeIds: [vibeId], count: 1, revise: true });
    await drive(server.jobs.settled(job.id));
    const { result } = await ok("GET", `/api/jobs/${job.id}`);
    const { params, report } = await ok("GET", `/api/evaluations/${result.evaluationId}`);
    expect(params.revise).toBe(true);
    expect(report.overall.revision).toMatchObject({ measured: 0, revised: 0 });
    expect(report.vibes[0].ranges).toEqual(
      /** @type {any} */ (SEED_VIBES["cold-dorian"]).softTargets.features,
    );
  });

  test("starts only from its route: the server and the seed vibes start nothing", async () => {
    const { omlx, server, ok, loadSeeds } = await setup();
    await loadSeeds();
    // The page's time estimate reads whether the model thinks.
    expect(await ok("GET", "/api/evaluations")).toEqual({
      evaluations: [],
      job: null,
      thinking: example.queue.thinking,
    });
    expect(server.jobs.list()).toEqual([]);
    expect(omlx.requests).toHaveLength(0);
  });

  test("a refused response_format stops the run, and the stored report says so", async () => {
    const { omlx, ok, loadSeeds, evaluate } = await setup({ sendResponseFormat: true });
    const [vibeId] = await loadSeeds();
    omlx.script({ status: 400, body: '{"error":{"message":"response_format is not supported"}}' });

    const job = await evaluate([/** @type {number} */ (vibeId)], 2);
    expect(job.state).toBe("failed");
    expect(job.error).toMatch(/set queue.sendResponseFormat to false/);
    const [evaluation] = (await ok("GET", "/api/evaluations")).evaluations;
    expect(evaluation.report.responseFormat).toBe("refused");
    expect(evaluation.report.stopped).toBe(job.error);
    expect(evaluation.report.overall).toMatchObject({
      requested: 2,
      made: 1,
      answered: 0,
      requestFailed: 1,
    });
    expect(evaluation.report.overall.valid).toEqual({ beforeRepair: null, afterRepair: null });
  });

  test("a 401 stops the run after one request, and the key is kept out of what is stored", async () => {
    const { omlx, ok, loadSeeds, evaluate } = await setup();
    const vibeIds = await loadSeeds();
    omlx.script({ status: 401, body: '{"error":{"message":"invalid api key"}}' });

    const job = await evaluate(vibeIds, 2);
    expect(job.state).toBe("failed");
    expect(omlx.requests).toHaveLength(1);
    expect(omlx.requests[0]?.authorization).toBe(`Bearer ${TEST_OMLX_KEY}`);
    const [evaluation] = (await ok("GET", "/api/evaluations")).evaluations;
    expect(evaluation.report.stopped).toBe(job.error);
    expect(evaluation.report.overall).toMatchObject({ requested: 8, made: 1, requestFailed: 1 });
    for (const stored of [evaluation, job]) {
      expect(JSON.stringify(stored)).not.toContain(TEST_OMLX_KEY);
    }
  });

  test("a response_format omlx answers is reported accepted", async () => {
    const { omlx, ok, loadSeeds, evaluate } = await setup({ sendResponseFormat: true });
    const [vibeId] = await loadSeeds();
    omlx.script(answer(SEED_GENOMES["cold-dorian"]));
    const job = await evaluate([/** @type {number} */ (vibeId)], 1);
    expect(omlx.requests[0]?.body.response_format).toMatchObject({ type: "json_schema" });
    const { report } = await ok("GET", `/api/evaluations/${job.result.evaluationId}`);
    expect(report.responseFormat).toBe("accepted");
  });

  test("a second evaluation waits for the first; cancelling stores what was made", async () => {
    const { omlx, server, ok, drive, loadSeeds } = await setup();
    const vibeIds = await loadSeeds();
    omlx.script(answer(SEED_GENOMES["cold-dorian"]), { ...answer(null), holdAfter: 0 });
    const job = await ok("POST", "/api/evaluations", { vibeIds, count: 2 });
    const settled = drive(server.jobs.settled(job.id));
    await omlx.waitForRequests(2);

    const second = await server.api("POST", "/api/evaluations", { vibeIds, count: 2 });
    expect(second.status).toBe(409);
    expect(second.json()).toEqual({
      error: `An evaluation is already queued or running (job ${job.id}). Wait for it to finish, or cancel it.`,
      jobId: job.id,
    });
    expect((await ok("GET", "/api/evaluations")).job).toMatchObject({ id: job.id });

    await ok("POST", `/api/jobs/${job.id}/cancel`, {});
    await settled;
    await omlx.waitForAborted(1);
    expect((await ok("GET", `/api/jobs/${job.id}`)).state).toBe("cancelled");
    const [evaluation] = (await ok("GET", "/api/evaluations")).evaluations;
    expect(evaluation.report.stopped).toMatch(/cancelled/);
    expect(evaluation.report.overall).toMatchObject({
      requested: 8,
      made: 2,
      answered: 1,
      requestFailed: 1,
    });
    expect(counted(evaluation.report.overall.valid.beforeRepair)).toEqual({ count: 1, of: 1 });
    // The vibes the run never reached are listed with nothing made.
    expect(evaluation.report.vibes.map((/** @type {any} */ v) => v.made)).toEqual([2, 0, 0, 0]);
  });

  test("two evaluations posted at once make one job and one 409", async () => {
    const { omlx, server, loadSeeds } = await setup();
    const vibeIds = await loadSeeds();
    omlx.script({ tokens: ["{"], holdAfter: 0 });
    const replies = await Promise.all(
      [1, 2].map(() => server.api("POST", "/api/evaluations", { vibeIds, count: 1 })),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    const [job] = server.jobs.list();
    expect(server.jobs.list()).toHaveLength(1);
    expect(replies.find((r) => r.status === 409)?.json().jobId).toBe(job?.id);
    server.jobs.cancel(/** @type {any} */ (job).id);
    await server.jobs.idle();
  });

  test("bad bodies are refused before anything runs", async () => {
    const { omlx, server, loadSeeds } = await setup();
    const [vibeId] = await loadSeeds();
    /** @type {[unknown, RegExp][]} */
    const refused = [
      [{ vibeIds: [], count: 4 }, /at least one/],
      [{ vibeIds: [vibeId, vibeId], count: 4 }, /twice/],
      [{ vibeIds: [999], count: 4 }, /no vibe 999/],
      [{ vibeIds: ["1"], count: 4 }, /vibeIds\[0\]/],
      [{ vibeIds: [vibeId], count: 0 }, /count must be an integer from 1 to 64/],
      [{ vibeIds: [vibeId], count: 65 }, /count/],
      [{ vibeIds: [vibeId] }, /count/],
      [{ vibeIds: [vibeId], count: 4, seed: 1 }, /unknown fields seed/],
      [{ vibeIds: [vibeId], count: 4, revise: "yes" }, /revise must be true or false/],
    ];
    for (const [body, message] of refused) {
      const reply = await server.api("POST", "/api/evaluations", body);
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(reply.json().error).toMatch(message);
    }
    expect((await server.api("GET", "/api/evaluations/1")).status).toBe(404);
    expect(server.jobs.list()).toEqual([]);
    expect(omlx.requests).toHaveLength(0);
  });
});

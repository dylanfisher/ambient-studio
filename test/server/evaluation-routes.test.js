// The evaluation job through its routes (decision 0030), against the fake omlx on a fake clock:
// the report's rates before and after repair, truncation apart, the randomGenome baseline, and
// that only the route starts an evaluation. No test reaches the real omlx.
/** @import { Scripted } from "../support/fake-omlx.js" */
/** @import { Studio } from "../support/studio.js" */
import { afterEach, describe, expect, test } from "vitest";
import { SEED_VIBES } from "../../src/domain/seed-vibes.js";
import { listRequestGroup } from "../../src/server/generation-store.js";
import { randomGenomeScript } from "../support/random-genome-baseline.js";
import { SEED_GENOMES } from "../support/seed-genomes.js";
import { removeStudio, startStudio } from "../support/studio.js";

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
    const vibeIds = await loadSeeds();
    const [cold, bells, tidal] = Object.keys(SEED_VIBES);
    omlx.script(
      ...vibeScript(/** @type {string} */ (cold), { valid: 14, repairable: 1, cut: 1 }),
      ...vibeScript(/** @type {string} */ (bells), { valid: 13, repairable: 2, cut: 1 }),
      ...vibeScript(/** @type {string} */ (tidal), { valid: 13, repairable: 2, cut: 1 }),
    );

    const job = await evaluate(vibeIds, 16);
    expect(job).toMatchObject({ state: "done", error: null, progress: { done: 48, total: 48 } });
    expect(omlx.requests).toHaveLength(53);
    expect(omlx.maxInFlight()).toBe(1);

    const evaluation = await ok("GET", `/api/evaluations/${job.result.evaluationId}`);
    expect((await ok("GET", "/api/evaluations")).evaluations).toEqual([evaluation]);
    const { params, report } = evaluation;
    expect(params).toMatchObject({ vibeIds, count: 16, sendResponseFormat: false });
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
    expect(report.stopped).toBeNull();

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

  test("starts only from its route: the server and the seed vibes start nothing", async () => {
    const { omlx, server, ok, loadSeeds } = await setup();
    await loadSeeds();
    expect(await ok("GET", "/api/evaluations")).toEqual({ evaluations: [], job: null });
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
    expect((await ok("GET", "/api/evaluations")).job).toMatchObject({ id: job.id });

    await ok("POST", `/api/jobs/${job.id}/cancel`, {});
    await settled;
    await omlx.waitForAborted(1);
    expect((await ok("GET", `/api/jobs/${job.id}`)).state).toBe("cancelled");
    const [evaluation] = (await ok("GET", "/api/evaluations")).evaluations;
    expect(evaluation.report.stopped).toMatch(/cancelled/);
    expect(evaluation.report.overall).toMatchObject({ made: 2, answered: 1, requestFailed: 1 });
    expect(counted(evaluation.report.overall.valid.beforeRepair)).toEqual({ count: 1, of: 1 });
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

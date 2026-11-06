// Generation against the fake omlx (decision 0024): one prompt per request group, sampling per
// candidate, one repair round, and every generation and candidate stored with its reason. No
// test reaches the real omlx, and the fake clock stands in for the queue's timers.
/** @import { LintResult } from "../../src/domain/lint-result.js" */
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "../../src/config/config.js";
import { buildPrompt } from "../../src/domain/build-prompt.js";
import { estimateTokens, promptText } from "../../src/domain/prompt-tokens.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import { canonicalGenome } from "../../src/engine/canonical-genome.js";
import exampleGenome from "../../src/engine/genomes/example.json" with { type: "json" };
import {
  getCandidate,
  getGeneration,
  listGenomes,
  listRequestGroup,
} from "../../src/server/generation-store.js";
import { createOmlxQueue } from "../../src/server/omlx-queue.js";
import { RETRIEVAL_METHOD } from "../../src/server/retrieve-examples.js";
import { addNote, createVibe } from "../../src/server/vibe-store.js";
import { fakeClock } from "../support/fake-clock.js";
import { fakeOmlx } from "../support/fake-omlx.js";
import { tempRoot } from "../support/temp-root.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const MODEL = "fake-model-id";
const constraints = { loudness: -16 };
const revisionDraft = {
  name: "cold drone",
  brief: "slow and cold, in D dorian",
  constraints,
  softTargets: {},
};
const locks = [{ path: "reverbDecay", value: 8 }];

/** @param {unknown} genome @param {string} [intent] */
const answer = (genome, intent = "a slow dorian drone") => JSON.stringify({ intent, genome });
/** A token stream of one piece, which the fake omlx sends as one event. */
const says = (/** @type {string} */ text) => ({ tokens: [text] });

/** The example genome, valid under `constraints`, and variants of it. */
const valid = exampleGenome;
const quieterDelay = { ...exampleGenome, delayLevel: -30 };
const tooQuiet = { ...quieterDelay, loudness: -20 };

/** @param {Record<string, number>} [queueEdits] */
async function setup(queueEdits = {}) {
  const clock = fakeClock();
  const omlx = await fakeOmlx(clock);
  cleanups.push(omlx.close);
  const root = await tempRoot((raw) => {
    raw.omlx = { baseUrl: omlx.baseUrl, model: MODEL };
    Object.assign(raw.queue, queueEdits);
  });
  cleanups.push(root.remove);
  const config = loadConfig(root.configPath);
  const queue = createOmlxQueue({
    omlx: config.omlx,
    queue: config.queue,
    clock,
    jitter: () => 0.5,
    onRetry: (event) => {
      throw new Error(`the fake omlx was never busy, but the queue retried: ${event.reason}`);
    },
  });
  cleanups.push(async () => queue.cancel());
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = createVibe(store, revisionDraft);
  const gap = config.queue.minGapMs;

  /**
   * Runs `work` to its end, moving the fake clock past each gap the queue waits between
   * requests.
   * @template T
   * @param {Promise<T>} work
   * @returns {Promise<T>}
   */
  async function drive(work) {
    let done = false;
    const settled = work.finally(() => {
      done = true;
    });
    while (!done) {
      const gapWaiting = await Promise.race([
        settled.then(
          () => false,
          () => false,
        ),
        clock.waitForTimer(gap).then(() => true),
      ]);
      if (gapWaiting) clock.advance(gap);
    }
    return settled;
  }
  return { clock, omlx, config, queue, store, vibe, drive };
}

/** Loads the module only when asked, so a test can check that loading it starts nothing. */
const load = () => import("../../src/server/generate-candidates.js");

describe("generateCandidates", () => {
  test("one valid, one repairable and one truncated answer store 3 generations, 1 repair and 3 candidates", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    omlx.script(
      says(`Here you go:\n\`\`\`json\n${answer(valid)}\n\`\`\``),
      says(answer(tooQuiet, "a drone, quieter")),
      says(answer(quieterDelay, "a drone with a softer delay")),
      { tokens: ['{"intent": "a drone", "genome": {"dura'], finishReason: "length" },
    );
    const { requestGroup, candidates } = await drive(
      generateCandidates(vibe.id, 3, store, queue, { config, seed: 7, sessionId: null, locks }),
    );

    // The repair of the second candidate is sent before the third candidate's request.
    expect(omlx.requests).toHaveLength(4);
    const generations = listRequestGroup(store, requestGroup);
    expect(generations).toHaveLength(4);
    const [first, second, repair, third] = generations;
    expect(generations.map((g) => g.repairRound)).toEqual([0, 0, 1, 0]);
    expect(repair?.repairsId).toBe(second?.id);
    expect(generations.map((g) => g.finishReason)).toEqual(["stop", "stop", "stop", "length"]);
    for (const g of generations) {
      expect(g).toMatchObject({ model: MODEL, retrievalMethod: RETRIEVAL_METHOD, exampleIds: [] });
    }

    expect(candidates.map((c) => c.rejectReason)).toEqual([null, null, REJECT_REASON.truncated]);
    expect(candidates.map((c) => c.generationId)).toEqual([first?.id, repair?.id, third?.id]);
    expect(candidates.map((c) => c.intent)).toEqual([
      "a slow dorian drone",
      "a drone with a softer delay",
      null,
    ]);
    for (const c of candidates) {
      expect(getCandidate(store, c.id)).toEqual(c);
      expect(c).toMatchObject({
        source: "llm",
        parentIds: [],
        locks,
        vibeRevisionId: vibe.revision.id,
      });
    }
    expect(candidates[2]?.lint).toEqual({
      ok: false,
      findings: [
        {
          path: "$",
          rule: REJECT_REASON.truncated,
          message: `the answer hit max_tokens (${config.queue.maxTokens}) and was cut off`,
        },
      ],
    });

    // Genome rows only for the two valid candidates.
    const genomes = listGenomes(store, vibe.id);
    expect(genomes.map((g) => g.id)).toEqual([candidates[0]?.genomeId, candidates[1]?.genomeId]);
    expect(genomes.map((g) => canonicalGenome(g.genome))).toEqual(
      [valid, quieterDelay].map(canonicalGenome),
    );
    expect(candidates[2]?.genomeId).toBe(null);
  });

  test("every first request of a group carries the identical prompt, with sampling varied and logged", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    addNote(store, { vibeId: vibe.id, text: "less shimmer" });
    omlx.script(says(answer(valid)), says(answer(valid)), says(answer(valid)), says(answer(valid)));
    const { requestGroup, candidates } = await drive(
      generateCandidates(vibe.id, 4, store, queue, { config, seed: 11, sessionId: null, locks }),
    );
    const bodies = omlx.requests.map((r) => r.body);
    const generations = listRequestGroup(store, requestGroup);
    const prompt = buildPrompt(
      { ...revisionDraft },
      {
        notes: ["less shimmer"],
        locks,
        examples: [],
        budgetTokens: config.queue.contextBudgetTokens,
      },
    );
    for (const [i, body] of bodies.entries()) {
      expect(body.messages).toEqual(prompt.messages);
      expect(generations[i]?.prompt).toEqual(prompt.messages);
      const sent = { temperature: body.temperature, top_p: body.top_p, seed: body.seed };
      expect(generations[i]?.sampling).toEqual(sent);
    }
    expect(new Set(bodies.map((b) => b.temperature)).size).toBe(4);
    expect(new Set(bodies.map((b) => b.seed)).size).toBe(4);
    expect(new Set(candidates.map((c) => c.seed)).size).toBe(4);
    // Four candidates, all valid and the same genome: one genome row.
    expect(candidates.map((c) => c.rejectReason)).toEqual([null, null, null, null]);
    expect(listGenomes(store, vibe.id)).toHaveLength(1);
  });

  test("the same stream seed gives the same sampling and candidate seeds", async () => {
    const one = await setup();
    const two = await setup();
    const { generateCandidates } = await load();
    /** @param {Awaited<ReturnType<typeof setup>>} run */
    const generate = async (run) => {
      run.omlx.script(says(answer(valid)), says(answer(valid)));
      const options = { config: run.config, seed: 3, sessionId: null, locks: [] };
      const made = await run.drive(
        generateCandidates(run.vibe.id, 2, run.store, run.queue, options),
      );
      const sampling = run.omlx.requests.map(({ body }) => [body.temperature, body.seed]);
      return { sampling, seeds: made.candidates.map((c) => c.seed), group: made.requestGroup };
    };
    expect(await generate(one)).toEqual(await generate(two));
  });

  test("a reply with no JSON, broken JSON, two objects or a bad schema is rejected with its reason", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    const badSchema = answer({ ...valid, voices: "none" });
    omlx.script(
      says("I can't help with that."),
      says('{"intent": "a drone", genome: {}}'),
      says(`${answer(valid)}\n${answer(valid)}`),
      says(badSchema),
      says(badSchema),
    );
    const { requestGroup, candidates } = await drive(
      generateCandidates(vibe.id, 4, store, queue, { config, seed: 5, sessionId: null, locks }),
    );
    expect(candidates.map((c) => c.rejectReason)).toEqual([
      REJECT_REASON.noJson,
      REJECT_REASON.invalidJson,
      REJECT_REASON.severalObjects,
      REJECT_REASON.schemaErrors,
    ]);
    // Only the schema error had errors to quote, so only it got a repair round.
    const generations = listRequestGroup(store, requestGroup);
    expect(generations.map((g) => g.repairRound)).toEqual([0, 0, 0, 0, 1]);
    expect(candidates[3]?.lint).toEqual({
      ok: false,
      findings: [{ path: "$.voices", rule: "schema", message: "must be a list" }],
    });
    const repairAsked = omlx.requests[4]?.body.messages.at(-1).content;
    expect(repairAsked).toContain("- $.voices (schema): must be a list");
    expect(listGenomes(store, vibe.id)).toEqual([]);
  });

  test("a lint error is quoted back in the repair, after the first prompt and the answer", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    omlx.script(says(`Sure! ${answer(tooQuiet)}`), says(answer(tooQuiet)));
    const {
      candidates: [candidate],
    } = await drive(
      generateCandidates(vibe.id, 1, store, queue, { config, seed: 9, sessionId: null, locks }),
    );
    const [firstBody, repairBody] = omlx.requests.map((r) => r.body);
    expect(repairBody?.messages.slice(0, 2)).toEqual(firstBody?.messages);
    expect(repairBody?.messages[2]).toEqual({
      role: "assistant",
      content: answer(tooQuiet),
    });
    expect(repairBody?.messages[3].content).toMatch(/^- \$\.loudness \(loudness\): /m);
    expect(candidate?.rejectReason).toBe(REJECT_REASON.lintErrors);
    expect(candidate?.lint).toMatchObject({ ok: false, findings: [{ rule: "loudness" }] });
    expect(getGeneration(store, candidate?.generationId ?? 0)?.repairRound).toBe(1);
  });

  test("a repair that would pass the context budget is not sent, and the candidate says so", async () => {
    // A budget the first prompt fits and the repair, which adds the answer, doesn't.
    const probe = buildPrompt(revisionDraft, { notes: [], locks, examples: [], budgetTokens: 1e9 });
    const budget = estimateTokens(promptText(probe.messages)) + 50;
    const { omlx, config, queue, store, vibe, drive } = await setup({
      contextBudgetTokens: budget,
    });
    const { generateCandidates } = await load();
    omlx.script(says(answer(tooQuiet)));
    const {
      candidates: [candidate],
    } = await drive(
      generateCandidates(vibe.id, 1, store, queue, { config, seed: 9, sessionId: null, locks }),
    );
    expect(omlx.requests).toHaveLength(1);
    if (!candidate) throw new Error("no candidate");
    expect(candidate.rejectReason).toBe(REJECT_REASON.lintErrors);
    const { findings } = /** @type {LintResult} */ (candidate.lint);
    expect(findings.at(-1)).toMatchObject({ rule: "repairOverBudget" });
    expect(findings.at(-1)?.message).toMatch(
      new RegExp(`^the repair prompt is about \\d+ tokens, over the ${budget}-token budget`),
    );
  });

  test("a stream seed already used for a request group is refused before anything is sent", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    omlx.script(says(answer(valid)));
    const options = { config, seed: 2, sessionId: null, locks };
    await drive(generateCandidates(vibe.id, 1, store, queue, options));
    await expect(generateCandidates(vibe.id, 1, store, queue, options)).rejects.toThrow(
      /request group .* already exists/,
    );
    expect(omlx.requests).toHaveLength(1);
  });

  test("loading the module sends nothing and sets no timer; only a call generates", async () => {
    const { clock, omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    await clock.waitFor((pending) => pending.length === 0);
    expect(omlx.requests).toHaveLength(0);
    omlx.script(says(answer(valid)));
    await drive(
      generateCandidates(vibe.id, 1, store, queue, { config, seed: 1, sessionId: null, locks }),
    );
    expect(omlx.requests).toHaveLength(1);
  });
});

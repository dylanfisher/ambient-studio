// Generation against the fake omlx (decision 0024): one prompt per request group, sampling per
// candidate, one repair round, and every generation and candidate stored with its reason. No
// test reaches the real omlx, and the fake clock stands in for the queue's timers.
/** @import { LintResult } from "../../src/domain/lint-result.js" */
/** @import { FeatureRanges } from "../../src/domain/target-schema.js" */
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "../../src/config/config.js";
import { buildPrompt } from "../../src/domain/build-prompt.js";
import { estimateTokens, promptText } from "../../src/domain/prompt-tokens.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import { targetsText } from "../../src/domain/targets-text.js";
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
import { addNote, createVibe, reviseVibe } from "../../src/server/vibe-store.js";
import { driveGaps, fakeClock } from "../support/fake-clock.js";
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
    raw.omlx.baseUrl = omlx.baseUrl;
    raw.omlx.model = MODEL;
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
   * @template T
   * @param {Promise<T>} work
   */
  const drive = (work) => driveGaps(clock, gap, work);
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
      generateCandidates(vibe.id, 3, store, queue, {
        config,
        seed: 7,
        sessionId: null,
        locks,
        recordings: [],
      }),
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

  test("an answer that changes two locked values is stored with both restored and listed", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    const owned = [
      { path: "reverbDecay", value: 8 },
      { path: "voices.pad.hold", value: 30, voiceType: "pad" },
      { path: "delayTime", value: 0.75 },
    ];
    const { delayTime, ...changed } = structuredClone(valid);
    changed.reverbDecay = 14;
    const pad = changed.voices.find((v) => v.id === "pad");
    if (pad) pad.hold = 60;
    omlx.script(says(answer(changed)));
    const { candidates } = await drive(
      generateCandidates(vibe.id, 1, store, queue, {
        config,
        seed: 21,
        sessionId: null,
        locks: owned,
        recordings: [],
      }),
    );
    const [candidate] = candidates;
    expect(candidate).toMatchObject({
      rejectReason: null,
      locks: owned,
      operator: null,
      operatorParams: {
        locksChanged: ["reverbDecay", "voices.pad.hold"],
        locksFilled: ["delayTime"],
      },
    });
    const [stored] = listGenomes(store, vibe.id);
    expect(canonicalGenome(stored?.genome)).toBe(canonicalGenome(valid));
    expect(stored?.id).toBe(candidate?.genomeId);
  });

  test("a lock on a voice the answer dropped goes to the repair round", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    const owned = [{ path: "voices.pad.hold", value: 30, voiceType: "pad" }];
    const noPad = { ...valid, voices: valid.voices.filter((v) => v.id !== "pad") };
    omlx.script(says(answer(noPad)), says(answer(valid)));
    /** @type {(string | null)[]} */
    const firstReasons = [];
    const { candidates } = await drive(
      generateCandidates(vibe.id, 1, store, queue, {
        config,
        seed: 22,
        sessionId: null,
        locks: owned,
        recordings: [],
        onCandidate: (_, firstReason) => {
          firstReasons.push(firstReason);
        },
      }),
    );
    expect(firstReasons).toEqual([REJECT_REASON.lintErrors]);
    expect(omlx.requests).toHaveLength(2);
    const repairAsk = omlx.requests[1]?.body.messages.at(-1).content;
    expect(repairAsk).toMatch(/- \$\.voices \(lock\): .*voices\.pad\.hold/);
    expect(candidates[0]).toMatchObject({
      rejectReason: null,
      operatorParams: { locksChanged: [], locksFilled: [] },
    });
  });

  test("with no locks a candidate stores no lock changes", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    omlx.script(says(answer(valid)));
    const { candidates } = await drive(
      generateCandidates(vibe.id, 1, store, queue, {
        config,
        seed: 23,
        sessionId: null,
        locks: [],
        recordings: [],
      }),
    );
    expect(candidates[0]).toMatchObject({ rejectReason: null, locks: [], operatorParams: null });
  });

  test("the first prompt holds the vibe's feature ranges", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    /** @type {FeatureRanges} */
    const ranges = { centroidMean: [null, 700], stereoWidth: [0.1, 0.4] };
    reviseVibe(store, vibe.id, { ...revisionDraft, softTargets: { features: ranges } });
    omlx.script(says(answer(valid)));
    await drive(
      generateCandidates(vibe.id, 1, store, queue, {
        config,
        seed: 29,
        sessionId: null,
        locks: [],
        recordings: [],
      }),
    );
    const sent = promptText(omlx.requests[0]?.body.messages);
    for (const line of targetsText(ranges).split("\n")) expect(sent).toContain(line);
  });

  test("a revision whose saved ranges no longer validate stops generation, naming it", async () => {
    const { config, queue, store, vibe } = await setup();
    const { generateCandidates } = await load();
    const revision = reviseVibe(store, vibe.id, {
      ...revisionDraft,
      softTargets: { features: { flatness: [0.5, 0.1] } },
    });
    await expect(
      generateCandidates(vibe.id, 1, store, queue, {
        config,
        seed: 31,
        sessionId: null,
        locks: [],
        recordings: [],
      }),
    ).rejects.toThrow(`revision ${revision.id} has invalid soft targets: $.features.flatness`);
  });

  test("onCandidate gets each stored candidate with its first answer's reason", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    omlx.script(says(answer(valid)), says(answer(tooQuiet)), says(answer(quieterDelay)), {
      tokens: ["{"],
      finishReason: "length",
    });
    /** @type {[number, string | null, string | null][]} */
    const seen = [];
    const { candidates } = await drive(
      generateCandidates(vibe.id, 3, store, queue, {
        config,
        seed: 8,
        sessionId: null,
        locks: [],
        recordings: [],
        onCandidate: (candidate, firstReason) => {
          seen.push([candidate.id, firstReason, candidate.rejectReason]);
        },
      }),
    );
    expect(seen).toEqual([
      [candidates[0]?.id, null, null],
      [candidates[1]?.id, REJECT_REASON.lintErrors, null],
      [candidates[2]?.id, REJECT_REASON.truncated, REJECT_REASON.truncated],
    ]);
  });

  test("every first request of a group carries the identical prompt, with sampling varied and logged", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    addNote(store, { vibeId: vibe.id, text: "less shimmer" });
    omlx.script(says(answer(valid)), says(answer(valid)), says(answer(valid)), says(answer(valid)));
    const { requestGroup, candidates } = await drive(
      generateCandidates(vibe.id, 4, store, queue, {
        config,
        seed: 11,
        sessionId: null,
        locks,
        recordings: [],
      }),
    );
    const bodies = omlx.requests.map((r) => r.body);
    const generations = listRequestGroup(store, requestGroup);
    const prompt = buildPrompt(
      { ...revisionDraft, ranges: {} },
      {
        notes: ["less shimmer"],
        locks,
        examples: [],
        budgetTokens: config.queue.contextBudgetTokens,
        recordings: [],
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
      const options = { config: run.config, seed: 3, sessionId: null, locks: [], recordings: [] };
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
      generateCandidates(vibe.id, 4, store, queue, {
        config,
        seed: 5,
        sessionId: null,
        locks,
        recordings: [],
      }),
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
      generateCandidates(vibe.id, 1, store, queue, {
        config,
        seed: 9,
        sessionId: null,
        locks,
        recordings: [],
      }),
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

  test("lists the recordings in the prompt, and repairs a genome naming one not in the index", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    const listed = "1".repeat(64);
    const recordings = [
      { file: "rain.wav", hash: listed, duration: 30, channels: 2, sampleRate: 48000 },
    ];
    /** @param {string} hash */
    const withRecording = (hash) => ({
      ...valid,
      voices: [...valid.voices, { id: "field", type: "recording", recording: hash, level: -20 }],
    });
    omlx.script(says(answer(withRecording("2".repeat(64)))), says(answer(withRecording(listed))));
    const {
      candidates: [candidate],
    } = await drive(
      generateCandidates(vibe.id, 1, store, queue, {
        config,
        seed: 9,
        sessionId: null,
        locks,
        recordings,
      }),
    );
    const [firstBody, repairBody] = omlx.requests.map((r) => r.body);
    expect(firstBody?.messages[0].content).toContain(`${listed} 30 2 "rain.wav"`);
    const index = valid.voices.length;
    expect(repairBody?.messages[3].content).toContain(
      `- $.voices[${index}].recording (schema): no recording in the folder has this sha256`,
    );
    expect(candidate?.rejectReason).toBe(null);
    expect(listGenomes(store, vibe.id)).toHaveLength(1);
  });

  test("a repair that would pass the context budget is not sent, and the candidate says so", async () => {
    // A budget the first prompt fits and the repair, which adds the answer, doesn't.
    const probe = buildPrompt(
      { ...revisionDraft, ranges: {} },
      {
        notes: [],
        locks,
        examples: [],
        budgetTokens: 1e9,
        recordings: [],
      },
    );
    const budget = estimateTokens(promptText(probe.messages)) + 50;
    const { omlx, config, queue, store, vibe, drive } = await setup({
      contextBudgetTokens: budget,
    });
    const { generateCandidates } = await load();
    omlx.script(says(answer(tooQuiet)));
    const {
      candidates: [candidate],
    } = await drive(
      generateCandidates(vibe.id, 1, store, queue, {
        config,
        seed: 9,
        sessionId: null,
        locks,
        recordings: [],
      }),
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
    const options = { config, seed: 2, sessionId: null, locks, recordings: [] };
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
      generateCandidates(vibe.id, 1, store, queue, {
        config,
        seed: 1,
        sessionId: null,
        locks,
        recordings: [],
      }),
    );
    expect(omlx.requests).toHaveLength(1);
  });
});

describe("generateCandidates keeps what phase 8 trains on", () => {
  test("a generation stores the reasoning and the request as sent; a rejected candidate its genome", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    omlx.script(
      { reasoning: ["cold, ", "slow"], tokens: [answer(valid)] },
      says(answer(tooQuiet)),
      says(answer(tooQuiet)),
    );
    const { requestGroup, candidates } = await drive(
      generateCandidates(vibe.id, 2, store, queue, {
        config,
        seed: 4,
        sessionId: null,
        locks,
        recordings: [],
      }),
    );
    const generations = listRequestGroup(store, requestGroup);
    for (const [i, generation] of generations.entries()) {
      expect(generation.requestParams).toEqual(sentParams(omlx.requests[i]));
      expect(generation).toMatchObject({ retries: [], error: null });
    }
    expect(generations[0]?.requestParams).toMatchObject({
      chat_template_kwargs: { enable_thinking: config.queue.thinking },
    });
    expect(generations.map((g) => g.reasoning)).toEqual(["cold, slow", null, null]);
    expect(candidates.map((c) => c.rejectedGenome)).toEqual([null, tooQuiet]);
  });

  test("a request that fails in the queue is stored with its error and a requestFailed candidate", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    omlx.script(says(answer(valid)), { status: 500, body: "boom" });
    const options = { config, seed: 6, sessionId: null, locks, recordings: [] };
    await expect(drive(generateCandidates(vibe.id, 3, store, queue, options))).rejects.toThrow(
      "omlx answered HTTP 500: boom",
    );
    // The batch stops at the failure: two requests, two generations, two candidates.
    expect(omlx.requests).toHaveLength(2);
    const generations = listRequestGroup(store, groupOf(vibe.id, 6));
    expect(generations).toHaveLength(2);
    expect(generations[1]).toMatchObject({
      response: "",
      finishReason: "error",
      error: "omlx answered HTTP 500: boom",
      reasoning: null,
      requestParams: sentParams(omlx.requests[1]),
    });
    const failed = candidatesOf(store, generations[1]?.id);
    expect(failed).toMatchObject({ rejectReason: REJECT_REASON.requestFailed, genomeId: null });
    expect(failed?.lint).toEqual({
      ok: false,
      findings: [
        { path: "$", rule: REJECT_REASON.requestFailed, message: "omlx answered HTTP 500: boom" },
      ],
    });
  });

  test("a cancel before the repair is sent still writes the first try's candidate", async () => {
    const { clock, omlx, config, queue, store, vibe } = await setup();
    const { generateCandidates } = await load();
    omlx.script(says(answer(tooQuiet)));
    const options = { config, seed: 8, sessionId: null, locks, recordings: [] };
    const work = generateCandidates(vibe.id, 2, store, queue, options);
    const settled = work.then(
      () => undefined,
      (/** @type {Error} */ error) => error,
    );
    // The repair waits out the gap after the first answer; cancel it there.
    await clock.waitForTimer(config.queue.minGapMs);
    queue.cancel();
    expect((await settled)?.message).toBe("omlx request cancelled");
    expect(omlx.requests).toHaveLength(1);
    const generations = listRequestGroup(store, groupOf(vibe.id, 8));
    expect(generations).toHaveLength(1);
    const candidate = candidatesOf(store, generations[0]?.id);
    expect(candidate?.rejectReason).toBe(REJECT_REASON.lintErrors);
    expect(candidate?.rejectedGenome).toEqual(tooQuiet);
    const { findings } = /** @type {LintResult} */ (candidate?.lint ?? { findings: [] });
    expect(findings.at(-1)).toEqual({
      path: "$",
      rule: "repairNotSent",
      message: "the repair was not sent: omlx request cancelled",
    });
  });

  test("request groups are per vibe, so one stream seed serves several vibes", async () => {
    const { omlx, config, queue, store, vibe, drive } = await setup();
    const { generateCandidates } = await load();
    const other = createVibe(store, { ...revisionDraft, name: "warm tide" });
    omlx.script(says(answer(valid)), says(answer(valid)));
    const options = { config, seed: 12, sessionId: null, locks, recordings: [] };
    const one = await drive(generateCandidates(vibe.id, 1, store, queue, options));
    const two = await drive(generateCandidates(other.id, 1, store, queue, options));
    expect(one.requestGroup).toBe(groupOf(vibe.id, 12));
    expect(two.requestGroup).toBe(groupOf(other.id, 12));
    expect(one.requestGroup).not.toBe(two.requestGroup);
  });
});

/**
 * The request group the stream seed names for a vibe (decision 0024).
 * @param {number} vibeId
 * @param {number} seed
 */
const groupOf = (vibeId, seed) => `vibe-${vibeId}-stream-${seed}`;

/**
 * The one candidate naming `generationId`.
 * @param {import("../../src/server/store.js").Store} store
 * @param {number | undefined} generationId
 */
function candidatesOf(store, generationId) {
  const row = store.db
    .prepare("SELECT id FROM candidates WHERE generationId = ?")
    .get(generationId ?? -1);
  return getCandidate(store, Number(row?.id));
}

/**
 * The request body the fake received, without its messages: what the queue reports as sent.
 * @param {{ body: Record<string, unknown> } | undefined} received
 */
function sentParams(received) {
  if (!received) throw new Error("the fake received no request");
  const params = { ...received.body };
  delete params.messages;
  return params;
}

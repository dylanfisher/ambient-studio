// The omlx queue (decision 0022) against the fake omlx and the fake clock: one request in flight,
// the gap after each, busy backoff, the timeout, the context budget and cancel. No test reaches
// the real omlx.
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "../../src/config/config.js";
import { CHARS_PER_TOKEN, estimateTokens } from "../../src/domain/prompt-tokens.js";
import exampleGenome from "../../src/engine/genomes/example.json" with { type: "json" };
import { randomGenome } from "../../src/engine/random-genome.js";
import { createOmlxQueue, OmlxRequestError } from "../../src/server/omlx-queue.js";
import { fakeClock } from "../support/fake-clock.js";
import { fakeOmlx } from "../support/fake-omlx.js";
import { TEST_OMLX_KEY, tempRoot } from "../support/temp-root.js";

/** @import { Completion, RetryEvent } from "../../src/server/omlx-queue.js" */

// Distinct numbers, so a test can wait for one timer by its delay.
const QUEUE = {
  requestTimeoutMs: 60_000,
  firstTokenThresholdMs: 10_000,
  minGapMs: 2_000,
  backoffBaseMs: 4_000,
  maxWaitMs: 30_000,
  minPrefillTokensPerSecond: 100,
};
const PROMPT = "a drone in D dorian";
/**
 * The prefill allowance a prompt adds to the first-token threshold and the timeout (0022).
 * @param {string} prompt
 */
const prefillMs = (prompt) =>
  Math.ceil((estimateTokens(prompt) * 1000) / QUEUE.minPrefillTokensPerSecond);
/** The first-token threshold and the timeout for `PROMPT`. */
const THRESHOLD = QUEUE.firstTokenThresholdMs + prefillMs(PROMPT);
const TIMEOUT = QUEUE.requestTimeoutMs + prefillMs(PROMPT);
/** The fixed jitter draw: each backoff is 0.75 of its exponential step (decision 0022). */
const JITTER = 0.5;
/** Backoffs for retries 1–3 at that draw; a fourth (24 s) would pass the 30 s maximum wait. */
const BACKOFFS = [3_000, 6_000, 12_000];
/** The thinking headroom stated in 0022, which `maxTokens` leaves over the largest answer. */
const THINKING_HEADROOM_TOKENS = 4_096;
/** The longest one-line intent 0022 allows for in the `{intent, genome}` answer. */
const INTENT = "i".repeat(200);
/** The seed whose genome was the longest answer of 100 000 seeds when 0022 was written. */
const LONGEST_SEED = 25_071;

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A fake omlx, a fake clock, and a queue reading a config from a temp root that points at the
 * fake.
 * @param {Record<string, number | boolean>} [queueEdits]
 */
async function setup(queueEdits = {}) {
  const clock = fakeClock();
  const omlx = await fakeOmlx(clock);
  cleanups.push(omlx.close);
  const root = await tempRoot((raw) => {
    raw.omlx.baseUrl = omlx.baseUrl;
    raw.omlx.model = "fake-model-id";
    Object.assign(raw.queue, QUEUE, queueEdits);
  });
  cleanups.push(root.remove);
  const config = loadConfig(root.configPath);
  /** @type {RetryEvent[]} */
  const retries = [];
  const queue = createOmlxQueue({
    omlx: config.omlx,
    queue: config.queue,
    clock,
    jitter: () => JITTER,
    onRetry: (event) => retries.push(event),
  });
  cleanups.push(async () => queue.cancel());
  return { clock, omlx, config, queue, retries };
}

/** @param {string} [content] */
const ask = (content = PROMPT) => ({
  messages: [{ role: /** @type {const} */ ("user"), content }],
});

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

/**
 * Settles `promise` into a value the test can inspect without an unhandled rejection.
 * @param {Promise<Completion>} promise
 */
const settle = (promise) =>
  promise.then(
    (value) => ({ value, error: undefined }),
    (/** @type {Error} */ error) => ({ value: undefined, error }),
  );

describe("createOmlxQueue", () => {
  test("20 requests at once never put more than 1 in flight, each at least the gap apart", async () => {
    const { clock, omlx, queue } = await setup();
    const count = 20;
    omlx.script(...Array.from({ length: count }, (_, i) => ({ tokens: [`answer ${i}`] })));
    const results = Array.from({ length: count }, () => queue.request(ask()));
    for (const [index, result] of results.entries()) {
      expect((await result).text).toBe(`answer ${index}`);
      if (index < count - 1) {
        await clock.waitForTimer(QUEUE.minGapMs);
        clock.advance(QUEUE.minGapMs);
      }
    }
    expect(omlx.requests).toHaveLength(count);
    expect(omlx.maxInFlight()).toBe(1);
    const starts = omlx.requests.map((request) => request.at);
    for (let i = 1; i < count; i++) {
      expect(
        /** @type {number} */ (starts[i]) - /** @type {number} */ (starts[i - 1]),
      ).toBeGreaterThanOrEqual(QUEUE.minGapMs);
    }
  });

  test("sends the config's model id, one candidate, the hard max_tokens and a stream", async () => {
    const { omlx, config, queue } = await setup();
    omlx.script({ tokens: ["{}"] });
    await queue.request({ ...ask(), sampling: { temperature: 0.9, seed: 7 } });
    const body = /** @type {Record<string, any>} */ (omlx.requests[0]?.body);
    expect(body.model).toBe("fake-model-id");
    expect(body.model).toBe(config.omlx.model);
    expect(body.n).toBe(1);
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(config.queue.maxTokens);
    expect(body.temperature).toBe(0.9);
    expect(body.seed).toBe(7);
    expect(body.response_format).toBeUndefined();
    expect(omlx.baseUrl).not.toContain(":8000");
  });

  test("returns the text, finish_reason, latency, time to first token and the usage counts", async () => {
    const { omlx, queue } = await setup();
    omlx.script({ tokens: ['{"a":', " 1}"], usage: { prompt_tokens: 12, completion_tokens: 2 } });
    const result = await queue.request(ask());
    expect(result).toEqual({
      text: '{"a": 1}',
      reasoning: "",
      finishReason: "stop",
      latencyMs: 0,
      firstTokenMs: 0,
      promptTokens: 12,
      completionTokens: 2,
      retries: [],
      params: sentParams(omlx.requests[0]),
    });
  });

  test("token counts are null when the stream carries no usage", async () => {
    const { omlx, queue } = await setup();
    omlx.script({ tokens: ["ok"] });
    const result = await queue.request(ask());
    expect([result.promptTokens, result.completionTokens]).toEqual([null, null]);
  });

  test("a response cut at max_tokens returns finish_reason length", async () => {
    const { omlx, queue } = await setup({ maxTokens: 3 });
    omlx.script({ tokens: ["a", "b", "c", "d", "e"] });
    const result = await queue.request(ask());
    expect(result.text).toBe("abc");
    expect(result.finishReason).toBe("length");
  });

  for (const status of [429, 503]) {
    test(`HTTP ${status} backs off on the fake clock, reports the retry, and retries`, async () => {
      const { clock, omlx, queue, retries } = await setup();
      omlx.script({ status, body: "busy" }, { tokens: ["done"] });
      const result = queue.request(ask());
      await clock.waitForTimer(/** @type {number} */ (BACKOFFS[0]));
      expect(omlx.requests).toHaveLength(1);
      clock.advance(/** @type {number} */ (BACKOFFS[0]) - 1);
      expect(omlx.requests).toHaveLength(1);
      clock.advance(1);
      const done = await result;
      expect(done.text).toBe("done");
      const event = { attempt: 1, reason: `HTTP ${status}`, delayMs: BACKOFFS[0] };
      expect(done.retries).toEqual([event]);
      expect(retries).toEqual([event]);
      expect(omlx.requests.map((request) => request.at)).toEqual([0, BACKOFFS[0]]);
    });
  }

  test("a first token slower than the threshold is busy: aborted, backed off and retried", async () => {
    const { clock, omlx, queue, retries } = await setup();
    omlx.script({ tokens: ["late"], holdAfter: 0 }, { tokens: ["prompt"] });
    const result = queue.request(ask());
    await omlx.waitForRequests(1);
    clock.advance(THRESHOLD - 1);
    expect(omlx.aborted()).toBe(0);
    clock.advance(1);
    await omlx.waitForAborted(1);
    await clock.waitForTimer(/** @type {number} */ (BACKOFFS[0]));
    clock.advance(/** @type {number} */ (BACKOFFS[0]));
    const done = await result;
    expect(done.text).toBe("prompt");
    expect(retries).toEqual([
      { attempt: 1, reason: `no first token in ${THRESHOLD / 1000} s`, delayMs: BACKOFFS[0] },
    ]);
  });

  test("the first-token threshold and the timeout grow with the prompt's prefill", async () => {
    const { clock, omlx, queue } = await setup();
    omlx.script({ tokens: ["ok"], holdAfter: 0 });
    // 3 500 characters is 1 000 tokens, 10 s of prefill at 100 tokens a second.
    const result = settle(queue.request(ask("p".repeat(3_500))));
    await omlx.waitForRequests(1);
    await clock.waitForTimer(QUEUE.firstTokenThresholdMs + 10_000);
    await clock.waitForTimer(QUEUE.requestTimeoutMs + 10_000);
    clock.advance(QUEUE.firstTokenThresholdMs + 9_999);
    omlx.release();
    expect((await result).value?.firstTokenMs).toBe(QUEUE.firstTokenThresholdMs + 9_999);
  });

  test("a busy first token past the maximum wait names the prefill key in its message", async () => {
    const { clock, omlx, queue } = await setup({ maxWaitMs: 1_000 });
    omlx.script({ tokens: ["late"], holdAfter: 0 });
    const result = settle(queue.request(ask()));
    await omlx.waitForRequests(1);
    clock.advance(THRESHOLD);
    const { error } = await result;
    expect(error?.message).toContain("queue.minPrefillTokensPerSecond");
  });

  test("past the maximum wait a busy request fails with the owner's message", async () => {
    const { clock, omlx, queue, retries } = await setup();
    omlx.script(...Array.from({ length: 4 }, () => ({ status: 429, body: "busy" })));
    const result = settle(queue.request(ask()));
    for (const delay of BACKOFFS) {
      await clock.waitForTimer(delay);
      clock.advance(delay);
    }
    const { error } = await result;
    expect(error?.message).toBe(
      "omlx stayed busy (HTTP 429) through 21 s of backoff over 4 attempts, and the next wait " +
        "would pass the 30 s maximum. The live site is using it; try again later.",
    );
    expect(retries.map((event) => event.delayMs)).toEqual(BACKOFFS);
    expect(omlx.requests).toHaveLength(4);
    expect(error).toBeInstanceOf(OmlxRequestError);
    expect(error).toMatchObject({ attempts: 4, latencyMs: 0, retries });
  });

  test("a held stream is aborted when the fake clock passes the timeout", async () => {
    const { clock, omlx, queue } = await setup();
    omlx.script({ tokens: ["first", "never"], holdAfter: 1 });
    const result = settle(queue.request(ask()));
    await omlx.waitForRequests(1);
    // The first token clears the first-token timer; only then is the stream past busy.
    await clock.waitFor((pending) => !pending.some((timer) => timer.delay === THRESHOLD));
    clock.advance(TIMEOUT - 1);
    expect(omlx.aborted()).toBe(0);
    clock.advance(1);
    const { error } = await result;
    expect(error?.message).toBe(`omlx request timed out after ${TIMEOUT / 1000} s`);
    await omlx.waitForAborted(1);
    expect(omlx.requests).toHaveLength(1);
    // The failure says what was sent and how long the attempt ran.
    expect(error).toBeInstanceOf(OmlxRequestError);
    const params = sentParams(omlx.requests[0]);
    expect(error).toMatchObject({ attempts: 1, latencyMs: TIMEOUT, params, retries: [] });
  });

  test("a prompt over the context budget is refused unsent", async () => {
    const { omlx, config, queue } = await setup();
    const budget = config.queue.contextBudgetTokens;
    const content = "x".repeat(Math.ceil(budget * CHARS_PER_TOKEN) + 1);
    await expect(queue.request(ask(content))).rejects.toThrow(
      `over the context budget of ${budget} tokens`,
    );
    expect(omlx.requests).toHaveLength(0);
  });

  test("cancel rejects the queued requests and aborts the one in flight", async () => {
    const { clock, omlx, queue } = await setup();
    omlx.script({ tokens: ["held"], holdAfter: 1 }, { tokens: ["after"] });
    const results = [1, 2, 3].map(() => settle(queue.request(ask())));
    await omlx.waitForRequests(1);
    queue.cancel();
    for (const { error } of await Promise.all(results)) {
      expect(error?.message).toBe("omlx request cancelled");
    }
    await omlx.waitForAborted(1);
    expect(omlx.requests).toHaveLength(1);
    // The queue still takes requests after a cancel.
    const next = queue.request(ask());
    await clock.waitForTimer(QUEUE.minGapMs);
    clock.advance(QUEUE.minGapMs);
    expect((await next).text).toBe("after");
  });

  test("sends response_format only when the config says to", async () => {
    const { omlx, queue } = await setup({ sendResponseFormat: true });
    omlx.script({ tokens: ["{}"] });
    const schema = { type: "object" };
    await queue.request({ ...ask(), responseFormat: { name: "answer", schema } });
    expect(omlx.requests[0]?.body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "answer", schema, strict: true },
    });
  });

  test("a 400 naming response_format fails with the hint to turn it off", async () => {
    const { omlx, queue } = await setup({ sendResponseFormat: true });
    omlx.script({ status: 400, body: '{"error":{"message":"response_format not supported"}}' });
    const request = { ...ask(), responseFormat: { name: "answer", schema: {} } };
    await expect(queue.request(request)).rejects.toThrow(
      "set queue.sendResponseFormat to false in the config",
    );
    expect(omlx.requests).toHaveLength(1);
  });
});

/** @param {unknown} data */
const sse = (data) => `data: ${JSON.stringify(data)}\n\n`;
/** @param {string} content */
const contentEvent = (content) => sse({ choices: [{ index: 0, delta: { content } }] });

describe("createOmlxQueue failures and stream parsing", () => {
  test("cancel during a backoff rejects the request and sends nothing more", async () => {
    const { clock, omlx, queue } = await setup();
    omlx.script({ status: 429, body: "busy" });
    const result = settle(queue.request(ask()));
    await clock.waitForTimer(/** @type {number} */ (BACKOFFS[0]));
    queue.cancel();
    expect((await result).error?.message).toBe("omlx request cancelled");
    await clock.waitFor((pending) => pending.length === 0);
    expect(omlx.requests).toHaveLength(1);
  });

  test("cancel during the gap rejects the waiting request unsent", async () => {
    const { clock, omlx, queue } = await setup();
    omlx.script({ tokens: ["one"] });
    const first = queue.request(ask());
    const second = settle(queue.request(ask()));
    expect((await first).text).toBe("one");
    await clock.waitForTimer(QUEUE.minGapMs);
    queue.cancel();
    const { error } = await second;
    expect(error?.message).toBe("omlx request cancelled");
    expect(error).toMatchObject({ attempts: 0, latencyMs: null });
    await clock.waitFor((pending) => pending.length === 0);
    expect(omlx.requests).toHaveLength(1);
  });

  test("an event that isn't JSON fails with omlx's context, and the next request never overlaps it", async () => {
    const { clock, omlx, queue } = await setup();
    // Held open after the bad event: only the client closing its connection ends the first.
    omlx.script({ raw: [contentEvent("a"), "data: {not json\n\n"], holdAfter: 2 });
    omlx.script({ tokens: ["next"] });
    const failed = settle(queue.request(ask()));
    const next = queue.request(ask());
    expect((await failed).error?.message).toBe(
      "omlx sent a stream event that isn't JSON: {not json",
    );
    await clock.waitForTimer(QUEUE.minGapMs);
    clock.advance(QUEUE.minGapMs);
    expect((await next).text).toBe("next");
    expect(omlx.maxInFlight()).toBe(1);
  });

  test("an error event mid-stream fails with its message", async () => {
    const { omlx, queue } = await setup();
    omlx.script({ raw: [contentEvent("a"), sse({ error: { message: "model crashed" } })] });
    await expect(queue.request(ask())).rejects.toThrow("omlx stream error: model crashed");
  });

  test("a stream that ends without a finish_reason fails", async () => {
    const { omlx, queue } = await setup();
    omlx.script({ raw: [contentEvent("a"), "data: [DONE]\n\n"] });
    await expect(queue.request(ask())).rejects.toThrow(
      "omlx's stream ended without a finish_reason",
    );
  });

  test("chunks split mid-line and mid-character, and a last event with no newline, parse", async () => {
    const { omlx, queue } = await setup();
    const whole = Buffer.from(
      `${sse({ choices: [{ index: 0, delta: { content: "café" }, finish_reason: "stop" }] })}` +
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } })}`,
    );
    const accent = whole.indexOf(Buffer.from("é"));
    omlx.script({
      raw: [whole.subarray(0, 12), whole.subarray(12, accent + 1), whole.subarray(accent + 1)],
    });
    const result = await queue.request(ask());
    expect([result.text, result.finishReason]).toEqual(["café", "stop"]);
    expect([result.promptTokens, result.completionTokens]).toEqual([3, 1]);
  });

  test("reasoning content is kept apart from the text and counts as the first token", async () => {
    const { clock, omlx, queue } = await setup();
    omlx.script({ reasoning: ["think", "ing"], tokens: ["late", " answer"], holdAfter: 0 });
    const result = queue.request(ask());
    await omlx.waitForRequests(1);
    await clock.waitFor((pending) => !pending.some((timer) => timer.delay === THRESHOLD));
    clock.advance(THRESHOLD);
    omlx.release();
    expect(await result).toMatchObject({
      text: "late answer",
      reasoning: "thinking",
      firstTokenMs: 0,
      latencyMs: THRESHOLD,
      retries: [],
    });
  });

  test("time to first token and latency are measured on the injected clock", async () => {
    const { clock, omlx, queue } = await setup();
    omlx.script({ tokens: ["a", "b"], holdAfter: 0 });
    const result = queue.request(ask());
    await omlx.waitForRequests(1);
    clock.advance(1_234);
    omlx.release();
    expect(await result).toMatchObject({ firstTokenMs: 1_234, latencyMs: 1_234 });
  });

  test("every request carries the bearer key, and params never hold it", async () => {
    const { omlx, queue } = await setup();
    omlx.script({ tokens: ["a"] });
    const completion = await queue.request(ask());
    expect(omlx.requests[0]?.authorization).toBe(`Bearer ${TEST_OMLX_KEY}`);
    expect(JSON.stringify(completion)).not.toContain(TEST_OMLX_KEY);
    expect(JSON.stringify(omlx.requests[0]?.body)).not.toContain(TEST_OMLX_KEY);
  });

  test.each([401, 403])(
    "an HTTP %i fails at once, is not retried and does not leak the key",
    async (status) => {
      const { omlx, queue, retries } = await setup();
      omlx.script({ status, body: `refused ${TEST_OMLX_KEY}` });
      const { error } = await settle(queue.request(ask()));
      expect(error).toBeInstanceOf(OmlxRequestError);
      const failure = /** @type {OmlxRequestError} */ (error);
      expect(failure.message).toBe(
        `omlx refused the studio's API key (HTTP ${status}); check omlx.apiKey in the config`,
      );
      expect(omlx.requests).toHaveLength(1);
      expect(failure.attempts).toBe(1);
      expect(retries).toEqual([]);
      const everything = JSON.stringify([
        failure.message,
        failure.params,
        failure.retries,
        String(failure.cause),
        failure.stack,
      ]);
      expect(everything).not.toContain(TEST_OMLX_KEY);
      expect(failure.params).toEqual(sentParams(omlx.requests[0]));
    },
  );

  test("an HTTP 500 fails with its body and is not retried", async () => {
    const { omlx, queue, retries } = await setup();
    omlx.script({ status: 500, body: "boom" });
    await expect(queue.request(ask())).rejects.toThrow("omlx answered HTTP 500: boom");
    expect(omlx.requests).toHaveLength(1);
    expect(retries).toEqual([]);
  });

  test("an error status whose body is slower than the threshold is not read as busy", async () => {
    const { clock, omlx, queue, retries } = await setup();
    omlx.script({ status: 500, body: "slow boom", holdAfter: 0 });
    const result = settle(queue.request(ask()));
    await omlx.waitForRequests(1);
    await clock.waitFor((pending) => !pending.some((timer) => timer.delay === THRESHOLD));
    clock.advance(THRESHOLD);
    omlx.release();
    expect((await result).error?.message).toBe("omlx answered HTTP 500: slow boom");
    expect(retries).toEqual([]);
  });
});

describe("max_tokens", () => {
  /** @param {unknown} genome */
  const answerTokens = (genome) =>
    estimateTokens(JSON.stringify({ intent: INTENT, genome }, null, 2));

  test("example.json as an answer fits in the example config's max_tokens with the headroom", async () => {
    const root = await tempRoot();
    cleanups.push(root.remove);
    const { maxTokens } = loadConfig(root.configPath).queue;
    expect(answerTokens(exampleGenome) + THINKING_HEADROOM_TOKENS).toBeLessThanOrEqual(maxTokens);
    expect(answerTokens(randomGenome(LONGEST_SEED)) + THINKING_HEADROOM_TOKENS).toBeLessThanOrEqual(
      maxTokens,
    );
  });
});

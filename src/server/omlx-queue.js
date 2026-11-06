// The only code that calls omlx (decision 0022). omlx also serves a live public site, so requests
// wait in one in-process FIFO: one in flight, a minimum gap after each, and a busy omlx (HTTP 429
// or 503, or a slow first token) backed off exponentially and reported, never retried silently.
/** @import { Config, QueueConfig } from "../config/config.js" */

/** The context budget's estimate of characters per token, for prompts and answers alike. */
export const CHARS_PER_TOKEN = 3.5;

/**
 * Tokens `text` is estimated to take at `CHARS_PER_TOKEN`, rounded up.
 * @param {string} text
 * @returns {number}
 */
export const estimateTokens = (text) => Math.ceil(text.length / CHARS_PER_TOKEN);

/** @typedef {{ role: "system" | "user" | "assistant", content: string }} ChatMessage */

/**
 * The timers the queue uses for its gap, backoff and timeouts; the server passes the real ones,
 * tests a fake.
 * @typedef {object} Clock
 * @property {() => number} now milliseconds
 * @property {(callback: () => void, ms: number) => unknown} setTimeout
 * @property {(handle: any) => void} clearTimeout
 */

/**
 * @typedef {object} CompletionRequest
 * @property {ChatMessage[]} messages
 * @property {{ temperature?: number, top_p?: number, seed?: number }} [sampling] sent as is
 * @property {{ name: string, schema: object }} [responseFormat] the JSON schema sent as
 *   `response_format` when `queue.sendResponseFormat` is true; required then, ignored otherwise
 */

/**
 * One busy answer the queue backed off from.
 * @typedef {object} RetryEvent
 * @property {number} attempt the attempt that found omlx busy, from 1
 * @property {string} reason `HTTP 429`, `HTTP 503` or `no first token in <n> s`
 * @property {number} delayMs the backoff before the next attempt
 */

/**
 * @typedef {object} Completion
 * @property {string} text the streamed `content`
 * @property {string} reasoning the streamed `reasoning_content` (or `reasoning`) a reasoning
 *   model sends beside the content; "" when there is none
 * @property {string} finishReason `stop`, or `length` when the answer hit `max_tokens`
 * @property {number} latencyMs from sending the request that answered to the stream's end
 * @property {number} firstTokenMs from sending it to the first content or reasoning text
 * @property {number | null} promptTokens from the stream's `usage`; null when it sent none
 * @property {number | null} completionTokens likewise
 * @property {RetryEvent[]} retries every backoff before the answer, also passed to `onRetry`
 */

/**
 * @typedef {object} OmlxQueue
 * @property {(request: CompletionRequest) => Promise<Completion>} request queues one chat
 *   completion; a prompt over the context budget is refused before it is queued
 * @property {() => void} cancel rejects every queued request and aborts the one in flight; the
 *   queue takes new requests afterwards
 */

/** Abort reasons the attempt tells apart from a cancel. */
const SLOW_FIRST_TOKEN = Symbol("slow first token");
const TIMED_OUT = Symbol("timed out");

/** @param {number} ms */
const seconds = (ms) => `${ms / 1000} s`;

/**
 * @param {object} options
 * @param {Config["omlx"]} options.omlx
 * @param {QueueConfig} options.queue
 * @param {Clock} options.clock
 * @param {() => number} options.jitter a draw in [0, 1) for each backoff
 * @param {(event: RetryEvent) => void} options.onRetry called before each backoff, for the
 *   caller's log
 * @returns {OmlxQueue}
 */
export function createOmlxQueue({ omlx, queue, clock, jitter, onRetry }) {
  const url = `${omlx.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  /** @type {{ request: CompletionRequest, resolve: (c: Completion) => void, reject: (e: Error) => void }[]} */
  const waiting = [];
  let running = false;
  let lastEndedAt = Number.NEGATIVE_INFINITY;
  /** Counts cancels, so a request that was running when one came stops at its next step. */
  let cancels = 0;
  const cancelled = () => new Error("omlx request cancelled");
  /** Stops whatever the running request is waiting on: its backoff, its gap or its fetch. */
  /** @type {((error: Error) => void) | undefined} */
  let interrupt;

  /** @param {number} ms */
  function sleep(ms) {
    if (!(ms > 0)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const handle = clock.setTimeout(() => {
        interrupt = undefined;
        resolve(undefined);
      }, ms);
      interrupt = (error) => {
        clock.clearTimeout(handle);
        interrupt = undefined;
        reject(error);
      };
    });
  }

  /**
   * One HTTP request. Returns the completion, or `{ busy }` when omlx is busy; throws on
   * anything else.
   * @param {CompletionRequest} request
   * @returns {Promise<Omit<Completion, "retries"> | { busy: string }>}
   */
  async function attempt(request) {
    const controller = new AbortController();
    const start = clock.now();
    const timeout = clock.setTimeout(() => controller.abort(TIMED_OUT), queue.requestTimeoutMs);
    /** @type {unknown} */
    let firstTokenTimer = clock.setTimeout(
      () => controller.abort(SLOW_FIRST_TOKEN),
      queue.firstTokenThresholdMs,
    );
    interrupt = (error) => controller.abort(error);
    try {
      /** @type {Response} */
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify(body(request)),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error(`can't reach omlx at ${url}`, { cause: error });
      }
      if (response.status === 429 || response.status === 503) {
        await response.body?.cancel();
        return { busy: `HTTP ${response.status}` };
      }
      if (!response.ok) {
        const text = await response.text();
        if (response.status === 400 && /response_format|json_schema/.test(text)) {
          throw new Error(
            `omlx refused the JSON-schema response_format (HTTP 400: ${text}); ` +
              "set queue.sendResponseFormat to false in the config",
          );
        }
        throw new Error(`omlx answered HTTP ${response.status}: ${text}`);
      }
      if (response.body === null) throw new Error("omlx answered with no body");

      let text = "";
      let reasoning = "";
      /** @type {string | null} */
      let finishReason = null;
      /** @type {number | null} */
      let firstAt = null;
      /** @type {{ prompt_tokens?: unknown, completion_tokens?: unknown } | null} */
      let usage = null;
      let buffer = "";
      for await (const piece of response.body.pipeThrough(new TextDecoderStream())) {
        buffer += piece;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          const event = JSON.parse(data);
          if (event.error) {
            throw new Error(`omlx stream error: ${event.error.message ?? JSON.stringify(event)}`);
          }
          if (event.usage) usage = event.usage;
          const choice = event.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? {};
          const thought = delta.reasoning_content ?? delta.reasoning;
          if (typeof delta.content === "string") text += delta.content;
          if (typeof thought === "string") reasoning += thought;
          if (firstAt === null && (text !== "" || reasoning !== "")) {
            firstAt = clock.now();
            clock.clearTimeout(firstTokenTimer);
            firstTokenTimer = undefined;
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      }
      if (finishReason === null) throw new Error("omlx's stream ended without a finish_reason");
      const end = clock.now();
      /** @param {unknown} value */
      const count = (value) => (typeof value === "number" ? value : null);
      return {
        text,
        reasoning,
        finishReason,
        latencyMs: end - start,
        firstTokenMs: (firstAt ?? end) - start,
        promptTokens: count(usage?.prompt_tokens),
        completionTokens: count(usage?.completion_tokens),
      };
    } catch (error) {
      const reason = controller.signal.reason;
      if (controller.signal.aborted) {
        if (reason === SLOW_FIRST_TOKEN) {
          return { busy: `no first token in ${seconds(queue.firstTokenThresholdMs)}` };
        }
        if (reason === TIMED_OUT) {
          throw new Error(`omlx request timed out after ${seconds(queue.requestTimeoutMs)}`);
        }
        if (reason instanceof Error) throw reason;
      }
      throw error;
    } finally {
      clock.clearTimeout(timeout);
      if (firstTokenTimer !== undefined) clock.clearTimeout(firstTokenTimer);
      interrupt = undefined;
    }
  }

  /** @param {CompletionRequest} request */
  function body(request) {
    return {
      model: omlx.model,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      n: 1,
      max_tokens: queue.maxTokens,
      ...request.sampling,
      ...(queue.sendResponseFormat && request.responseFormat
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { ...request.responseFormat, strict: true },
            },
          }
        : {}),
    };
  }

  /**
   * @param {CompletionRequest} request
   * @returns {Promise<Completion>}
   */
  async function run(request) {
    /** @type {RetryEvent[]} */
    const retries = [];
    let waited = 0;
    const epoch = cancels;
    for (let number = 1; ; number++) {
      await sleep(lastEndedAt + queue.minGapMs - clock.now());
      if (cancels !== epoch) throw cancelled();
      /** @type {Awaited<ReturnType<typeof attempt>>} */
      let outcome;
      try {
        outcome = await attempt(request);
      } finally {
        lastEndedAt = clock.now();
      }
      if (!("busy" in outcome)) return { ...outcome, retries };
      if (cancels !== epoch) throw cancelled();
      const draw = jitter();
      if (!(draw >= 0 && draw < 1))
        throw new Error(`omlx queue: jitter drew ${draw}, not in [0, 1)`);
      const delayMs = Math.round(queue.backoffBaseMs * 2 ** (number - 1) * (0.5 + 0.5 * draw));
      if (waited + delayMs > queue.maxWaitMs) {
        throw new Error(
          `omlx stayed busy (${outcome.busy}) through ${seconds(waited)} of backoff over ` +
            `${number} attempts, and the next wait would pass the ${seconds(queue.maxWaitMs)} ` +
            "maximum. The live site is using it; try again later.",
        );
      }
      waited += delayMs;
      const event = { attempt: number, reason: outcome.busy, delayMs };
      retries.push(event);
      onRetry(event);
      await sleep(delayMs);
      if (cancels !== epoch) throw cancelled();
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    for (let job = waiting.shift(); job !== undefined; job = waiting.shift()) {
      try {
        job.resolve(await run(job.request));
      } catch (error) {
        job.reject(/** @type {Error} */ (error));
      }
    }
    running = false;
  }

  return {
    request(request) {
      const prompt = request.messages.map((message) => message.content).join("");
      const tokens = estimateTokens(prompt);
      if (tokens > queue.contextBudgetTokens) {
        return Promise.reject(
          new Error(
            `omlx prompt is about ${tokens} tokens (${prompt.length} characters at ` +
              `${CHARS_PER_TOKEN} a token), over the context budget of ` +
              `${queue.contextBudgetTokens} tokens; it was not sent`,
          ),
        );
      }
      if (queue.sendResponseFormat && request.responseFormat === undefined) {
        return Promise.reject(
          new Error("omlx request has no responseFormat, and queue.sendResponseFormat is true"),
        );
      }
      return new Promise((resolve, reject) => {
        waiting.push({ request, resolve, reject });
        void pump();
      });
    },
    cancel() {
      cancels++;
      for (const job of waiting.splice(0)) job.reject(cancelled());
      interrupt?.(cancelled());
    },
  };
}

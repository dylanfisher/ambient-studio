// The only code that calls omlx (decision 0022). omlx also serves a live public site, so requests
// wait in one in-process FIFO: one in flight, a minimum gap after each, and a busy omlx (HTTP 429
// or 503, or a slow first token) backed off exponentially and reported, never retried silently.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
/** @import { IncomingMessage } from "node:http" */
/** @import { Config, QueueConfig } from "../config/config.js" */
/** @import { ChatMessage } from "../domain/prompt-tokens.js" */
import { CHARS_PER_TOKEN, estimateTokens, promptText } from "../domain/prompt-tokens.js";

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

/** @typedef {{ busy: string, slowFirstToken: boolean }} Busy */

/** Abort reasons the attempt tells apart from a cancel. */
const SLOW_FIRST_TOKEN = Symbol("slow first token");
const TIMED_OUT = Symbol("timed out");

/** @param {number} ms */
const seconds = (ms) => `${ms / 1000} s`;

/**
 * @param {IncomingMessage} response
 * @returns {Promise<string>}
 */
async function readText(response) {
  let text = "";
  for await (const piece of response) text += piece;
  return text;
}

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
  const url = new URL(`${omlx.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  /** @type {{ request: CompletionRequest, prefillMs: number, resolve: (c: Completion) => void, reject: (e: Error) => void }[]} */
  const waiting = [];
  let running = false;
  let lastEndedAt = Number.NEGATIVE_INFINITY;
  /** Counts cancels, so a request that was running when one came stops at its next step. */
  let cancels = 0;
  const cancelled = () => new Error("omlx request cancelled");
  /** Stops whatever the running request is waiting on: its backoff, its gap or its request. */
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
   * One HTTP request on a connection of its own, closed before this returns, so the next
   * attempt never shares omlx with a socket this one left open. Returns the completion, or
   * `Busy`; throws on anything else.
   * @param {CompletionRequest} request
   * @param {number} prefillMs the prompt's prefill allowance, added to both time limits
   * @returns {Promise<Omit<Completion, "retries"> | Busy>}
   */
  async function attempt(request, prefillMs) {
    const firstTokenLimitMs = queue.firstTokenThresholdMs + prefillMs;
    const timeoutMs = queue.requestTimeoutMs + prefillMs;
    const payload = JSON.stringify(body(request));
    const start = clock.now();
    const req = send(url, {
      method: "POST",
      agent: false,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        accept: "text/event-stream",
      },
    });
    let socketOpen = false;
    /** @type {Promise<unknown>} */
    const socketClosed = new Promise((resolve) => {
      req.once("socket", (socket) => {
        socketOpen = true;
        socket.once("close", () => {
          socketOpen = false;
          resolve(undefined);
        });
      });
    });
    /** @type {unknown} */
    let abortReason;
    /** @param {unknown} reason */
    const abort = (reason) => {
      if (abortReason !== undefined) return;
      abortReason = reason;
      req.destroy();
    };
    const timeout = clock.setTimeout(() => abort(TIMED_OUT), timeoutMs);
    /** @type {unknown} */
    let firstTokenTimer = clock.setTimeout(() => abort(SLOW_FIRST_TOKEN), firstTokenLimitMs);
    const stopFirstTokenTimer = () => {
      if (firstTokenTimer === undefined) return;
      clock.clearTimeout(firstTokenTimer);
      firstTokenTimer = undefined;
    };
    interrupt = abort;
    try {
      /** @type {IncomingMessage} */
      let response;
      try {
        response = await new Promise((resolve, reject) => {
          req.once("response", resolve);
          req.once("error", reject);
          req.once("close", () => reject(new Error("the connection closed before an answer")));
          req.end(payload);
        });
      } catch (error) {
        if (abortReason !== undefined) throw error;
        throw new Error(`can't reach omlx at ${url}`, { cause: error });
      }
      response.setEncoding("utf8");
      const status = response.statusCode ?? 0;
      if (status !== 200) stopFirstTokenTimer();
      if (status === 429 || status === 503)
        return { busy: `HTTP ${status}`, slowFirstToken: false };
      if (status < 200 || status > 299) {
        const text = await readText(response);
        if (status === 400 && /response_format|json_schema/.test(text)) {
          throw new Error(
            `omlx refused the JSON-schema response_format (HTTP 400: ${text}); ` +
              "set queue.sendResponseFormat to false in the config",
          );
        }
        throw new Error(`omlx answered HTTP ${status}: ${text}`);
      }

      let text = "";
      let reasoning = "";
      /** @type {string | null} */
      let finishReason = null;
      /** @type {number | null} */
      let firstAt = null;
      /** @type {{ prompt_tokens?: unknown, completion_tokens?: unknown } | null} */
      let usage = null;
      /** @param {string} line one line of the event stream, without its newline */
      const read = (line) => {
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        /** @type {any} */
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          throw new Error(`omlx sent a stream event that isn't JSON: ${data.slice(0, 200)}`);
        }
        if (event.error) {
          throw new Error(`omlx stream error: ${event.error.message ?? JSON.stringify(event)}`);
        }
        if (event.usage) usage = event.usage;
        const choice = event.choices?.[0];
        if (!choice) return;
        const delta = choice.delta ?? {};
        const thought = delta.reasoning_content ?? delta.reasoning;
        if (typeof delta.content === "string") text += delta.content;
        if (typeof thought === "string") reasoning += thought;
        if (firstAt === null && (text !== "" || reasoning !== "")) {
          firstAt = clock.now();
          stopFirstTokenTimer();
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      };
      // setEncoding decodes UTF-8 across chunks; lines are split here, across chunks too.
      let buffer = "";
      for await (const piece of response) {
        const lines = (buffer + piece).split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) read(line.replace(/\r$/, ""));
      }
      read(buffer.replace(/\r$/, ""));
      if (abortReason !== undefined) throw new Error("aborted");
      if (finishReason === null) throw new Error("omlx's stream ended without a finish_reason");
      const end = clock.now();
      // tsc narrows these to their initial null, not seeing `read` assign them.
      const counts =
        /** @type {{ prompt_tokens?: unknown, completion_tokens?: unknown } | null} */ (usage);
      const first = /** @type {number | null} */ (firstAt);
      /** @param {unknown} value */
      const count = (value) => (typeof value === "number" ? value : null);
      return {
        text,
        reasoning,
        finishReason,
        latencyMs: end - start,
        firstTokenMs: (first ?? end) - start,
        promptTokens: count(counts?.prompt_tokens),
        completionTokens: count(counts?.completion_tokens),
      };
    } catch (error) {
      if (abortReason === SLOW_FIRST_TOKEN) {
        return { busy: `no first token in ${seconds(firstTokenLimitMs)}`, slowFirstToken: true };
      }
      if (abortReason === TIMED_OUT) {
        throw new Error(`omlx request timed out after ${seconds(timeoutMs)}`);
      }
      if (abortReason instanceof Error) throw abortReason;
      throw error;
    } finally {
      clock.clearTimeout(timeout);
      stopFirstTokenTimer();
      interrupt = undefined;
      req.destroy();
      if (socketOpen) await socketClosed;
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
   * @param {number} prefillMs
   * @returns {Promise<Completion>}
   */
  async function run(request, prefillMs) {
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
        outcome = await attempt(request, prefillMs);
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
            (outcome.slowFirstToken
              ? "maximum. It may be serving the live site, or its prefill is slower than " +
                `queue.minPrefillTokensPerSecond (${queue.minPrefillTokensPerSecond}); try ` +
                "again later, or lower that key."
              : "maximum. The live site is using it; try again later."),
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
        job.resolve(await run(job.request, job.prefillMs));
      } catch (error) {
        job.reject(/** @type {Error} */ (error));
      }
    }
    running = false;
  }

  return {
    request(request) {
      const prompt = promptText(request.messages);
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
      const prefillMs = Math.ceil((tokens * 1000) / queue.minPrefillTokensPerSecond);
      return new Promise((resolve, reject) => {
        waiting.push({ request, prefillMs, resolve, reject });
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

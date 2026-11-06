// A stand-in for omlx's chat completions endpoint (decision 0022): a node:http server on an
// ephemeral port that answers each request with the next scripted response, streamed as
// server-sent events the way an OpenAI-compatible server sends them. Tests never reach the real
// omlx, which serves a live site.
import { once } from "node:events";
import { createServer } from "node:http";
import { setImmediate } from "node:timers/promises";

/**
 * One scripted answer. `status` other than 200 answers with that status and `body` and no
 * stream. `raw` writes its pieces as they are, one per turn of the event loop with Nagle off, so
 * a piece can end mid-line or mid-character. Otherwise `reasoning` and then `tokens` are
 * streamed one event each, then `finishReason` (default "stop"); a request whose `max_tokens`
 * is below the token count gets only that many and "length". `holdAfter` streams that many
 * tokens or `raw` pieces (0 holds before the first, or before a status answer's body) and waits
 * for `release()`.
 * @typedef {object} Scripted
 * @property {number} [status]
 * @property {string} [body]
 * @property {(string | Uint8Array)[]} [raw]
 * @property {string[]} [reasoning] sent as `delta.reasoning_content`
 * @property {string[]} [tokens]
 * @property {string} [finishReason]
 * @property {{ prompt_tokens: number, completion_tokens: number }} [usage] sent in a last event
 *   before `[DONE]`, as servers do for `stream_options.include_usage`
 * @property {number} [holdAfter]
 */

/**
 * @typedef {object} Received
 * @property {Record<string, any>} body the parsed request body
 * @property {number} at the injected clock's time when the request arrived
 */

/**
 * @typedef {object} FakeOmlx
 * @property {string} baseUrl `http://127.0.0.1:<port>`
 * @property {(...responses: Scripted[]) => void} script adds answers, used in order
 * @property {Received[]} requests every request received, in order
 * @property {() => number} maxInFlight the most requests open at once when one arrived; a
 *   request counts as open until its connection closes, not only until its answer ends
 * @property {() => number} aborted requests the client closed before the answer ended
 * @property {(count: number) => Promise<void>} waitForRequests resolves once `count` requests
 *   have arrived
 * @property {(count: number) => Promise<void>} waitForAborted resolves once `count` requests
 *   have been closed by the client before the answer ended
 * @property {() => void} release lets every held stream go on
 * @property {() => Promise<void>} close
 */

/**
 * @param {{ now: () => number }} clock stamps each request's arrival
 * @returns {Promise<FakeOmlx>}
 */
export async function fakeOmlx(clock) {
  /** @type {Scripted[]} */
  const queue = [];
  /** @type {Received[]} */
  const requests = [];
  let inFlight = 0;
  let most = 0;
  let aborted = 0;
  /** @type {WeakSet<object>} */
  const counted = new WeakSet();
  /** @type {(() => void)[]} */
  let held = [];
  /** @type {(() => void)[]} */
  let waiters = [];
  const notify = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  /** @param {() => boolean} condition */
  const until = async (condition) => {
    while (!condition()) await new Promise((resolve) => waiters.push(() => resolve(undefined)));
  };
  const hold = () => new Promise((resolve) => held.push(() => resolve(0)));

  const server = createServer(async (req, res) => {
    const socket = req.socket;
    if (!counted.has(socket)) {
      counted.add(socket);
      inFlight++;
      socket.once("close", () => {
        inFlight--;
        notify();
      });
    }
    most = Math.max(most, inFlight);
    let ended = false;
    const end = (/** @type {string} */ text) => {
      ended = true;
      res.end(text);
    };
    res.on("close", () => {
      if (!ended) aborted++;
      notify();
    });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ body, at: clock.now() });
    const answer = queue.shift();
    notify();
    if (answer === undefined) {
      res.writeHead(500, { "content-type": "text/plain" });
      end(`fake omlx: request ${requests.length} has no scripted response`);
      return;
    }
    if (answer.status !== undefined && answer.status !== 200) {
      res.writeHead(answer.status, { "content-type": "application/json" });
      if (answer.holdAfter === 0) {
        res.flushHeaders();
        await hold();
        if (res.destroyed) return;
      }
      end(answer.body ?? "");
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
    if (answer.raw) {
      socket.setNoDelay(true);
      for (const [index, piece] of answer.raw.entries()) {
        if (index === answer.holdAfter) await hold();
        if (res.destroyed) return;
        res.write(piece);
        await setImmediate();
      }
      if (answer.raw.length === answer.holdAfter) await hold();
      if (res.destroyed) return;
      end("");
      return;
    }
    const tokens = answer.tokens ?? [];
    const cut = tokens.length > body.max_tokens;
    const sent = cut ? tokens.slice(0, body.max_tokens) : tokens;
    /** @param {unknown} data */
    const event = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    /** @param {object} choice */
    const chunk = (choice) =>
      event({ object: "chat.completion.chunk", model: body.model, choices: [choice] });
    for (const thought of answer.reasoning ?? []) {
      chunk({ index: 0, delta: { reasoning_content: thought }, finish_reason: null });
    }
    for (const [index, token] of sent.entries()) {
      if (index === answer.holdAfter) await hold();
      if (res.destroyed) return;
      chunk({ index: 0, delta: { content: token }, finish_reason: null });
    }
    if (sent.length === answer.holdAfter) await hold();
    if (res.destroyed) return;
    chunk({
      index: 0,
      delta: {},
      finish_reason: cut ? "length" : (answer.finishReason ?? "stop"),
    });
    if (answer.usage) event({ object: "chat.completion.chunk", choices: [], usage: answer.usage });
    end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake omlx: no port");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    script: (...responses) => {
      queue.push(...responses);
    },
    requests,
    maxInFlight: () => most,
    aborted: () => aborted,
    waitForRequests: (count) => until(() => requests.length >= count),
    waitForAborted: (count) => until(() => aborted >= count),
    release() {
      for (const resume of held.splice(0)) resume();
    },
    async close() {
      for (const resume of held.splice(0)) resume();
      held = [];
      waiters = [];
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

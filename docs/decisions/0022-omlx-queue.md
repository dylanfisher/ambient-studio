# 0022. One FIFO queue is the only omlx client

- **Date:** 2026-11-06
- **Status:** accepted

## Context

omlx at `http://127.0.0.1:8000` serves a live public site from the same machine. The spec allows
at most one request in flight from the studio, backing off when the site is busy, and the model
id from config; the studio may never change omlx's settings or models. Phase 2's generation
(2f) and evaluation (2l) jobs need chat completions with their text, `finish_reason`, timing and
token counts stored per candidate. 0019 left the queue's numbers to this step.

## Decision

`src/server/omlx-queue.js` is the only code that sends an HTTP request. `createOmlxQueue({omlx,
queue, clock, jitter, onRetry})` returns `request(req)` and `cancel()`.

**Queue.** One in-process FIFO. A request runs only when the one before it has ended, and every
attempt, retries included, starts at least `minGapMs` after the previous attempt ended, so a
request from the live site that arrived meanwhile gets omlx first. The gap is waited only when a
request is waiting; an empty queue holds no timer. Nothing starts on its own: the queue runs
what a caller hands it.

**Request.** `POST {baseUrl}/v1/chat/completions` with the config's `omlx.model`, `stream:
true`, `stream_options: {include_usage: true}`, `n: 1`, `max_tokens: queue.maxTokens`, and the
caller's sampling fields (`temperature`, `top_p`, `seed`) as given. One candidate per request:
`n > 1` would hold omlx for n answers at once.

**Context budget.** A prompt is estimated at 3.5 characters a token (`CHARS_PER_TOKEN`) over the
messages' content. Over `contextBudgetTokens`, `request()` rejects before queueing and nothing
is sent. The budget covers the prompt only; `max_tokens` bounds the answer.

**Busy.** HTTP 429 or 503, or no first token (content or reasoning text) within
`firstTokenThresholdMs` of sending, in which case the request is aborted. Busy backs off: retry
k waits `backoffBaseMs · 2^(k−1) · (0.5 + 0.5·u)`, with u from the injected `jitter` (equal
jitter: never less than half the step, so two clients don't stay in lockstep, and with the
example's numbers never under the gap). When the waits so far plus the next would pass `maxWaitMs`, the request fails with a
message for the owner: "omlx stayed busy (HTTP 429) through 21 s of backoff over 4 attempts, and
the next wait would pass the 30 s maximum. The live site is using it; try again later." Every
retry goes to `onRetry` (required) and into the result's `retries`, so none is silent.

**Other failures** are not retried: a network error ("can't reach omlx at …"), any other HTTP
status (with its body), an `error` event in the stream, or a stream that ends without a
`finish_reason`.

**Timeout.** `requestTimeoutMs` bounds one attempt from sending to the stream's end, through an
`AbortController`; past it the request fails with "omlx request timed out after N s".

**Streaming parse.** Server-sent events, split on newlines; only `data:` lines are read and
`[DONE]` is skipped. `choices[0].delta.content` is appended to `text`, and
`delta.reasoning_content` (or `delta.reasoning`) to `reasoning`, kept apart so 2f parses only
the answer and can still store the thinking. The last non-null `finish_reason` is returned; a
cut answer returns `length`, which 2f records as truncated.

**Result.** `text`, `reasoning`, `finishReason`, `latencyMs` and `firstTokenMs` (both from
sending the attempt that answered, on the injected clock), `promptTokens` and `completionTokens`
from the stream's `usage` event when the server sends one, else `null`, never estimated, and
`retries`.

**`response_format`.** Sent as `{type: "json_schema", json_schema: {name, schema, strict:
true}}` only when `queue.sendResponseFormat` is true, which then requires the request to carry
one. A 400 whose body names `response_format` or `json_schema` fails with "set
queue.sendResponseFormat to false in the config". The evaluation run (2l) settles the setting.

**Cancel.** `cancel()` rejects every queued request and aborts the one in flight or in backoff,
each with "omlx request cancelled". The queue takes new requests afterwards.

**Clock.** The queue takes `now`, `setTimeout` and `clearTimeout`, and the jitter draw, as
arguments. `test/support/fake-clock.js` moves time by hand; `test/support/fake-omlx.js` is a
`node:http` server on an ephemeral port that streams scripted answers, answers 429 or 503, cuts
at the request's `max_tokens` with `length`, holds a stream until the test releases it, and
records the most requests it had open at once. No test reaches port 8000.

**Network rule.** `scripts/arch.js` refuses, in `src/` outside the queue module, a `fetch` call
and `request` or `get` from `node:http` or `node:https`, imported by name or called through the
module. `createServer` stays allowed, and so does `fetch` in `src/web`: the browser calls the
studio's own server, and from mbp2015 or mbp2026 it can't reach omlx on mbp2021's loopback.

### Numbers (`src/config/example.json`)

| Key | Value | Why |
|---|---|---|
| `maxTokens` | 10 752 | largest answer, 6 430 tokens, plus 4 096 for a reasoning model's thinking, rounded up to a multiple of 256 |
| `contextBudgetTokens` | 8 192 | the schema text is 2 931 characters (about 840 tokens), leaving room for constraints, notes and three or four example genomes; short prompts keep prefill short on a shared machine. Prompt plus answer stays under 19 000 tokens, inside any current model's context |
| `requestTimeoutMs` | 600 000 | 10 752 tokens at 20 tokens a second is 538 s |
| `firstTokenThresholdMs` | 30 000 | prefill of an 8 192-token prompt on the M1 Max takes seconds when omlx is idle; 30 s without a token means it is serving something else |
| `minGapMs` | 2 000 | long enough for a waiting site request to be admitted first; 16 s over an 8-candidate request that takes minutes |
| `backoffBaseMs` | 5 000 | first retry after 2.5–5 s, then 5–10, 10–20, … |
| `maxWaitMs` | 300 000 | five minutes of backoff (about six retries) before telling the owner |

**How `maxTokens` was measured.** `randomGenome` under the default cost cap for seeds 0–99 999,
each wrapped as `{intent, genome}` with a 200-character intent, serialized with two-space
indent (the form a model tends to write), and estimated at 3.5 characters a token. The longest,
seed 25 071, is 22 503 characters, 6 430 tokens; the median is about 5 300 characters, 1 500
tokens, and `src/engine/genomes/example.json` is 2 438, 697 tokens. Pretty-printed characters
over-count the indentation, which tokenizes cheaply, and under-count digits, so the two roughly
offset; the 4 096 of headroom also absorbs the error. The test checks that example.json and seed
25 071 each fit with the headroom.

## Alternatives considered

- **Non-streaming requests** — rejected: time to first token is the only busy signal omlx gives
  besides a status code, and a stream that stops can be timed out without waiting for the whole
  answer.
- **Retrying a 400, a 500 or a network error** — rejected: they are not the site being busy, and
  retrying them hides a misconfiguration (principle 5).
- **Full jitter (0 to the whole step)** — rejected: a near-zero wait would retry inside the gap
  the site was promised.
- **An idle timeout between chunks instead of a whole-attempt timeout** — rejected: the point is
  to bound how long one request occupies omlx, and a slow but steady stream would never trip it.
- **Estimating token counts when `usage` is missing** — rejected: 2f stores them, and an estimate
  stored as a count can't be told apart later. `null` says the server didn't say.
- **Refusing `fetch` in src/web too** — rejected: the studio UI (2j) talks to the server over
  HTTP.

## Consequences

- 2f stores what the result returns; a truncated answer is told apart by `finishReason`.
- A model that thinks longer than about 4 300 tokens before a large genome is cut off; 2l's
  truncation count shows whether `maxTokens` needs raising.
- 2g builds the queue with the real clock (`Date.now`, `setTimeout`, `clearTimeout`) and
  `Math.random` as jitter, and logs each `onRetry` event.
- A new HTTP client anywhere in the server goes through this module or changes this record and
  arch.js together.

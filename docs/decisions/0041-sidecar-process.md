# 0041. One sidecar process over stdio, started on the first request

- **Date:** 2026-11-07
- **Status:** accepted; amends [0019](0019-config-file-and-paths.md) (adds
  `sidecar.requestTimeoutMs`); amended by [0042](0042-clap-embeddings.md) (the `path` type,
  numpy at start-up) and [0044](0044-bayesian-bradley-terry.md) (`fit` and `predict`)

## Context

Phase 4 puts CLAP embeddings, preference models and optimizers in the Python sidecar
([0001](0001-stack.md)): a uv-managed package in `sidecar/` that nothing imports and the server
calls. Its later methods load torch and a checkpoint, which takes seconds, so a process per
request would pay that on every call. AGENTS.md says nothing runs in the background, Node owns
every SQLite write, and jobs are cancelled through an `AbortSignal`
([0026](0026-job-runner-and-excerpt-renders.md)). The plan asks for a timeout on every request,
a restart after a crash or a hang that is reported and never retried on its own, and one
protocol file both sides load. Step 4a builds the process and its first two methods, `ping` and
`version`; later steps add methods.

## Decision

**The process.** `createSidecarClient` in `src/server/sidecar-client.js` is the only code that
talks to the sidecar. The server makes one when it starts and puts it on the `App` as
`app.sidecar`; making it starts nothing. The first request starts one long-lived child,
`uv run --frozen python -m ambient_sidecar` in `sidecar/` (`SIDECAR_LAUNCH`), so the lockfile's
environment runs it. Later requests reuse it. The child gets its own process group, and every
stop kills the whole group with SIGKILL: `uv run` starts Python as its own child rather than
replacing itself, and killing uv alone left Python running (measured with uv 0.13.5).

**Framing.** Line-delimited JSON over the child's stdin and stdout, one object per line. A
request is `{id, method, params}`, with `id` a whole number the client counts up from 1 across
processes. An answer is `{id, result}` or `{id, error}`, with `error` a message string. Requests
can be in flight together and are matched to answers by id, so answers may come in any order.
The Python loop answers one request at a time, in order. Audio and arrays pass as file paths
under the data root, never inline; the first method that takes one adds a path type to the
protocol.

**The protocol file** is `src/server/sidecar-protocol.json`: each method's `params` and `result`
as field name to type, where a type is `string`, `number` or `boolean`. It lives in the server
tier because the server imports it (`with { type: "json" }`), and `scripts/arch.js` lets the
server import only server, domain, engine and config; a file under `sidecar/` would be an
import from outside every tier. The sidecar reads it by path from the repo it runs in
(`PROTOCOL_PATH` in `ambient_sidecar/protocol.py`), which works because uv installs the package
editable. A pytest test checks that path is the file the client imports. The client refuses an
unknown method or wrong params before starting anything, and fails a request whose result
doesn't match. The loop refuses wrong params with an error answer, and refuses to start when its
handlers and the file's methods differ.

**What the loop answers.** It reads stdin as bytes, so a line that isn't UTF-8 is a bad line
like any other. A line that isn't UTF-8, isn't JSON, isn't a JSON object, or has no
whole-number `id` gets `{id: null, error}`. An unknown method, wrong params, a method that
raises, or a result `json.dumps` can't encode (NaN and infinities included, with
`allow_nan=False`, since `JSON.parse` can't read them) gets `{id, error}`; a raise also prints
its traceback to stderr. Then it reads the next line, so no request line stops the loop. The loop exits when
stdin closes. Its answers go to a copy of stdout, and file descriptor 1 and `sys.stdout` are
pointed at stderr, so a library that prints (torch and transformers do) can't put a line among
the answers. The loop imports the standard library and numpy; torch and transformers are imported by the
methods that need them ([0042](0042-clap-embeddings.md)), so `ping` doesn't wait on them.

**Timeouts.** Each request has `sidecar.requestTimeoutMs`, from writing it to its answer, on the
server's injected clock. The example sets 120 000 ms: the loop answers `ping` in milliseconds,
and 4b re-measures it against a cold checkpoint load and a batch of embeddings. The timer runs
while a request waits behind another, since the loop takes them in order.

**Ending the process.** Four things end it, and each fails every request in flight with a
message naming that request's method:

- a timeout: `sidecar request ping timed out after 120 s, so the sidecar was stopped`, and the
  others `... failed: the sidecar was stopped because ping timed out`;
- a crash: `sidecar request ping failed: the sidecar exited with code 3: <last stderr line>`,
  since a Python traceback's last line names the exception;
- a broken protocol: a line on stdout that isn't a JSON object, or an answer to an id no request
  in flight has, null included: `... failed: the sidecar wrote a line that isn't JSON: "..."`;
- a cancel: the request's signal aborting. It rejects with `sidecar request ping was
  cancelled`, and the others fail with `... the sidecar was stopped to cancel ping`. A signal
  aborted before the call starts nothing.

An error answer fails only its request and leaves the process running. Nothing is retried: the
job gets the error, and its message is what the owner sees. The next request starts a fresh
process. The sidecar's stderr goes to the server's log a line at a time, prefixed `sidecar: `,
and a process that exits with nothing in flight is logged.

**Stopping the server.** `stop()` cancels the jobs and waits for them, closes the HTTP server,
then calls the client's `stop()`, which kills the process, fails anything still in flight with
`... the server is stopping`, and resolves once every process it started has closed; then the
store closes. Those last two steps run in a `finally`, so a failure waiting on the jobs or the
HTTP server still ends the sidecar and closes the store. Once `stop()` has begun, the client
refuses every request (`sidecar request ping refused: the server is stopping`) instead of
starting a process nothing would kill.

**A kill that fails.** A kill error other than ESRCH (the group already gone) still fails every
request in flight, clears their timers and marks the process closed, so `stop()` doesn't wait
on a close that may never come; the error is thrown after that.

**Tests.** The client is tested against `test/support/fake-sidecar.js`, a Node process that
reads the same requests and does what each scripted step says: answer, error, hold until a later
step releases it, hang, crash, or write a line as given. An answer can be split across two
writes, or several answers sent in one, to check the client's line buffering. It can run under a parent process that
passes its stdio through, as uv does, to check the group kill. `testApp()` gives `app.sidecar`
over the fake. Pytest drives the loop with lists of lines, and `python -m ambient_sidecar` as a
subprocess for the stdout redirect.

## Alternatives considered

- **HTTP on localhost** — rejected: it needs a port, a server library in Python or hand-written
  HTTP, and a way to tell the server is up; `arch.js` allows HTTP clients only in the omlx queue.
  A pipe belongs to the server process alone, and its EOF tells the loop the server has gone.
- **A process per request** — rejected: 4b's methods load torch and a CLAP checkpoint, seconds
  each time, before any work.
- **Starting the sidecar with the server** — rejected: AGENTS.md says nothing runs in the
  background, and most sessions never ask it anything; a start-up that fails because uv or the
  environment is missing would also stop a server that didn't need it.
- **A cancel message to the loop instead of a kill** — rejected: the loop is single-threaded and
  can't read a message while a method runs, so the work would go on using the CPU.
- **Killing only the child Node started** — rejected: that is `uv`, and the Python it started
  kept running after it.
- **Retrying a request after a crash** — rejected by the plan: a crash is reported to the owner,
  and the owner starts the job again.
- **The protocol file in `sidecar/`** — rejected: the server would read it from outside every
  tier, by file path rather than import, and the tier rules would no longer say where it comes
  from.
- **Error answers as `{code, message}` objects** — rejected for now: nothing reads a code. A
  later method that needs one can change the shape in both files and here.

## Consequences

- A long request holds the requests behind it, and their timers run meanwhile. A step whose work
  is long splits it into requests that each fit under the timeout.
- A cancel or timeout costs the next request a fresh start: about 50 ms now, plus whatever the
  methods load once 4b adds torch and the checkpoint.
- The sidecar reads the protocol from the repo, so a non-editable install of the package would
  not find it.
- If the server process itself is killed, the pipe closes and an idle loop exits; a loop stuck
  inside a method lives on until it finishes or is killed by hand.
- A new config key: the owner's config fails to load until it has `sidecar.requestTimeoutMs`.

## Amendments

- 2026-11-07: from step 4b ([0042](0042-clap-embeddings.md)). The protocol has a fourth type,
  `path`: an absolute file path, checked by both sides. The CLAP methods' module imports numpy
  when the loop starts, so the loop no longer imports the standard library alone.
- 2026-11-07: from step 4d ([0044](0044-bayesian-bradley-terry.md)). `fit` and `predict` pass
  the training set, the items and the model as JSON files and the embeddings as float32 files,
  all by path; the loop imports `preference.py`, which needs numpy alone.

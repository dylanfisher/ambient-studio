// A stand-in for the Python sidecar (decision 0041): a Node process that reads line-delimited
// JSON requests on stdin and does what the test scripted for each, so a client test can make it
// answer out of order, hang, crash or write a line that isn't JSON. Steps are taken in the order
// requests arrive, across every process the client starts, and the files that hold them sit in
// a temp folder. No test starts the real sidecar.
/** @import { SidecarLaunch } from "../../src/server/sidecar-client.js" */
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setImmediate as tick } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { drawer } from "../../src/engine/prng.js";

/**
 * What the fake does with one request. `answer` writes `{ id, result }`; `error` writes
 * `{ id, error }`; `hold` keeps `result` until a later step with `release`; `hang` never
 * answers and stays alive after stdin closes, as a Python stuck inside a method would;
 * `crash` writes `stderr` and exits with `code`; `garbage` writes `line` as it is.
 * `release` answers every held request after this step's own answer, newest first, and
 * `together` sends all of those answers in one write. `split` writes an answer in two halves,
 * the second a turn of the event loop after the first has gone. `floats` is written to the
 * request's `out` param as little-endian float32 before the step's answer, as the sidecar
 * writes a vector. `scores` answers a `predict`: it writes to `out` a mean for each item in the
 * request's `items` file, that item's feature at index `feature` (0 for null), and `variance`
 * for each, or the `covariance` given and its diagonal. `points` answers an `optimizer_ask`: it
 * writes `{points}` to `out`, either the points given or, for `{seed, spread}`, the request's
 * `count` points drawn near the run's `spec.json` start by a normal step of that spread, clipped
 * to [0, 1]. An answered `optimizer_start` writes an empty `state.json` beside the spec.
 * @typedef {object} Step
 * @property {"answer" | "error" | "hold" | "hang" | "crash" | "garbage"} do
 * @property {unknown} [result]
 * @property {string} [error]
 * @property {boolean} [release]
 * @property {boolean} [together]
 * @property {boolean} [split]
 * @property {string} [stderr]
 * @property {number} [code]
 * @property {string} [line]
 * @property {number[]} [floats]
 * @property {{ feature: number, variance: number, covariance?: number[][] }} [scores]
 * @property {number[][] | { seed: number, spread: number }} [points]
 */

/**
 * @typedef {object} Received
 * @property {number} pid the fake process that read it
 * @property {Record<string, unknown>} request the parsed request line
 */

/**
 * @typedef {object} FakeSidecar
 * @property {SidecarLaunch} launch what a client starts to run this fake
 * @property {(...steps: Step[]) => void} script adds steps, used in order
 * @property {() => Promise<number[]>} starts the pid of every fake process started, in order
 * @property {() => Promise<Received[]>} received every request read, in order
 * @property {(count: number) => Promise<void>} waitForReceived resolves once `count` requests
 *   have been read, checking once a turn of the event loop
 * @property {(count: number) => void} blockUntilWritten returns once the fakes have handed
 *   `count` writes to stdout's pipe, blocking the event loop meanwhile so the client can't read
 *   them yet; throws after 20 s, which only a fake that never writes reaches
 * @property {() => Promise<void>} remove deletes the temp folder
 */

const STEPS = "steps.json";
const STARTS = "starts";
const RECEIVED = "received.jsonl";
const WRITTEN = "written";
const PARENT = "--parent";

/**
 * @param {string} path
 * @returns {Promise<string[]>}
 */
const lines = async (path) =>
  (
    await readFile(path, "utf8").catch((/** @type {NodeJS.ErrnoException} */ error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    })
  )
    .split("\n")
    .filter((line) => line !== "");

/**
 * `underParent` runs the fake as the child of a parent process that passes its stdio through and
 * exits with it, the way `uv run` runs Python, so a test can check the client kills both.
 * @param {{ underParent?: boolean }} [options]
 * @returns {Promise<FakeSidecar>}
 */
export async function fakeSidecar({ underParent = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ambient-sidecar-"));
  /** @type {Step[]} */
  const steps = [];
  writeFileSync(join(dir, STEPS), "[]");
  return {
    launch: {
      command: process.execPath,
      args: [fileURLToPath(import.meta.url), dir, ...(underParent ? [PARENT] : [])],
      cwd: dir,
    },
    script(...more) {
      steps.push(...more);
      writeFileSync(join(dir, STEPS), JSON.stringify(steps));
    },
    starts: async () => (await lines(join(dir, STARTS))).map(Number),
    received: async () => (await lines(join(dir, RECEIVED))).map((line) => JSON.parse(line)),
    async waitForReceived(count) {
      while ((await lines(join(dir, RECEIVED))).length < count) await tick();
    },
    blockUntilWritten(count) {
      const deadline = performance.now() + 20_000;
      const path = join(dir, WRITTEN);
      while (readFileSync(path, { encoding: "utf8", flag: "a+" }).length < count) {
        if (performance.now() > deadline) throw new Error(`the fake wrote fewer than ${count}`);
      }
    },
    remove: () => rm(dir, { recursive: true }),
  };
}

/**
 * A `predict` answer that scores each item by one of its features. With `covariance`, which
 * must have a row per item, the variances are its diagonal.
 * @param {{ params: { items: string } }} request
 * @param {{ feature: number, variance: number, covariance?: number[][] }} by
 */
function scores({ params }, { feature, variance, covariance }) {
  /** @type {{ items: { features: (number | null)[] }[] }} */
  const { items } = JSON.parse(readFileSync(params.items, "utf8"));
  if (covariance) {
    return {
      mean: items.map((item) => item.features[feature] ?? 0),
      variance: covariance.map((row, i) => row[i]),
      covariance,
    };
  }
  return {
    mean: items.map((item) => item.features[feature] ?? 0),
    variance: items.map(() => variance),
    covariance: items.map(() => items.map(() => 0)),
  };
}

/**
 * An `optimizer_ask` answer's points: as given, or drawn near the run's start.
 * @param {{ params: { run: string, count: number } }} request
 * @param {number[][] | { seed: number, spread: number }} given
 * @returns {number[][]}
 */
function points({ params }, given) {
  if (Array.isArray(given)) return given;
  /** @type {{ start: number[] }} */
  const { start } = JSON.parse(readFileSync(join(params.run, "spec.json"), "utf8"));
  const draw = drawer(given.seed, ":fake-ask");
  return Array.from({ length: params.count }, (_, p) =>
    start.map((u, i) => {
      // Box–Muller, as the nudge steps; `1 - draw` is in (0, 1], so the log is finite.
      const z =
        Math.sqrt(-2 * Math.log(1 - draw(p, 2 * i))) * Math.cos(2 * Math.PI * draw(p, 2 * i + 1));
      return Math.min(1, Math.max(0, u + given.spread * z));
    }),
  );
}

/**
 * The fake's own loop, run by `launch`. The client runs one process at a time, so the step a
 * request takes is the count of requests every process received before it.
 * @param {string} dir
 */
function serve(dir) {
  appendFileSync(join(dir, STARTS), `${process.pid}\n`);
  /** @type {{ id: unknown, result: unknown }[]} */
  let held = [];
  // Writes to a pipe are asynchronous on macOS, so the exit waits for stderr to take the text.
  /** @param {string} text @param {number} code */
  const exit = (text, code) => process.stderr.write(text, () => process.exit(code));
  // One character in WRITTEN per write stdout's pipe has taken.
  /** @param {string} text */
  const send = (text) =>
    new Promise((resolve) =>
      process.stdout.write(text, () => {
        appendFileSync(join(dir, WRITTEN), ".");
        resolve(undefined);
      }),
    );
  /** @param {unknown} answer */
  const line = (answer) => `${JSON.stringify(answer)}\n`;
  /** @param {unknown} answer @param {boolean} [split] */
  const write = async (answer, split = false) => {
    const text = line(answer);
    if (!split) return send(text);
    const half = Math.floor(text.length / 2);
    await send(text.slice(0, half));
    await tick();
    return send(text.slice(half));
  };
  createInterface({ input: process.stdin }).on("line", (text) => {
    const request = JSON.parse(text);
    const index = readFileSync(join(dir, RECEIVED), { encoding: "utf8", flag: "a+" })
      .split("\n")
      .filter((entry) => entry !== "").length;
    appendFileSync(join(dir, RECEIVED), `${JSON.stringify({ pid: process.pid, request })}\n`);
    /** @type {Step[]} */
    const steps = JSON.parse(readFileSync(join(dir, STEPS), "utf8"));
    const step = steps[index];
    if (step === undefined) {
      exit(`the fake sidecar has no step for request ${index + 1}\n`, 70);
      return;
    }
    const { id } = request;
    if (step.floats) writeFileSync(request.params.out, new Float32Array(step.floats));
    if (step.scores)
      writeFileSync(request.params.out, JSON.stringify(scores(request, step.scores)));
    if (step.points)
      writeFileSync(request.params.out, JSON.stringify({ points: points(request, step.points) }));
    // A run has a state file once started, as the real sidecar writes; a fork of it copies it.
    if (request.method === "optimizer_start" && step.do === "answer")
      writeFileSync(join(request.params.spec, "..", "state.json"), "{}");
    const own = step.do === "answer" ? { id, result: step.result } : undefined;
    if (own && !(step.release && step.together)) void write(own, step.split);
    else if (step.do === "error") void write({ id, error: step.error });
    else if (step.do === "hold") held.push({ id, result: step.result });
    else if (step.do === "hang") setInterval(() => undefined, 60_000);
    else if (step.do === "garbage") void send(`${step.line}\n`);
    else if (step.do === "crash") exit(step.stderr ?? "", step.code ?? 1);
    if (step.release) {
      const answers = held.reverse();
      held = [];
      if (step.together) void send([own, ...answers].filter(Boolean).map(line).join(""));
      else for (const answer of answers) void write(answer);
    }
  });
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (dir === undefined) throw new Error("usage: fake-sidecar.js <folder> [--parent]");
  if (process.argv[3] === PARENT) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), dir], {
      stdio: "inherit",
    });
    child.on("exit", (code) => process.exit(code ?? 1));
  } else serve(dir);
}

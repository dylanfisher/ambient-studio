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

/**
 * What the fake does with one request. `answer` writes `{ id, result }`; `error` writes
 * `{ id, error }`; `hold` keeps `result` until a later step with `release`; `hang` never
 * answers and stays alive after stdin closes, as a Python stuck inside a method would; `crash` writes `stderr` and exits with `code`; `garbage` writes `line` as it is.
 * `release` answers every held request after this step's own answer, newest first.
 * @typedef {object} Step
 * @property {"answer" | "error" | "hold" | "hang" | "crash" | "garbage"} do
 * @property {unknown} [result]
 * @property {string} [error]
 * @property {boolean} [release]
 * @property {string} [stderr]
 * @property {number} [code]
 * @property {string} [line]
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
 * @property {() => Promise<void>} remove deletes the temp folder
 */

const STEPS = "steps.json";
const STARTS = "starts";
const RECEIVED = "received.jsonl";
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
    remove: () => rm(dir, { recursive: true }),
  };
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
  /** @param {unknown} answer */
  const write = (answer) => process.stdout.write(`${JSON.stringify(answer)}\n`);
  createInterface({ input: process.stdin }).on("line", (line) => {
    const request = JSON.parse(line);
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
    if (step.do === "answer") write({ id, result: step.result });
    else if (step.do === "error") write({ id, error: step.error });
    else if (step.do === "hold") held.push({ id, result: step.result });
    else if (step.do === "hang") setInterval(() => undefined, 60_000);
    else if (step.do === "garbage") process.stdout.write(`${step.line}\n`);
    else if (step.do === "crash") exit(step.stderr ?? "", step.code ?? 1);
    if (step.release) {
      for (const answer of held.reverse()) write(answer);
      held = [];
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

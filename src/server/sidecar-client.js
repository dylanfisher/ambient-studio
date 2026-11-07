// The only code that talks to the Python sidecar (decision 0041). It starts one long-lived child
// process on the first request, never before, and speaks line-delimited JSON over its stdio:
// `{ id, method, params }` out, `{ id, result }` or `{ id, error }` back, with the methods in
// sidecar-protocol.json, which the sidecar loads too. A timeout, a crash, a cancel or a line
// that breaks the protocol kills the process and fails every request in flight; the next
// request starts a fresh one. Nothing is retried.
/** @import { ChildProcessWithoutNullStreams } from "node:child_process" */
/** @import { Clock } from "./omlx-queue.js" */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import protocol from "./sidecar-protocol.json" with { type: "json" };

/**
 * How to start the sidecar: `command` with `args`, run in `cwd`.
 * @typedef {object} SidecarLaunch
 * @property {string} command
 * @property {string[]} args
 * @property {string} cwd
 */

/** The real sidecar, run through the lockfile's environment (0001). */
export const SIDECAR_LAUNCH = {
  command: "uv",
  args: ["run", "--frozen", "python", "-m", "ambient_sidecar"],
  cwd: fileURLToPath(new URL("../../sidecar/", import.meta.url)),
};

/**
 * @typedef {object} SidecarClient
 * @property {(method: string, params: Record<string, unknown>, options?: { signal?: AbortSignal })
 *   => Promise<Record<string, unknown>>} request sends one request, starting the process if none
 *   is running; rejects with a message naming the method
 * @property {() => Promise<void>} stop kills the process, failing what is in flight, and
 *   resolves once it has exited; every request after it is refused, so none starts a process
 *   nothing would kill
 */

/**
 * @typedef {object} Pending
 * @property {string} method
 * @property {(result: Record<string, unknown>) => void} resolve
 * @property {(error: Error) => void} reject
 * @property {() => void} settle clears the request's timer and abort listener
 */

/**
 * @typedef {object} Running
 * @property {ChildProcessWithoutNullStreams} child
 * @property {Map<number, Pending>} inFlight
 * @property {boolean} ended set once the process is being stopped or has exited
 * @property {string} lastStderr the last non-empty line of stderr, for a crash's message
 * @property {Promise<void>} closed resolves once the process and its stdio have closed
 * @property {() => void} markClosed resolves `closed`
 */

/** @typedef {Record<string, string>} Fields field name to type, as the protocol writes them */

/** @type {Record<string, (value: unknown) => boolean>} */
const TYPES = {
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  boolean: (value) => typeof value === "boolean",
};

/** @type {Record<string, { params: Fields, result: Fields }>} */
const METHODS = protocol.methods;

/**
 * The first way `value` breaks `fields`, or undefined when it matches: an object with exactly
 * those fields, each of its type.
 * @param {Fields} fields
 * @param {unknown} value
 * @param {"params" | "result"} what
 * @returns {string | undefined}
 */
function mismatch(fields, value, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return `${what} must be an object, got ${JSON.stringify(value)}`;
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(fields, key)) return `${what} has ${key}, which the protocol doesn't name`;
  }
  for (const [key, type] of Object.entries(fields)) {
    const check = TYPES[type];
    if (check === undefined) throw new Error(`the sidecar protocol has no type ${type}`);
    if (!Object.hasOwn(record, key)) return `${what} is missing ${key}`;
    if (!check(record[key])) {
      return `${what}.${key} must be a ${type}, got ${JSON.stringify(record[key])}`;
    }
  }
  return undefined;
}

/** @param {number} ms */
const seconds = (ms) => `${ms / 1000} s`;

/**
 * @param {object} options
 * @param {SidecarLaunch} options.launch the server passes `SIDECAR_LAUNCH`, tests the fake's
 * @param {number} options.timeoutMs each request's limit, from writing it to its answer
 * @param {Clock} options.clock
 * @param {(line: string) => void} options.log gets each line of the sidecar's stderr
 * @returns {SidecarClient}
 */
export function createSidecarClient({ launch, timeoutMs, clock, log }) {
  let nextId = 1;
  /** @type {Running | undefined} */
  let running;
  /**
   * Every process started that hasn't closed, ended ones included, for `stop` to wait on.
   * @type {Set<Running>}
   */
  const unclosed = new Set();
  let stopped = false;

  /**
   * Kills the process group and fails every request in flight with `why(method)`. The group,
   * because `uv run` starts Python as its own child rather than replacing itself.
   * @param {Running} proc
   * @param {(method: string) => string} why
   */
  function end(proc, why) {
    if (proc.ended) return;
    proc.ended = true;
    if (running === proc) running = undefined;
    /** @type {unknown} */
    let killFailed;
    const { pid } = proc.child;
    if (pid !== undefined) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        // The group is already gone when the process exited by itself.
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH") killFailed = error;
      }
    }
    for (const pending of proc.inFlight.values()) {
      pending.settle();
      pending.reject(new Error(why(pending.method)));
    }
    proc.inFlight.clear();
    if (killFailed !== undefined) {
      // No close may follow a kill that failed, so `stop` would wait on it forever.
      proc.markClosed();
      throw killFailed;
    }
  }

  /**
   * @param {Running} proc
   * @param {string} line
   */
  function answer(proc, line) {
    /** @param {string} problem */
    const broken = (problem) =>
      end(proc, (method) => `sidecar request ${method} failed: ${problem}`);
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      broken(`the sidecar wrote a line that isn't JSON: ${JSON.stringify(line.slice(0, 200))}`);
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      broken(`the sidecar wrote a line that isn't a JSON object: ${line.slice(0, 200)}`);
      return;
    }
    const message = /** @type {{ id?: unknown, result?: unknown, error?: unknown }} */ (parsed);
    const pending = typeof message.id === "number" ? proc.inFlight.get(message.id) : undefined;
    if (pending === undefined) {
      const error = typeof message.error === "string" ? ` with ${message.error}` : "";
      broken(
        `the sidecar answered id ${JSON.stringify(message?.id)}${error}, which no request in flight has`,
      );
      return;
    }
    proc.inFlight.delete(/** @type {number} */ (message.id));
    pending.settle();
    const failed = `sidecar request ${pending.method} failed`;
    if ("error" in message) {
      pending.reject(new Error(`${failed}: ${String(message.error)}`));
      return;
    }
    const wrong = mismatch(
      /** @type {{ result: Fields }} */ (METHODS[pending.method]).result,
      message.result,
      "result",
    );
    if (wrong) pending.reject(new Error(`${failed}: ${wrong}`));
    else pending.resolve(/** @type {Record<string, unknown>} */ (message.result));
  }

  /** @returns {Running} */
  function start() {
    // Its own process group, so `end` can kill Python along with uv.
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, detached: true });
    /** @type {() => void} */
    let resolveClosed = () => undefined;
    /** @type {Running} */
    const proc = {
      child,
      inFlight: new Map(),
      ended: false,
      lastStderr: "",
      closed: new Promise((resolve) => {
        resolveClosed = resolve;
      }),
      markClosed: () => {
        unclosed.delete(proc);
        resolveClosed();
      },
    };
    unclosed.add(proc);
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (/** @type {string} */ chunk) => {
      stdout += chunk;
      let newline = stdout.indexOf("\n");
      while (newline !== -1 && !proc.ended) {
        answer(proc, stdout.slice(0, newline));
        stdout = stdout.slice(newline + 1);
        newline = stdout.indexOf("\n");
      }
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (/** @type {string} */ chunk) => {
      stderr += chunk;
      const lines = stderr.split("\n");
      stderr = lines.pop() ?? "";
      for (const line of lines) {
        log(`sidecar: ${line}`);
        if (line.trim() !== "") proc.lastStderr = line.trim();
      }
    });
    // A write after the process died fails with EPIPE; its exit, reported on close, says why.
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      // With no pid the process never started, so no close will follow.
      if (child.pid !== undefined) throw error;
      end(
        proc,
        (method) => `sidecar request ${method} failed: can't start the sidecar: ${error.message}`,
      );
      proc.markClosed();
    });
    child.on("close", (code, signal) => {
      if (stderr.trim() !== "") {
        log(`sidecar: ${stderr}`);
        proc.lastStderr = stderr.trim();
      }
      const how = code === null ? `was killed by ${signal}` : `exited with code ${code}`;
      const last = proc.lastStderr === "" ? "" : `: ${proc.lastStderr}`;
      if (!proc.ended && proc.inFlight.size === 0) log(`the sidecar ${how} while idle${last}`);
      end(proc, (method) => `sidecar request ${method} failed: the sidecar ${how}${last}`);
      proc.markClosed();
    });
    return proc;
  }

  return {
    request(method, params, { signal } = {}) {
      const spec = METHODS[method];
      if (!Object.hasOwn(METHODS, method) || spec === undefined) {
        return Promise.reject(
          new Error(`${method} is not a sidecar method (src/server/sidecar-protocol.json)`),
        );
      }
      const wrong = mismatch(spec.params, params, "params");
      if (wrong) return Promise.reject(new Error(`sidecar request ${method}: ${wrong}`));
      const cancelled = () => new Error(`sidecar request ${method} was cancelled`);
      if (signal?.aborted) return Promise.reject(cancelled());
      if (stopped) {
        return Promise.reject(
          new Error(`sidecar request ${method} refused: the server is stopping`),
        );
      }
      running ??= start();
      const proc = running;
      const id = nextId++;
      return new Promise((resolve, reject) => {
        /**
         * Fails this request with `error`, then stops the process, failing the others: Python
         * runs one request at a time and can't be interrupted inside one, so stopping the
         * process is the only way to stop the work.
         * @param {Error} error
         * @param {string} because such as `because ping timed out`
         */
        const stopFor = (error, because) => {
          proc.inFlight.delete(id);
          settle();
          reject(error);
          end(
            proc,
            (other) => `sidecar request ${other} failed: the sidecar was stopped ${because}`,
          );
        };
        const timer = clock.setTimeout(() => {
          const limit = seconds(timeoutMs);
          const error = new Error(
            `sidecar request ${method} timed out after ${limit}, so the sidecar was stopped`,
          );
          stopFor(error, `because ${method} timed out`);
        }, timeoutMs);
        const onAbort = () => stopFor(cancelled(), `to cancel ${method}`);
        const settle = () => {
          clock.clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        proc.inFlight.set(id, { method, resolve, reject, settle });
        proc.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    },
    async stop() {
      stopped = true;
      if (running) {
        end(running, (method) => `sidecar request ${method} failed: the server is stopping`);
      }
      await Promise.all([...unclosed].map((proc) => proc.closed));
    },
  };
}

// The in-process job runner (decision 0026). Jobs run in two lanes (0092), each one job at a
// time in the order added: the main lane runs every job but a words job, so a generation's omlx
// requests never overlap a render, since normalize and feature extraction block the event loop
// and would inflate the queue's time-to-first-token reading. The words lane runs only words
// jobs, beside the main one, so the owner's words are read while a search or a render runs; both
// lanes send through the one omlx queue, which keeps one request in flight. A job starts only
// when a caller adds it; there is no timer and no start-up hook.
import { jobLane } from "../domain/job-kind.js";

/** @typedef {"queued" | "running" | "done" | "failed" | "cancelled"} JobState */

/**
 * How far a job has got. `done` of `total` drives a progress bar; `step` is a sentence for the
 * owner saying what the job is doing now, null between steps and once the job has finished.
 * @typedef {{ done: number, total: number, step: string | null }} JobProgress
 */

/**
 * What the UI polls. `result` is the job's return value once done; `error` its message once
 * failed.
 * @typedef {object} JobStatus
 * @property {number} id
 * @property {string} kind
 * @property {JobState} state
 * @property {JobProgress | null} progress null until the job first reports
 * @property {unknown} result
 * @property {string | null} error
 * @property {number} addedAt
 * @property {number | null} startedAt
 * @property {number | null} finishedAt
 */

/**
 * What a job gets. It checks `signal` before each step it can stop at, and passes it on to the
 * omlx queue's requests.
 * @typedef {object} JobContext
 * @property {AbortSignal} signal aborted when the job is cancelled
 * @property {(done: number, total: number, step: string | null) => void} progress
 */

/**
 * @typedef {object} JobRunner
 * @property {(kind: string, run: (job: JobContext) => Promise<unknown>) => JobStatus} add queues
 *   a job in its kind's lane, and starts it at once when none is running there
 * @property {(id: number) => JobStatus} get the job's status with its result
 * @property {() => Omit<JobStatus, "result">[]} list every job since the runner was made, oldest
 *   first, without results, so a list doesn't copy every finished job's output
 * @property {(id: number) => JobStatus} cancel drops a queued job, or aborts a running one's
 *   signal; a finished job is left as it is
 * @property {(id: number) => Promise<void>} settled resolves once the job has finished, however
 * @property {() => Promise<void>} idle resolves once no job is queued or running in either lane
 */

/**
 * @typedef {object} Job
 * @property {JobStatus} status
 * @property {(job: JobContext) => Promise<unknown>} run
 * @property {AbortController} controller
 * @property {Promise<void>} finished
 * @property {() => void} finish
 * @property {Lane} lane
 */

/** @typedef {{ waiting: Job[], running: Job | undefined }} Lane */

/**
 * @param {{ now: () => number }} options `now` gives milliseconds since the Unix epoch
 * @returns {JobRunner}
 */
export function createJobRunner({ now }) {
  /** @type {Map<number, Job>} */
  const jobs = new Map();
  /** @type {Map<string, Lane>} */
  const lanes = new Map();
  let nextId = 1;

  /** @param {string} kind */
  function laneFor(kind) {
    const name = jobLane(kind);
    let lane = lanes.get(name);
    if (!lane) {
      lane = { waiting: [], running: undefined };
      lanes.set(name, lane);
    }
    return lane;
  }

  /** @param {number} id */
  function job(id) {
    const found = jobs.get(id);
    if (!found) throw new Error(`there is no job ${id}`);
    return found;
  }

  /** @param {Job} done @param {JobState} state */
  function finish(done, state) {
    done.status.state = state;
    done.status.finishedAt = now();
    // A finished job is doing nothing, whatever step it last reported.
    if (done.status.progress) done.status.progress.step = null;
    done.finish();
  }

  /** @param {Lane} lane */
  function next(lane) {
    lane.running = lane.waiting.shift();
    if (lane.running) start(lane.running);
  }

  /** @param {Job} current */
  function start(current) {
    const { status, controller } = current;
    status.state = "running";
    status.startedAt = now();
    const { signal } = controller;
    /** @type {JobContext} */
    const context = {
      signal,
      progress: (done, total, step) => {
        status.progress = { done, total, step };
      },
    };
    // Called through an async function, so a job that throws before its first await still
    // fails as a status rather than throwing out of `add`.
    (async () => current.run(context))().then(
      (result) => {
        status.result = result;
        finish(current, "done");
        next(current.lane);
      },
      (error) => {
        if (signal.aborted) {
          finish(current, "cancelled");
        } else {
          status.error = error instanceof Error ? error.message : String(error);
          finish(current, "failed");
        }
        next(current.lane);
      },
    );
  }

  return {
    add(kind, run) {
      /** @type {() => void} */
      let markFinished = () => undefined;
      /** @type {Promise<void>} */
      const finished = new Promise((resolve) => {
        markFinished = () => resolve(undefined);
      });
      /** @type {Job} */
      const added = {
        status: {
          id: nextId++,
          kind,
          state: "queued",
          progress: null,
          result: null,
          error: null,
          addedAt: now(),
          startedAt: null,
          finishedAt: null,
        },
        run,
        controller: new AbortController(),
        finished,
        finish: markFinished,
        lane: laneFor(kind),
      };
      jobs.set(added.status.id, added);
      added.lane.waiting.push(added);
      if (!added.lane.running) next(added.lane);
      return structuredClone(added.status);
    },
    get: (id) => structuredClone(job(id).status),
    list: () => [...jobs.values()].map(({ status: { result, ...rest } }) => structuredClone(rest)),
    cancel(id) {
      const found = job(id);
      const { waiting, running } = found.lane;
      const at = waiting.indexOf(found);
      if (at !== -1) {
        waiting.splice(at, 1);
        finish(found, "cancelled");
      } else if (found === running) {
        found.controller.abort(new Error(`job ${id} was cancelled`));
      }
      return structuredClone(found.status);
    },
    settled: (id) => job(id).finished,
    async idle() {
      for (;;) {
        const busy = [...lanes.values()].find((lane) => lane.running);
        if (!busy?.running) return;
        await busy.running.finished;
      }
    },
  };
}

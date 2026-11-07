// The job runner (decision 0026): one job at a time, in the order added, with status to poll and
// cancellation. Jobs here are promises the test settles by hand, so nothing waits on real time.
import { expect, test } from "vitest";
import { createJobRunner } from "../../src/server/job-runner.js";

/** A clock that counts, so stored times are the same on every run. */
function countingClock() {
  let ticks = 0;
  return () => 1000 * ticks++;
}

/**
 * A promise and the functions that settle it.
 * @template T
 */
function deferred() {
  /** @type {(value: T) => void} */
  let resolve = () => undefined;
  /** @type {(error: Error) => void} */
  let reject = () => undefined;
  /** @type {Promise<T>} */
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("two jobs added at once run one at a time, in order", async () => {
  const runner = createJobRunner({ now: countingClock() });
  /** @type {string[]} */
  const events = [];
  const first = deferred();
  const second = deferred();
  const a = runner.add("render", async () => {
    events.push("a start");
    await first.promise;
    events.push("a end");
    return "a done";
  });
  const b = runner.add("render", async () => {
    events.push("b start");
    await second.promise;
    events.push("b end");
    return "b done";
  });
  expect(runner.get(a.id).state).toBe("running");
  expect(runner.get(b.id).state).toBe("queued");

  await Promise.resolve();
  expect(events).toEqual(["a start"]);
  first.resolve(undefined);
  await runner.settled(a.id);
  expect(runner.get(b.id).state).toBe("running");
  second.resolve(undefined);
  await runner.idle();

  expect(events).toEqual(["a start", "a end", "b start", "b end"]);
  expect(runner.get(a.id)).toMatchObject({ state: "done", result: "a done", error: null });
  expect(runner.get(b.id)).toMatchObject({ state: "done", result: "b done", error: null });
  expect(runner.list().map((job) => job.id)).toEqual([a.id, b.id]);
});

test("list gives each job's status without its result, which get gives", async () => {
  const runner = createJobRunner({ now: countingClock() });
  const job = runner.add("render", async () => ({ renders: [1, 2, 3] }));
  await runner.idle();
  const [listed] = runner.list();
  expect(listed).toMatchObject({ id: job.id, state: "done" });
  expect(listed).not.toHaveProperty("result");
  expect(runner.get(job.id).result).toEqual({ renders: [1, 2, 3] });
});

test("a job reports its progress, and a failed job doesn't stop the next", async () => {
  const runner = createJobRunner({ now: countingClock() });
  const hold = deferred();
  const failing = runner.add("render", async ({ progress }) => {
    progress(1, 3, "Rendering excerpt 2 of 3");
    await hold.promise;
    throw new Error("the render failed");
  });
  const next = runner.add("render", async () => "ran");
  await Promise.resolve();
  expect(runner.get(failing.id).progress).toEqual({
    done: 1,
    total: 3,
    step: "Rendering excerpt 2 of 3",
  });

  hold.resolve(undefined);
  await runner.idle();
  expect(runner.get(failing.id)).toMatchObject({ state: "failed", error: "the render failed" });
  expect(runner.get(next.id)).toMatchObject({ state: "done", result: "ran" });
});

test("a finished job keeps its count and drops its step, which said what it was doing", async () => {
  const runner = createJobRunner({ now: countingClock() });
  const job = runner.add("render", async ({ progress }) => {
    progress(2, 2, "Rendering excerpt 2 of 2");
  });
  await runner.idle();
  expect(runner.get(job.id).progress).toEqual({ done: 2, total: 2, step: null });
});

test("a cancelled job stops at its next check, and a queued one never starts", async () => {
  const runner = createJobRunner({ now: countingClock() });
  const step = deferred();
  /** @type {number[]} */
  const rendered = [];
  const running = runner.add("render", async ({ signal }) => {
    for (const i of [1, 2, 3]) {
      signal.throwIfAborted();
      rendered.push(i);
      await step.promise;
    }
  });
  let queuedRan = false;
  const queued = runner.add("render", async () => {
    queuedRan = true;
  });
  await Promise.resolve();
  expect(rendered).toEqual([1]);

  expect(runner.cancel(queued.id).state).toBe("cancelled");
  runner.cancel(running.id);
  step.resolve(undefined);
  await runner.idle();

  expect(rendered).toEqual([1]);
  expect(queuedRan).toBe(false);
  expect(runner.get(running.id).state).toBe("cancelled");
  expect(runner.get(queued.id)).toMatchObject({ state: "cancelled", startedAt: null });
});

test("status times come from the injected clock, and a status is a copy", async () => {
  const runner = createJobRunner({ now: countingClock() });
  const job = runner.add("render", async () => "x");
  await runner.idle();
  const status = runner.get(job.id);
  expect(status).toMatchObject({ kind: "render", addedAt: 0, startedAt: 1000, finishedAt: 2000 });
  status.state = "failed";
  expect(runner.get(job.id).state).toBe("done");
});

test("cancelling a finished job changes nothing, and an unknown id throws", async () => {
  const runner = createJobRunner({ now: countingClock() });
  const job = runner.add("render", async () => "x");
  await runner.idle();
  expect(runner.cancel(job.id).state).toBe("done");
  expect(() => runner.get(99)).toThrow(/no job 99/);
  expect(() => runner.cancel(99)).toThrow(/no job 99/);
});

test("nothing runs until a job is added", async () => {
  let ran = false;
  const runner = createJobRunner({ now: countingClock() });
  await runner.idle();
  expect(runner.list()).toEqual([]);
  runner.add("render", async () => {
    ran = true;
  });
  await runner.idle();
  expect(ran).toBe(true);
});

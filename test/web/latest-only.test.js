// The map's reload (decision 0057): one run at a time, and one more after the last call.
import { expect, test } from "vitest";
import { latestOnly } from "../../src/web/latest-only.js";

test("calls while a run is in flight give one more run after it, never two at once", async () => {
  let inFlight = 0;
  let most = 0;
  let runs = 0;
  /** @type {(() => void)[]} */
  const finish = [];
  const reload = latestOnly(async () => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    runs += 1;
    await new Promise((resolve) => finish.push(() => resolve(undefined)));
    inFlight -= 1;
  });
  const calls = [reload(), reload(), reload()];
  expect(runs).toBe(1);
  finish.shift()?.();
  // The second run starts once the first has ended, with nothing else to wait on.
  await new Promise((resolve) => setImmediate(resolve));
  expect(runs).toBe(2);
  finish.shift()?.();
  await Promise.all(calls);
  expect(runs).toBe(2);
  expect(most).toBe(1);
  const later = reload();
  expect(runs).toBe(3);
  finish.shift()?.();
  await later;
});

test("a failed run rejects its callers and lets the next call run", async () => {
  let fail = true;
  const reload = latestOnly(async () => {
    if (fail) throw new Error("the server is down");
  });
  await expect(reload()).rejects.toThrow("the server is down");
  fail = false;
  await expect(reload()).resolves.toBeUndefined();
});

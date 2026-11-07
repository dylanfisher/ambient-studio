import { expect, test } from "vitest";
import { oneAtATime } from "../../src/web/one-at-a-time.js";

/** A promise the test settles by hand. */
function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve = () => {};
  /** @type {(error: unknown) => void} */
  let reject = () => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("a second call while the first is pending does nothing", async () => {
  const pending = deferred();
  let calls = 0;
  const action = oneAtATime(() => {
    calls += 1;
    return pending.promise;
  });
  const first = action();
  const second = action();
  expect(calls).toBe(1);
  await second;
  pending.resolve();
  await first;
  expect(calls).toBe(1);
});

test("once the first has finished, the next call runs", async () => {
  let calls = 0;
  const action = oneAtATime(async () => {
    calls += 1;
  });
  await action();
  await action();
  expect(calls).toBe(2);
});

test("a failure reaches the caller and frees the action", async () => {
  const pending = deferred();
  let calls = 0;
  const action = oneAtATime(() => {
    calls += 1;
    return calls === 1 ? pending.promise : Promise.resolve();
  });
  const first = action();
  pending.reject(new Error("refused"));
  await expect(first).rejects.toThrow("refused");
  await action();
  expect(calls).toBe(2);
});

test("an action that throws before returning frees itself", async () => {
  let calls = 0;
  const action = oneAtATime(() => {
    calls += 1;
    throw new Error("no candidate");
  });
  await expect(action()).rejects.toThrow("no candidate");
  await expect(action()).rejects.toThrow("no candidate");
  expect(calls).toBe(2);
});

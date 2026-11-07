// The sidecar client (decision 0041) against the fake sidecar: answers matched by id, a timeout,
// a crash, a cancel or a line that isn't JSON each ending the process and failing the request
// with its method named, and the next request starting a fresh process.
import { setImmediate as tick } from "node:timers/promises";
import { afterEach, expect, test } from "vitest";
import { createSidecarClient } from "../../src/server/sidecar-client.js";
import { fakeClock } from "../support/fake-clock.js";
import { fakeSidecar } from "../support/fake-sidecar.js";

const TIMEOUT_MS = 120_000;
const VERSION = { package: "0.0.0", python: "3.12.15" };

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** @param {Parameters<typeof fakeSidecar>[0]} [options] */
async function setup(options) {
  const fake = await fakeSidecar(options);
  const clock = fakeClock();
  /** @type {string[]} */
  const logged = [];
  const client = createSidecarClient({
    launch: fake.launch,
    timeoutMs: TIMEOUT_MS,
    clock,
    log: (line) => logged.push(line),
  });
  cleanups.push(fake.remove, client.stop);
  return { fake, clock, client, logged };
}

/**
 * Resolves once no process has `pid`. The client has sent SIGKILL by the time a request fails,
 * so this waits on the kernel reaping it, not on a timer.
 * @param {number} pid
 */
async function gone(pid) {
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH") return;
      throw error;
    }
    await tick();
  }
}

/**
 * The pid of the one fake process started so far.
 * @param {Awaited<ReturnType<typeof fakeSidecar>>} fake
 */
async function onlyPid(fake) {
  const starts = await fake.starts();
  expect(starts).toHaveLength(1);
  return /** @type {number} */ (starts[0]);
}

test("nothing starts until the first request, and an answer arrives under its id", async () => {
  const { fake, client } = await setup();
  expect(await fake.starts()).toEqual([]);
  fake.script({ do: "answer", result: {} }, { do: "answer", result: VERSION });
  expect(await client.request("ping", {})).toEqual({});
  expect(await client.request("version", {})).toEqual(VERSION);
  const received = await fake.received();
  expect(received.map(({ request }) => request)).toEqual([
    { id: 1, method: "ping", params: {} },
    { id: 2, method: "version", params: {} },
  ]);
  expect(new Set(received.map(({ pid }) => pid)).size).toBe(1);
});

test("two requests in flight are answered out of order", async () => {
  const { fake, client } = await setup();
  fake.script({ do: "hold", result: VERSION }, { do: "answer", result: {}, release: true });
  /** @type {string[]} */
  const order = [];
  const version = client.request("version", {}).then((result) => {
    order.push("version");
    return result;
  });
  const ping = client.request("ping", {}).then((result) => {
    order.push("ping");
    return result;
  });
  expect(await Promise.all([version, ping])).toEqual([VERSION, {}]);
  expect(order).toEqual(["ping", "version"]);
});

test("an error answer fails only its request and the process goes on", async () => {
  const { fake, client } = await setup();
  fake.script({ do: "error", error: "no checkpoint" }, { do: "answer", result: {} });
  await expect(client.request("ping", {})).rejects.toThrow(
    "sidecar request ping failed: no checkpoint",
  );
  expect(await client.request("ping", {})).toEqual({});
  await onlyPid(fake);
});

test("a timeout kills the process and fails the request naming the method", async () => {
  const { fake, client, clock } = await setup();
  fake.script({ do: "hang" }, { do: "answer", result: {} });
  const ping = client.request("ping", {});
  const failed = expect(ping).rejects.toThrow(
    "sidecar request ping timed out after 120 s, so the sidecar was stopped",
  );
  await fake.waitForReceived(1);
  await clock.waitForTimer(TIMEOUT_MS);
  clock.advance(TIMEOUT_MS);
  await failed;
  await gone(await onlyPid(fake));
  expect(await client.request("ping", {})).toEqual({});
  expect(await fake.starts()).toHaveLength(2);
});

test("a timeout kills the child a launcher started too, as uv run starts Python", async () => {
  const { fake, client, clock } = await setup({ underParent: true });
  fake.script({ do: "hang" });
  const ping = client.request("ping", {});
  const failed = expect(ping).rejects.toThrow(/^sidecar request ping timed out/);
  await fake.waitForReceived(1);
  await clock.waitForTimer(TIMEOUT_MS);
  clock.advance(TIMEOUT_MS);
  await failed;
  await gone(await onlyPid(fake));
});

test("a crash fails the request in flight, and the next request starts a new process", async () => {
  const { fake, client, clock } = await setup();
  fake.script(
    { do: "crash", stderr: "Traceback: something broke\n", code: 3 },
    { do: "answer", result: VERSION },
  );
  await expect(client.request("ping", {})).rejects.toThrow(
    /^sidecar request ping failed: the sidecar exited with code 3: Traceback: something broke$/,
  );
  expect(await client.request("version", {})).toEqual(VERSION);
  const starts = await fake.starts();
  expect(starts).toHaveLength(2);
  expect(starts[0]).not.toBe(starts[1]);
  // The crashed request's timer was cleared with it.
  expect(await clock.waitFor((pending) => pending.length === 0)).toBeUndefined();
});

test("every request in flight fails when the process ends, each naming its method", async () => {
  const { fake, client } = await setup();
  fake.script({ do: "hold", result: VERSION }, { do: "crash", code: 1 });
  const version = client.request("version", {});
  const ping = client.request("ping", {});
  await expect(version).rejects.toThrow(/^sidecar request version failed: the sidecar exited/);
  await expect(ping).rejects.toThrow(/^sidecar request ping failed: the sidecar exited/);
});

test("a launch command that isn't there fails the request, and stop still resolves", async () => {
  const { fake } = await setup();
  const client = createSidecarClient({
    launch: { ...fake.launch, command: "ambient-sidecar-no-such-command" },
    timeoutMs: TIMEOUT_MS,
    clock: fakeClock(),
    log: () => undefined,
  });
  await expect(client.request("ping", {})).rejects.toThrow(
    /^sidecar request ping failed: can't start the sidecar: spawn ambient-sidecar-no-such-command ENOENT$/,
  );
  await client.stop();
});

test("cancel ends the request and the process", async () => {
  const { fake, client, clock } = await setup();
  fake.script({ do: "hang" }, { do: "answer", result: {} });
  const controller = new AbortController();
  const ping = client.request("ping", {}, { signal: controller.signal });
  await fake.waitForReceived(1);
  controller.abort();
  await expect(ping).rejects.toThrow("sidecar request ping was cancelled");
  await gone(await onlyPid(fake));
  expect(await clock.waitFor((pending) => pending.length === 0)).toBeUndefined();
  expect(await client.request("ping", {})).toEqual({});
});

test("a signal aborted before the request starts nothing", async () => {
  const { fake, client } = await setup();
  await expect(client.request("ping", {}, { signal: AbortSignal.abort() })).rejects.toThrow(
    "sidecar request ping was cancelled",
  );
  expect(await fake.starts()).toEqual([]);
});

test("a line that isn't JSON fails the request and ends the process", async () => {
  const { fake, client } = await setup();
  fake.script({ do: "garbage", line: "Loading checkpoint..." });
  await expect(client.request("ping", {})).rejects.toThrow(
    'sidecar request ping failed: the sidecar wrote a line that isn\'t JSON: "Loading checkpoint..."',
  );
  await gone(await onlyPid(fake));
});

test("an answer to no request in flight ends the process", async () => {
  const { fake, client } = await setup();
  fake.script({ do: "garbage", line: JSON.stringify({ id: 99, result: {} }) });
  await expect(client.request("ping", {})).rejects.toThrow(
    "sidecar request ping failed: the sidecar answered id 99, which no request in flight has",
  );
  await gone(await onlyPid(fake));
});

test("a result that doesn't match the protocol fails its request", async () => {
  const { fake, client } = await setup();
  fake.script({ do: "answer", result: { package: "0.0.0", python: 3 } });
  await expect(client.request("version", {})).rejects.toThrow(
    "sidecar request version failed: result.python must be a string, got 3",
  );
});

test("an unknown method or wrong params are refused before any process starts", async () => {
  const { fake, client } = await setup();
  await expect(client.request("embed", {})).rejects.toThrow(
    "embed is not a sidecar method (src/server/sidecar-protocol.json)",
  );
  await expect(client.request("ping", { n: 1 })).rejects.toThrow(
    "sidecar request ping: params has n, which the protocol doesn't name",
  );
  expect(await fake.starts()).toEqual([]);
});

test("stop ends the process and fails what is in flight", async () => {
  const { fake, client } = await setup();
  fake.script({ do: "hang" });
  const ping = client.request("ping", {});
  const failed = expect(ping).rejects.toThrow(
    "sidecar request ping failed: the server is stopping",
  );
  await fake.waitForReceived(1);
  await client.stop();
  await failed;
  await gone(await onlyPid(fake));
});

test("the sidecar's stderr goes to the log a line at a time", async () => {
  const { fake, client, logged } = await setup();
  fake.script({ do: "crash", stderr: "first\nsecond\n", code: 2 });
  await expect(client.request("ping", {})).rejects.toThrow(/exited with code 2/);
  expect(logged).toEqual(["sidecar: first", "sidecar: second"]);
});

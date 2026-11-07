// The server's App (decision 0027) without its HTTP server, over a temp store and the fake omlx
// on a fake clock, so a test can run a job function with a signal it controls. Its config points
// at the fake; no test reaches the real omlx.
/** @import { App } from "../../src/server/routing.js" */
/** @import { FakeClock } from "./fake-clock.js" */
/** @import { FakeOmlx } from "./fake-omlx.js" */
import { loadConfig } from "../../src/config/config.js";
import { createJobRunner } from "../../src/server/job-runner.js";
import { createOmlxQueue } from "../../src/server/omlx-queue.js";
import { fakeClock } from "./fake-clock.js";
import { fakeOmlx } from "./fake-omlx.js";
import { tempStore } from "./temp-store.js";

/**
 * @typedef {object} TestApp
 * @property {App} app
 * @property {FakeOmlx} omlx
 * @property {FakeClock} clock
 * @property {() => Promise<void>} remove cancels the queue, closes the fake and deletes the root
 */

/** @returns {Promise<TestApp>} */
export async function testApp() {
  const clock = fakeClock();
  const omlx = await fakeOmlx(clock);
  const made = await tempStore();
  const loaded = loadConfig(made.configPath);
  const config = { ...loaded, omlx: { ...loaded.omlx, baseUrl: omlx.baseUrl } };
  const queue = createOmlxQueue({
    omlx: config.omlx,
    queue: config.queue,
    clock,
    jitter: () => 0.5,
    onRetry: (event) => {
      throw new Error(`the fake omlx was never busy, but the queue retried: ${event.reason}`);
    },
  });
  /** @type {App} */
  const app = {
    config,
    paths: made.paths,
    store: made.store,
    log: () => undefined,
    queue,
    jobs: createJobRunner({ now: clock.now }),
    random: () => 0.25,
    sessionJobs: new Map(),
  };
  return {
    app,
    omlx,
    clock,
    async remove() {
      queue.cancel();
      await omlx.close();
      await made.remove();
    },
  };
}

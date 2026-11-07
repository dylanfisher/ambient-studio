// The server's App (decision 0027) without its HTTP server, over a temp store, the fake omlx and
// the fake sidecar on a fake clock, so a test can run a job function with a signal it controls.
// Its config points at the fakes; no test reaches the real omlx or the real sidecar.
/** @import { App } from "../../src/server/routing.js" */
/** @import { FakeClock } from "./fake-clock.js" */
/** @import { FakeOmlx } from "./fake-omlx.js" */
/** @import { FakeSidecar } from "./fake-sidecar.js" */
import { loadConfig } from "../../src/config/config.js";
import { createJobRunner } from "../../src/server/job-runner.js";
import { createOmlxQueue } from "../../src/server/omlx-queue.js";
import { createSidecarClient } from "../../src/server/sidecar-client.js";
import { fakeClock } from "./fake-clock.js";
import { fakeOmlx } from "./fake-omlx.js";
import { fakeSidecar } from "./fake-sidecar.js";
import { tempStore } from "./temp-store.js";

/**
 * @typedef {object} TestApp
 * @property {App} app
 * @property {FakeOmlx} omlx
 * @property {FakeSidecar} sidecar the fake `app.sidecar` starts; script it before a request
 * @property {FakeClock} clock
 * @property {() => Promise<void>} remove cancels the queue, stops the sidecar client, closes the
 *   fakes and deletes the root
 */

/** @returns {Promise<TestApp>} */
export async function testApp() {
  const clock = fakeClock();
  const omlx = await fakeOmlx(clock);
  const sidecar = await fakeSidecar();
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
    sidecar: createSidecarClient({
      launch: sidecar.launch,
      timeoutMs: config.sidecar.requestTimeoutMs,
      clock,
      log: () => undefined,
    }),
    random: () => 0.25,
    sessionJobs: new Map(),
  };
  return {
    app,
    omlx,
    sidecar,
    clock,
    async remove() {
      queue.cancel();
      await app.sidecar.stop();
      await sidecar.remove();
      await omlx.close();
      await made.remove();
    },
  };
}

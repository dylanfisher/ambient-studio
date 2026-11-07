// The real server against the fake omlx on a fake clock (decisions 0022, 0027), for tests that
// drive a session through the HTTP routes. No test reaches the real omlx.
/** @import { FakeClock } from "./fake-clock.js" */
/** @import { FakeOmlx } from "./fake-omlx.js" */
/** @import { Reply, TestServer } from "./http-client.js" */
import { expect } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { fakeClock } from "./fake-clock.js";
import { fakeOmlx } from "./fake-omlx.js";
import { startTestServer } from "./http-client.js";

/** Two genomes valid under `VIBE`'s constraints that render quickly: the drone and a variant. */
export const GENOMES = Object.freeze([droneGenome, { ...droneGenome, reverbDecay: 4 }]);

export const VIBE = Object.freeze({
  name: "cold drone",
  brief: "slow and cold, in D dorian",
  constraints: { loudness: -16 },
  softTargets: {},
});

/**
 * An answer as the model gives it, sent by the fake omlx as one token.
 * @param {unknown} genome
 */
const answer = (genome) => ({
  tokens: [JSON.stringify({ intent: "a slow cold drone", genome })],
});

/**
 * @typedef {object} Studio
 * @property {TestServer} server
 * @property {FakeOmlx} omlx
 * @property {FakeClock} clock
 * @property {<T>(work: Promise<T>) => Promise<T>} drive runs `work` to its end, moving the fake
 *   clock past each gap the omlx queue waits between requests
 * @property {(method: string, path: string, value?: unknown) => Promise<any>} ok sends the
 *   request, expects a 200, and returns the parsed body
 * @property {() => Promise<{ vibe: any, session: any }>} openSession creates `VIBE` and starts a
 *   session on it
 * @property {(sessionId: number, genomes: readonly unknown[]) => Promise<any>} generate asks for one
 *   candidate per genome, answered with it, and returns the finished job's status
 */

/**
 * @param {{ random?: () => number }} [options] `random` gives stream and order seeds; a fixed
 *   sequence when omitted
 * @returns {Promise<Studio>}
 */
export async function startStudio({ random } = {}) {
  const clock = fakeClock();
  const omlx = await fakeOmlx(clock);
  let draws = 0;
  const server = await startTestServer({
    omlxBaseUrl: omlx.baseUrl,
    clock,
    random: random ?? (() => (0.1 + 0.37 * draws++) % 1),
  });
  // The temp root's config copies example.json, so this is the gap the queue waits.
  const gap = example.queue.minGapMs;

  /** @type {Studio["drive"]} */
  async function drive(work) {
    let done = false;
    const settled = work.finally(() => {
      done = true;
    });
    while (!done) {
      const gapWaiting = await Promise.race([
        settled.then(
          () => false,
          () => false,
        ),
        clock.waitForTimer(gap).then(() => true),
      ]);
      if (gapWaiting) clock.advance(gap);
    }
    return settled;
  }

  /** @type {Studio["ok"]} */
  async function ok(method, path, value) {
    /** @type {Reply} */
    const reply = await server.api(method, path, value);
    expect(reply.status, `${method} ${path}: ${reply.body.toString()}`).toBe(200);
    return reply.json();
  }

  return {
    server,
    omlx,
    clock,
    drive,
    ok,
    async openSession() {
      const vibe = await ok("POST", "/api/vibes", VIBE);
      const session = await ok("POST", `/api/vibes/${vibe.id}/sessions`, {});
      return { vibe, session };
    },
    async generate(sessionId, genomes) {
      omlx.script(...genomes.map(answer));
      const job = await ok("POST", `/api/sessions/${sessionId}/candidates`, {
        count: genomes.length,
      });
      await drive(server.jobs.settled(job.id));
      return ok("GET", `/api/jobs/${job.id}`);
    },
  };
}

/**
 * Removes the studio's server and its root, then closes the fake omlx.
 * @param {Studio} studio
 */
export async function removeStudio({ server, omlx }) {
  await server.remove();
  await omlx.close();
}

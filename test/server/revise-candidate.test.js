// reviseCandidate called directly (decisions 0036 and 0040): a revision of either arm is never
// revised again. The candidates and evaluation jobs' tests cover the revision itself.
import { afterEach, expect, test } from "vitest";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { reviseCandidate } from "../../src/server/revise-candidate.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { VIBE } from "../support/studio.js";
import { testApp } from "../support/test-app.js";

/** @type {Awaited<ReturnType<typeof testApp>>[]} */
const apps = [];
afterEach(async () => {
  for (const made of apps.splice(0)) await made.remove();
});

test.each(["revise", "revise-control"])(
  "refuses a candidate that is itself a revision (%s), before sending anything",
  async (operator) => {
    const made = await testApp();
    apps.push(made);
    const { app, omlx } = made;
    const vibe = createVibe(app.store, VIBE);
    const revision = addCandidate(app.store, {
      vibeRevisionId: vibe.revision.id,
      generationId: null,
      sessionId: null,
      genomeId: putGenome(app.store, vibe.id, droneGenome).id,
      seed: 7,
      source: "llm",
      parentIds: [1],
      locks: [],
      operator,
      operatorParams: { unchanged: false },
      intent: "a drone",
      rejectReason: null,
      lint: null,
      rejectedGenome: null,
    });
    const miss = { path: "$", rule: "clipping", message: "clips" };
    await expect(
      reviseCandidate(app.store, app.queue, revision, {
        config: app.config,
        sessionId: null,
        requestGroup: "group-revisions",
        index: 0,
        seed: 8,
        locks: [],
        playable: new Set(),
        features: {
          raw: { loudness: -20, shortTermMax: -18, loudnessRange: 3, truePeak: -4 },
          heard: null,
        },
        misses: [miss],
        control: false,
        onCandidate: undefined,
        onStep: undefined,
      }),
    ).rejects.toThrow(`candidate ${revision.id} is a revision, and a revision is never revised`);
    expect(omlx.requests).toHaveLength(0);
  },
);

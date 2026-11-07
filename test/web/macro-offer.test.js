// The lock control's offer to lock the macros that still move a locked value (decision 0035),
// and a lock posted the way the card's control posts it, with its macros, read back from the
// vibe's list through the real server.
/** @import { Studio } from "../support/studio.js" */
import { afterEach, expect, test } from "vitest";
import { addCandidate, putGenome } from "../../src/server/generation-store.js";
import { macroOffer } from "../../src/web/macro-offer.js";
import { GENOMES, removeStudio, startStudio, VIBE } from "../support/studio.js";

/** @type {Studio[]} */
const studios = [];
afterEach(async () => {
  for (const studio of studios.splice(0)) await removeStudio(studio);
});

/** @param {string} path */
const lock = (path) => ({ id: 1, path });

test("offers the macros that move the value and aren't locked yet", () => {
  const offer = macroOffer(["brightness", "space", "warmth"], [lock("macros.space")]);
  expect(offer).toEqual({
    paths: ["macros.brightness", "macros.warmth"],
    text: "A locked value still follows the macros, and brightness and warmth move this one. Lock them too, so it sounds the same?",
  });
  expect(macroOffer(["brightness"], [])?.text).toBe(
    "A locked value still follows the macros, and brightness moves this one. Lock it too, so it sounds the same?",
  );
});

test("offers nothing when no macro moves the value or every one is locked", () => {
  expect(macroOffer([], [])).toBeNull();
  expect(macroOffer(["space"], [lock("macros.space")])).toBeNull();
});

test("a lock posted from the card's control, with its macros, reads back in the vibe's list", async () => {
  const studio = await startStudio();
  studios.push(studio);
  const { server, ok } = studio;
  const vibe = await ok("POST", "/api/vibes", VIBE);
  const candidate = addCandidate(server.store, {
    vibeRevisionId: vibe.revision.id,
    generationId: null,
    sessionId: null,
    genomeId: putGenome(server.store, vibe.id, GENOMES[0]).id,
    seed: 1,
    source: "llm",
    parentIds: [],
    locks: [],
    operator: null,
    operatorParams: null,
    intent: null,
    rejectReason: null,
    lint: null,
    rejectedGenome: null,
  });
  const locks = `/api/vibes/${vibe.id}/locks`;
  const path = "voices.drone.cutoff";
  const locked = await ok("POST", locks, { candidateId: candidate.id, path });
  const offer = macroOffer(locked.macros, (await ok("GET", locks)).locks);
  expect(offer?.paths.length).toBeGreaterThan(0);
  for (const macro of offer?.paths ?? []) {
    await ok("POST", locks, { candidateId: candidate.id, path: macro });
  }
  const { locks: live } = await ok("GET", locks);
  expect(live.map((/** @type {any} */ row) => row.path)).toEqual([path, ...(offer?.paths ?? [])]);
  // Once they are locked, the same lock offers nothing more.
  expect(macroOffer(locked.macros, live)).toBeNull();
});

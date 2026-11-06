// Session starts and stops (decision 0021).
import { afterEach, expect, test } from "vitest";
import { startSession, stopSession } from "../../src/server/session-store.js";
import { createVibe } from "../../src/server/vibe-store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("a session stops once, and an unknown one can't stop", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const { store } = made;
  const vibe = createVibe(store, { name: "v", brief: "b", constraints: {}, softTargets: {} });
  const start = startSession(store, vibe.id);
  expect(start).toMatchObject({ kind: "start", sessionId: null, vibeId: vibe.id });
  expect(stopSession(store, start.id)).toMatchObject({ kind: "stop", sessionId: start.id });
  expect(() => stopSession(store, start.id)).toThrow(/UNIQUE/);
  expect(() => stopSession(store, start.id + 10)).toThrow(/no session/);
});

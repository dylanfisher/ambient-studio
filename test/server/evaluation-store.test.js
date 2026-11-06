// Evaluation reports (decision 0021).
import { afterEach, expect, test } from "vitest";
import { addEvaluation, getEvaluation } from "../../src/server/evaluation-store.js";
import { tempStore } from "../support/temp-store.js";

/** @type {(() => Promise<void>)[]} */
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

test("an evaluation reads back after a reopen", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const evaluation = addEvaluation(made.store, {
    params: { vibeIds: [1, 2], count: 16 },
    report: { valid: { before: 40, after: 45, of: 48 } },
  });
  expect(getEvaluation(made.reopen(), evaluation.id)).toEqual(evaluation);
});

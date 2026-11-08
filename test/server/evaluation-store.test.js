// Evaluation reports (decision 0021).
import { afterEach, expect, test } from "vitest";
import {
  addEvaluation,
  EVALUATION_KIND,
  getEvaluation,
  listEvaluations,
} from "../../src/server/evaluation-store.js";
import { markRemoved, TABLE } from "../../src/server/store.js";
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

test("the evaluations not removed are listed oldest first", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const first = addEvaluation(made.store, { params: { count: 1 }, report: { n: 1 } });
  const removed = addEvaluation(made.store, { params: { count: 2 }, report: { n: 2 } });
  const third = addEvaluation(made.store, { params: { count: 3 }, report: { n: 3 } });
  markRemoved(made.store, TABLE.evaluations, removed.id, "a test run");
  expect(listEvaluations(made.store)).toEqual([first, third]);
});

test("an optimizer test is listed by its kind, apart from the generation runs", async () => {
  const made = await tempStore();
  cleanups.push(made.remove);
  const run = addEvaluation(made.store, { params: { count: 1 }, report: { n: 1 } });
  const optimizer = addEvaluation(made.store, {
    params: { kind: EVALUATION_KIND.optimizer, budget: 96 },
    report: { vibes: [] },
  });
  expect(listEvaluations(made.store)).toEqual([run]);
  expect(listEvaluations(made.store, EVALUATION_KIND.optimizer)).toEqual([optimizer]);
  expect(getEvaluation(made.store, optimizer.id)).toBeUndefined();
  expect(getEvaluation(made.store, optimizer.id, EVALUATION_KIND.optimizer)).toEqual(optimizer);
  expect(getEvaluation(made.store, run.id, EVALUATION_KIND.optimizer)).toBeUndefined();
});

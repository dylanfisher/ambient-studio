import { describe, expect, test } from "vitest";
import { jobsSummary } from "../../src/web/jobs-summary.js";

/** @param {Record<string, unknown>} rest */
const job = (rest) => ({
  id: 2,
  kind: "fit",
  state: "running",
  progress: null,
  error: null,
  addedAt: 1_000,
  startedAt: 2_000,
  finishedAt: null,
  ...rest,
});

describe("jobsSummary", () => {
  test("is null when every job has finished", () => {
    expect(jobsSummary([], 5_000)).toBeNull();
    expect(jobsSummary([job({ state: "done", finishedAt: 3_000 })], 5_000)).toBeNull();
  });

  test("shows the running job with its percent, its step and time in the tooltip", () => {
    const running = job({ progress: { done: 2, total: 5, step: "fitting fold 3 of 5" } });
    expect(jobsSummary([running], 12_000)).toEqual({
      text: "Fitting the taste model · 40%",
      title: "Job 2: Fitting fold 3 of 5. Running for 10 s.",
      fraction: 0.4,
    });
  });

  test("shows the running job over an older waiting one, and counts the rest", () => {
    const waiting = job({ id: 1, kind: "embed", state: "queued", startedAt: null });
    const running = job({ id: 3 });
    const third = job({ id: 4, kind: "excerpts", state: "queued", startedAt: null });
    const summary = jobsSummary([waiting, running, third], 2_000);
    expect(summary).toMatchObject({ text: "Fitting the taste model · 2 more", fraction: null });
    expect(summary?.title).toBe(
      "Job 3: Started; no count yet. Running for 0 s. 2 more jobs wait behind it.",
    );
  });

  test("shows the oldest waiting job when none runs", () => {
    const first = job({ id: 5, kind: "embed", state: "queued", startedAt: null });
    const second = job({ id: 6, state: "queued", startedAt: null });
    expect(jobsSummary([first, second], 4_000)).toMatchObject({
      text: "Analyzing the sound · 1 more",
      title:
        "Job 5: Waiting for the job ahead of it to finish. Waiting for 3 s. 1 more job waits behind it.",
    });
  });
});

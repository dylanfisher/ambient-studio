import { describe, expect, test } from "vitest";
import { durationText, jobProgress } from "../../src/web/job-progress.js";

/** @param {Record<string, unknown>} rest */
const job = (rest) => ({
  id: 2,
  kind: "candidates",
  state: "running",
  progress: null,
  error: null,
  addedAt: 1_000,
  startedAt: 2_000,
  finishedAt: null,
  ...rest,
});

describe("jobProgress", () => {
  test("shows the job's step sentence and a bar from done and total", () => {
    const shown = jobProgress(
      job({ progress: { done: 2, total: 8, step: "asking the model for candidate 3 of 8" } }),
      67_000,
    );
    expect(shown).toEqual({
      title: "New candidates for this brief",
      state: "Running",
      step: "Asking the model for candidate 3 of 8.",
      fraction: 0.25,
      elapsed: "Running for 1 min 05 s.",
      error: null,
      finished: false,
    });
  });

  test("falls back to done of total when the step is null or missing", () => {
    expect(jobProgress(job({ progress: { done: 3, total: 8, step: null } }), 2_000).step).toBe(
      "3 of 8 done.",
    );
    expect(jobProgress(job({ progress: { done: 3, total: 8 } }), 2_000).step).toBe("3 of 8 done.");
  });

  test("a running job with no count yet has no bar and says it has started", () => {
    const shown = jobProgress(job({}), 12_000);
    expect(shown.fraction).toBeNull();
    expect(shown.step).toMatch(/^Started/);
  });

  test("a queued job says it waits, and for how long", () => {
    const shown = jobProgress(job({ state: "queued", startedAt: null }), 13_000);
    expect(shown.state).toBe("Waiting");
    expect(shown.elapsed).toBe("Waiting for 12 s.");
  });

  test("a finished job says how long it took and why it failed", () => {
    const shown = jobProgress(
      job({ state: "failed", finishedAt: 32_000, error: "omlx is busy" }),
      90_000,
    );
    expect(shown).toMatchObject({
      state: "Failed",
      elapsed: "Took 30 s.",
      error: "omlx is busy",
      finished: true,
    });
  });

  test("never reads as the bare job line", () => {
    for (const kind of ["candidates", "excerpts", "evaluation", "nudge", "explore"]) {
      const { title } = jobProgress(job({ kind }), 3_000);
      expect(title).not.toMatch(/^Job \d/);
    }
  });

  test("names a nudge and an explore, which the session and lineage pages follow", () => {
    expect(jobProgress(job({ kind: "nudge" }), 3_000).title).toBe("Nudging a candidate");
    expect(jobProgress(job({ kind: "explore" }), 3_000).title).toBe(
      "The model's variations of a candidate",
    );
  });

  test("a kind the page doesn't know is an error, not a blank title", () => {
    expect(() => jobProgress(job({ kind: "mystery" }), 3_000)).toThrow(/mystery/);
  });
});

test("durationText reads seconds, minutes and hours", () => {
  expect(durationText(400)).toBe("0 s");
  expect(durationText(42_000)).toBe("42 s");
  expect(durationText(65_000)).toBe("1 min 05 s");
  expect(durationText(3_725_000)).toBe("1 h 02 min");
  expect(durationText(-5_000)).toBe("0 s");
});

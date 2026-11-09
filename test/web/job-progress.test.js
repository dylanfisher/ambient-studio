import { describe, expect, test } from "vitest";
import { JOB_KIND } from "../../src/domain/job-kind.js";
import { OPERATOR } from "../../src/domain/operator.js";
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
      notEmbedded: null,
      notRanked: null,
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

  test("names a search by ear, which the session page follows", () => {
    expect(jobProgress(job({ kind: "optimize-ear" }), 3_000).title).toBe("Searching by ear");
  });

  test("names the map's fill, which the map page follows", () => {
    expect(jobProgress(job({ kind: "elite" }), 3_000).title).toBe("Filling the map");
  });

  test("names a steer, which the session page follows", () => {
    expect(jobProgress(job({ kind: "steer" }), 3_000).title).toBe("Steering by the sliders");
  });

  test("names a search, which the session page follows", () => {
    expect(jobProgress(job({ kind: "optimize" }), 3_000).title).toBe(
      "Searching by your taste model",
    );
  });

  test("names a nudge and an explore, which the session and lineage pages follow", () => {
    expect(jobProgress(job({ kind: "nudge" }), 3_000).title).toBe("Nudging a candidate");
    expect(jobProgress(job({ kind: "explore" }), 3_000).title).toBe(
      "The model's variations of a candidate",
    );
  });

  test("a finished candidates job says why its excerpts weren't embedded", () => {
    const reason =
      "the config's sidecar.checkpointCache is null, so excerpts aren't embedded; set it to a folder for the CLAP checkpoint";
    const finished = { state: "done", finishedAt: 9_000 };
    expect(jobProgress(job({ ...finished, result: { notEmbedded: reason } }), 9_000)).toMatchObject(
      {
        notEmbedded:
          "The config's sidecar.checkpointCache is null, so excerpts aren't embedded; set it to a folder for the CLAP checkpoint.",
      },
    );
    expect(
      jobProgress(job({ ...finished, result: { notEmbedded: null } }), 9_000).notEmbedded,
    ).toBe(null);
    // A job of another kind, or one still running, has no result to read.
    expect(jobProgress(job({ kind: "nudge", ...finished, result: {} }), 9_000).notEmbedded).toBe(
      null,
    );
    expect(jobProgress(job({}), 9_000).notEmbedded).toBe(null);
  });

  test("a finished candidates job says why the session wasn't ranked (0046)", () => {
    const finished = { state: "done", finishedAt: 9_000 };
    const reason = "the taste model has nothing to tell the candidates apart by yet";
    expect(jobProgress(job({ ...finished, result: { notRanked: reason } }), 9_000).notRanked).toBe(
      "The taste model has nothing to tell the candidates apart by yet.",
    );
    expect(jobProgress(job({ ...finished, result: { notRanked: null } }), 9_000).notRanked).toBe(
      null,
    );
  });

  test("the embed and fit jobs have titles (0046)", () => {
    expect(jobProgress(job({ kind: "embed" }), 3_000).title).toBe("Analyzing the sound");
    expect(jobProgress(job({ kind: "fit" }), 3_000).title).toBe("Fitting the taste model");
  });

  test("the brief's draft from the owner's words has a title (0074)", () => {
    expect(jobProgress(job({ kind: "draft-brief" }), 3_000).title).toBe(
      "Writing the brief from your words",
    );
  });

  test("the words operator's job has a title (0084)", () => {
    expect(jobProgress(job({ kind: "words" }), 3_000).title).toBe("Reading your words as settings");
  });

  // The top bar shows every job (0073), so a kind the server adds with no title throws there.
  test("every kind of job the server adds has a title", () => {
    for (const kind of [...Object.values(JOB_KIND), OPERATOR.breed]) {
      expect(jobProgress(job({ kind }), 3_000).title).toMatch(/\w/);
    }
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

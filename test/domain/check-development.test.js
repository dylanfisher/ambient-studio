// The check on a section's development (decision 0079): the genome validated, lasting the
// seconds asked, playing only the sketch's recordings, linted under the brief without its
// duration range, and within the cost budget; a cut-off answer, no JSON or several objects have
// nothing to repair.
import { describe, expect, test } from "vitest";
import {
  checkDevelopment,
  judgeDevelopment,
  SECONDS_RULE,
} from "../../src/domain/check-development.js";
import { REJECT_REASON } from "../../src/domain/reject-reason.js";
import { COST_BUDGET } from "../../src/engine/cost.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import recordingGenome from "../../src/engine/genomes/field-recording.json" with { type: "json" };
import cloudGenome from "../../src/engine/genomes/granular-cloud.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";

/** The drone at 180 s, a pad entering at 60 s so it isn't a lone static drone. */
const developed = {
  ...droneGenome,
  duration: 180,
  fadeIn: 0,
  fadeOut: 0,
  voices: [...droneGenome.voices, { id: "pad", type: "pad", level: -14, start: 60 }],
};
const ask = {
  seconds: 180,
  // A duration range the section's 180 s is outside of: a development isn't held to it.
  constraints: { tuning: "12-tet", duration: { min: 30, max: 90 }, bannedVoices: ["bell"] },
  recordings: new Set(),
};

test("a valid genome of the section's seconds passes, outside the brief's duration range", () => {
  expect(checkDevelopment(structuredClone(developed), ask)).toEqual({
    ok: true,
    genome: requireGenome(developed, "developed"),
  });
  // No room for an excerpt between its fades is no finding either: it is never excerpted.
  const short = { ...developed, duration: 20, voices: [droneGenome.voices[0]], fadeOut: 10 };
  const verdict = checkDevelopment(short, { ...ask, seconds: 20 });
  expect(verdict.ok || verdict.errors.map(({ rule }) => rule)).not.toContain("excerptLength");
});

describe("findings the repair quotes", () => {
  /** @type {[string, Record<string, unknown>, object, string, string][]} */
  const found = [
    ["another duration", { ...developed, duration: 200 }, ask, "$.duration", SECONDS_RULE],
    ["a schema error", { ...developed, width: 99 }, ask, "$.width", "schema"],
    [
      "a voice the brief bans",
      { ...developed, voices: [...developed.voices, { id: "b", type: "bell" }] },
      ask,
      "$.voices[2].type",
      "bannedVoices",
    ],
    [
      "a recording the sketch doesn't play",
      { ...recordingGenome, duration: 180 },
      ask,
      "$.voices[0].recording",
      "schema",
    ],
  ];
  for (const [name, answer, given, path, rule] of found) {
    test(name, () => {
      const verdict = checkDevelopment(answer, /** @type {any} */ (given));
      expect(verdict.ok).toBe(false);
      if (verdict.ok) return;
      expect(verdict.answer).toBe(answer);
      expect(verdict.errors).toContainEqual(expect.objectContaining({ path, rule }));
    });
  }

  test("over the engine's cost budget", () => {
    // render-checks.test.js's heavy cloud, at the section's seconds.
    const [voice] = cloudGenome.voices;
    const clouds = Array.from({ length: 16 }, (_, i) => ({
      ...voice,
      id: `c${i}`,
      density: 30,
      size: 0.5,
    }));
    const heavy = { ...cloudGenome, duration: 180, voices: clouds };
    const verdict = checkDevelopment(heavy, { ...ask, constraints: {} });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.errors).toContainEqual(
      expect.objectContaining({
        rule: "costBudget",
        message: expect.stringContaining(`${COST_BUDGET}`),
      }),
    );
  });
});

test("a cut-off answer, no JSON or several objects have nothing to repair", () => {
  const text = JSON.stringify(developed);
  for (const [completion, reason] of /** @type {const} */ ([
    [{ text: text.slice(0, 40), finishReason: "length" }, REJECT_REASON.truncated],
    [{ text: "here it is", finishReason: "stop" }, REJECT_REASON.noJson],
    [{ text: `${text}\n${text}`, finishReason: "stop" }, REJECT_REASON.severalObjects],
  ])) {
    const verdict = judgeDevelopment(completion, 10752, ask);
    expect(verdict).toMatchObject({ ok: false, reason, answer: null });
  }
  expect(judgeDevelopment({ text: `Here:\n${text}`, finishReason: "stop" }, 10752, ask).ok).toBe(
    true,
  );
});

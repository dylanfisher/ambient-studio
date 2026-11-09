// A sketch's lineage read in short lines (decision 0078): from its first ancestor to the
// sketch, each step's operator in the lineage page's words, what it was asked (an explore's
// direction, a steer's settings, a breed's parents), its intent, and what changed against the
// step before; a chain whose parent isn't stored, and the reading's cap.
/** @import { LineageStep } from "../../src/domain/lineage-reading.js" */
import { describe, expect, test } from "vitest";
import { LINEAGE_READING_TOKENS, lineageReading } from "../../src/domain/lineage-reading.js";
import { estimateTokens } from "../../src/domain/prompt-tokens.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { worstGenome } from "../support/worst-genome.js";

const drone = requireGenome(droneGenome, "drone.json");

/** @param {(genome: any) => void} change */
function changed(change) {
  const child = structuredClone(drone);
  change(child);
  return requireGenome(child, "the changed child");
}

/**
 * @param {Partial<LineageStep> & { id: number }} step
 * @returns {LineageStep}
 */
const step = (step) => ({
  operator: null,
  operatorParams: null,
  parentIds: [],
  intent: null,
  genome: drone,
  ...step,
});

/** What the route names each attachment a steer chose. */
const NAMES = new Map([
  [4, "“dry” to “wet”"],
  [5, "the region “dawn”"],
]);
/** @param {number} id */
const nameOf = (id) => NAMES.get(id) ?? null;

describe("lineageReading", () => {
  test("a first try is a chain of one step", () => {
    expect(
      lineageReading(
        { steps: [step({ id: 3, intent: "a slow cold drone" })], missingParentId: null },
        nameOf,
      ),
    ).toEqual([
      "How the sketch was made, from its first ancestor, in one step:",
      'Step 1, candidate 3, first try: "a slow cold drone".',
    ]);
  });

  test("each step says its operator, what it was asked and what changed against the last", () => {
    const darker = changed((genome) => {
      genome.voices[0].root = 55;
    });
    const wetter = changed((genome) => {
      genome.voices[0].root = 55;
      genome.reverbLevel = -8;
    });
    const steps = [
      step({ id: 3, intent: "a slow cold drone" }),
      step({
        id: 7,
        operator: "explore",
        operatorParams: { direction: "darker and slower", baseTrimmed: false },
        parentIds: [3],
        intent: "lower and darker",
        genome: darker,
      }),
      step({
        id: 9,
        operator: "steer",
        operatorParams: {
          generation: 0,
          point: 2,
          steer: { directions: [{ id: 4, setting: 0.7 }], regions: [5] },
        },
        parentIds: [7],
        genome: wetter,
      }),
      step({
        id: 12,
        operator: "breed",
        operatorParams: { stage: "crossover", sketchIds: [1, 2], parentsTrimmed: [] },
        parentIds: [9, 11],
        intent: "both at once",
        genome: wetter,
      }),
      step({
        id: 13,
        operator: "breed",
        operatorParams: { stage: "mutation", stepSize: "small", seed: 4 },
        parentIds: [12],
        genome: drone,
      }),
    ];
    expect(lineageReading({ steps, missingParentId: null }, nameOf)).toEqual([
      "How the sketch was made, from its first ancestor, in 5 steps:",
      'Step 1, candidate 3, first try: "a slow cold drone".',
      'Step 2, candidate 7, variation of candidate 3, toward "darker and slower": "lower and darker". Changed: voice drone: root (37 → 55 Hz).',
      "Step 3, candidate 9, steered from candidate 7, along “dry” to “wet” (setting 0.7), toward the region “dawn”. Changed: reverbLevel (-12 → -8 dB).",
      'Step 4, candidate 12, bred from candidate 9 and candidate 11: "both at once". Nothing changed.',
      "Step 5, candidate 13, bred, a small nudge of candidate 12. Changed: reverbLevel (-8 → -12 dB); voice drone: root (55 → 37 Hz).",
    ]);
  });

  test("an explore whose base didn't fit, a nudge, a revision, a search and a retune say so", () => {
    const steps = [
      step({ id: 1 }),
      step({
        id: 2,
        operator: "explore",
        operatorParams: { direction: null, baseTrimmed: true },
        parentIds: [1],
      }),
      step({
        id: 3,
        operator: "nudge",
        operatorParams: { stepSize: "medium", seed: 1 },
        parentIds: [2],
      }),
      step({ id: 4, operator: "revise", operatorParams: { unchanged: false }, parentIds: [3] }),
      step({
        id: 5,
        operator: "optimize",
        operatorParams: { generation: 1, point: 0 },
        parentIds: [4],
      }),
      step({ id: 6, operator: "optimize-ear", operatorParams: { query: 2 }, parentIds: [5] }),
      step({ id: 7, operator: "elite", operatorParams: { stepSize: "small" }, parentIds: [6] }),
      step({
        id: 8,
        operator: "retune",
        operatorParams: { tuning: "colundi", scale: "core18" },
        parentIds: [7],
      }),
    ];
    const lines = lineageReading({ steps, missingParentId: null }, nameOf);
    expect(lines.slice(2).map((line) => line.replace(/ Nothing changed\.$/, ""))).toEqual([
      "Step 2, candidate 2, variation of candidate 1, though the model never read it: it didn't fit in the model's context.",
      "Step 3, candidate 3, nudged from candidate 2, a medium step.",
      "Step 4, candidate 4, revised from candidate 3, after its excerpt missed a range or a check.",
      "Step 5, candidate 5, searched from candidate 4, scored by the taste model.",
      "Step 6, candidate 6, searched by ear from candidate 5, chosen by the owner over the best so far.",
      "Step 7, candidate 7, map fill from candidate 6, a small step.",
      "Step 8, candidate 8, retuned from candidate 7, set to colundi, scale core18.",
    ]);
  });

  test("a steer's attachment that isn't named any more is said by its id", () => {
    const steps = [
      step({ id: 1 }),
      step({
        id: 2,
        operator: "steer",
        operatorParams: { steer: { directions: [{ id: 8, setting: 0.25 }], regions: [] } },
        parentIds: [1],
      }),
    ];
    expect(lineageReading({ steps, missingParentId: null }, nameOf)[2]).toBe(
      "Step 2, candidate 2, steered from candidate 1, along direction 8, no longer attached (setting 0.25). Nothing changed.",
    );
  });

  test("a parent that isn't stored ends the chain, and the reading says so", () => {
    const steps = [
      step({
        id: 7,
        operator: "explore",
        operatorParams: { direction: "brighter", baseTrimmed: false },
        parentIds: [5],
      }),
      step({ id: 8, operator: "nudge", operatorParams: { stepSize: "small" }, parentIds: [7] }),
    ];
    expect(lineageReading({ steps, missingParentId: 5 }, nameOf).slice(0, 2)).toEqual([
      "How the sketch was made, from candidate 7, in 2 steps: candidate 7's parent, candidate 5, isn't in the studio, so the chain stops there and what candidate 7 changed isn't known.",
      'Step 1, candidate 7, variation of candidate 5, toward "brighter".',
    ]);
  });

  test("a long chain stays under its cap: values go first, oldest first, then the middle steps", () => {
    const steps = Array.from({ length: 12 }, (_, i) =>
      step({
        id: i + 1,
        operator: i === 0 ? null : "nudge",
        operatorParams: i === 0 ? null : { stepSize: "large" },
        parentIds: i === 0 ? [] : [i],
        intent: i === 0 ? "i".repeat(200) : null,
        genome: worstGenome(i),
      }),
    );
    const lines = lineageReading({ steps, missingParentId: null }, nameOf);
    const text = lines.join("\n");
    expect(estimateTokens(text)).toBeLessThanOrEqual(LINEAGE_READING_TOKENS);
    expect(lines[1]).toMatch(/^Step 1, candidate 1, first try/);
    expect(lines.at(-1)).toMatch(/^Step 12, candidate 12, nudged from candidate 11/);
    expect(text).toMatch(/Steps 2–\d+ left out for room\./);

    // Just under what three steps take in full, the oldest step loses its values first.
    const three = { steps: steps.slice(0, 3), missingParentId: null };
    const full = lineageReading(three, nameOf, Number.MAX_SAFE_INTEGER);
    const [, , second, third] = lineageReading(three, nameOf, estimateTokens(full.join("\n")) - 1);
    expect(second).not.toContain("→");
    expect(third).toContain("→");
  });
});

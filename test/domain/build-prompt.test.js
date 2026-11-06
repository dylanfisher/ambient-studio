// The generation prompt: what it states, and how it fits the context budget (decision 0024).
/** @import { Constraints } from "../../src/domain/constraint-schema.js" */
/** @import { PromptExample } from "../../src/domain/build-prompt.js" */
/** @import { ChatMessage } from "../../src/domain/prompt-tokens.js" */
import { describe, expect, test } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import { buildPrompt } from "../../src/domain/build-prompt.js";
import { constraintsText } from "../../src/domain/constraints-text.js";
import { estimateTokens, promptText } from "../../src/domain/prompt-tokens.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";
import { canonicalGenome } from "../../src/engine/canonical-genome.js";
import colundiGenome from "../../src/engine/genomes/colundi.json" with { type: "json" };
import exampleGenome from "../../src/engine/genomes/example.json" with { type: "json" };
import { schemaText } from "../../src/engine/schema-text.js";

const BUDGET = example.queue.contextBudgetTokens;

/** Every kind set, as in constraints-text.test.js. @type {Constraints} */
const full = {
  tuning: "12-tet",
  scale: "dorian",
  key: 2,
  pulse: "beat",
  bpm: { min: 60, max: 90 },
  duration: { min: 120, max: 240 },
  loudness: -16,
  allowedVoices: ["drone", "pad", "bell", "granular"],
  bannedVoices: ["noise"],
  bellNotes: 4,
  grains: 10,
  padChords: 1.5,
  brightness: { min: 0.3, max: 0.7 },
  cost: 300,
};

const revision = {
  name: "cold drone",
  brief: "A slow, cold drone in D dorian, like wind over a frozen lake at night.",
  constraints: full,
};
const locks = [
  { path: "reverbDecay", value: 8 },
  { path: "voices.pad.hold", value: 40 },
];
const notes = ["less shimmer on the bells", "the pad swell is too fast"];

/**
 * @param {number} count
 * @returns {PromptExample[]}
 */
const examples = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    liked: i % 2 === 0,
    genome: i % 2 === 0 ? exampleGenome : colundiGenome,
  }));

/** @param {ChatMessage[]} messages */
const tokens = (messages) => estimateTokens(promptText(messages));

describe("buildPrompt", () => {
  test("the test's constraint set is valid", () => {
    expect(validateConstraints(full).ok).toBe(true);
  });

  test("states the schema, every constraint, each lock, the brief and the notes", () => {
    const { messages } = buildPrompt(revision, {
      notes,
      locks,
      examples: [],
      budgetTokens: BUDGET,
    });
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    const text = promptText(messages);
    expect(text).toContain(schemaText());
    for (const line of constraintsText(full).split("\n")) expect(text).toContain(line);
    expect(text).toContain("reverbDecay = 8");
    expect(text).toContain("voices.pad.hold = 40");
    expect(text).toContain(revision.name);
    expect(text).toContain(revision.brief);
    for (const note of notes) expect(text).toContain(note);
    expect(text).toContain('{"intent":');
  });

  test("quotes each example's canonical genome, marked liked or disliked", () => {
    const { messages, exampleIds } = buildPrompt(revision, {
      notes,
      locks,
      examples: examples(2),
      budgetTokens: BUDGET,
    });
    const text = promptText(messages);
    expect(exampleIds).toEqual([1, 2]);
    expect(text).toContain(`Liked: ${canonicalGenome(exampleGenome)}`);
    expect(text).toContain(`Disliked: ${canonicalGenome(colundiGenome)}`);
  });

  test("leaves out the sections a vibe doesn't have", () => {
    const { messages } = buildPrompt(
      { ...revision, constraints: {} },
      { notes: [], locks: [], examples: [], budgetTokens: BUDGET },
    );
    const text = promptText(messages);
    expect(text).toContain(constraintsText({}));
    expect(text).not.toMatch(/Locked/);
    expect(text).not.toMatch(/owner.s notes/);
    expect(text).not.toMatch(/Liked|Disliked/);
  });

  test("trims examples from the end until the prompt fits the budget", () => {
    const many = examples(40);
    const { messages, exampleIds } = buildPrompt(revision, {
      notes,
      locks,
      examples: many,
      budgetTokens: BUDGET,
    });
    expect(tokens(messages)).toBeLessThanOrEqual(BUDGET);
    expect(exampleIds.length).toBeGreaterThan(0);
    expect(exampleIds.length).toBeLessThan(many.length);
    expect(exampleIds).toEqual(many.slice(0, exampleIds.length).map((e) => e.id));
    // One more example would not have fitted.
    const oneMore = buildPrompt(revision, {
      notes,
      locks,
      examples: many.slice(0, exampleIds.length + 1),
      budgetTokens: Number.MAX_SAFE_INTEGER,
    });
    expect(tokens(oneMore.messages)).toBeGreaterThan(BUDGET);
  });

  test("fails, naming the sizes, when the prompt doesn't fit with every example trimmed", () => {
    const long = ["x".repeat(BUDGET * 4)];
    expect(() =>
      buildPrompt(revision, { notes: long, locks, examples: examples(3), budgetTokens: BUDGET }),
    ).toThrow(/^the prompt is about \d+ tokens with no examples, over the 8192-token budget/);
  });

  test("a vibe the size of a seed vibe fits with six examples and room to repair", () => {
    // A seed vibe (2l): every constraint kind, a paragraph of brief, a dozen notes, a few locks.
    const seedSized = {
      name: "cold dorian drone and pad",
      brief: "b".repeat(600),
      constraints: full,
    };
    const { messages, exampleIds } = buildPrompt(seedSized, {
      notes: Array.from({ length: 12 }, () => "n".repeat(150)),
      locks: [...locks, { path: "macros.space", value: 0.6 }],
      examples: examples(6),
      budgetTokens: BUDGET,
    });
    expect(exampleIds).toHaveLength(6);
    // A repair adds the answer and its errors; half the budget leaves that room.
    expect(tokens(messages)).toBeLessThan(BUDGET / 2);
  });
});

// The words operator's prompt (decision 0084): each field with what it does, its values and its
// value now, the brief and a reading of what is being changed, the words last; the size it stays
// under with the largest field set and a full sketch reading; and the repair turn.
import { expect, test } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import { MAX_EAR_DIMENSIONS } from "../../src/domain/ear-settings.js";
import {
  CHARS_PER_TOKEN,
  estimateTokens,
  promptText,
  ROLE,
} from "../../src/domain/prompt-tokens.js";
import { SKETCH_READING_TOKENS } from "../../src/domain/sketch-reading.js";
import { buildWordsPrompt, buildWordsRepair, WORDS_CHARS } from "../../src/domain/words-prompt.js";
import { WORDS_SETS } from "../../src/domain/words-sets.js";
import { choice, number } from "../../src/engine/descriptor.js";
import { MAX_CHARS } from "../../src/server/request-fields.js";

/** Half the context budget: the other half is left for the repair round (0024). */
const BUDGET = example.queue.contextBudgetTokens / 2;

/** The prompt's stated size with the largest set, a full reading and every text at its limit. */
const STATED_TOKENS = 3200;

const FIELDS = [
  {
    name: "level",
    descriptor: number({ min: 0, max: 1, default: 0.5, unit: "", description: "how loud" }),
    current: 0.5,
  },
  {
    name: "pulse",
    descriptor: choice({ values: ["none", "beat"], default: "none", description: "the pulse" }),
    current: "none",
  },
];

const ask = {
  words: "louder, with a beat",
  subject: "how one voice plays",
  fields: FIELDS,
  brief: "a cold drone",
  reading: ["a drone voice (level 0.5)"],
};

test("the user message holds the brief, the reading, each field with its values and value now, then the words", () => {
  const [system, user] = buildWordsPrompt(ask, BUDGET);
  expect(system?.role).toBe(ROLE.system);
  expect(system?.content).toContain('{"changes": {"<field>": <value>, …}, "said": ');
  expect(user?.content).toBe(
    [
      "The fields set how one voice plays.",
      "The brief: a cold drone",
      "What is being changed, as it is now:",
      "a drone voice (level 0.5)",
      "The fields, each with what it does, its values and its value now:",
      "- level: how loud; 0..1; now 0.5",
      '- pulse: the pulse; none|beat; now "none"',
      `The listener's words, as a JSON string: ${JSON.stringify(ask.words)}`,
    ].join("\n"),
  );
  const [, bare] = buildWordsPrompt({ ...ask, reading: [] }, BUDGET);
  expect(bare?.content).not.toContain("What is being changed");
});

test("with the largest field set, a full sketch reading and every text at its limit the prompt stays under its stated size, and over the budget it throws", () => {
  // The largest set now is a search by ear's shift at its most dimensions, each path as long as
  // a lock path may be.
  const paths = Array.from(
    { length: MAX_EAR_DIMENSIONS },
    (_, i) => `voices.${String(i).padStart(16, "v")}.params.${"p".repeat(MAX_CHARS.lockPath - 31)}`,
  );
  const fields = Object.entries(WORDS_SETS.shift.fields(paths)).map(([name, descriptor]) => ({
    name,
    descriptor,
    current: -0.25,
  }));
  const sketch = "r".repeat(SKETCH_READING_TOKENS * CHARS_PER_TOKEN);
  const positions = paths.map((path) => `- ${path}: the best so far sits at 0.50 of 0 to 1`);
  const full = {
    words: "w".repeat(WORDS_CHARS),
    subject: WORDS_SETS.shift.subject,
    fields,
    brief: "b".repeat(MAX_CHARS.brief),
    reading: [sketch, ...positions],
  };
  const built = buildWordsPrompt(full, BUDGET);
  expect(estimateTokens(promptText(built))).toBeLessThan(STATED_TOKENS);
  expect(STATED_TOKENS).toBeLessThan(BUDGET);
  expect(() => buildWordsPrompt(full, 1000)).toThrow(/over its 1000-token budget/);
});

test("the repair is a follow-up turn quoting every finding", () => {
  const messages = buildWordsPrompt(ask, BUDGET);
  const answer = { changes: { loud: 1 }, said: "Louder." };
  const repair = buildWordsRepair({ messages, answer }, [
    { path: "$.changes.loud", rule: "changes", message: "unknown field" },
  ]);
  expect(repair.slice(0, 2)).toEqual(messages);
  expect(repair[2]).toEqual({ role: ROLE.assistant, content: JSON.stringify(answer) });
  expect(repair[3]?.content).toContain("- $.changes.loud (changes): unknown field");
  expect(() => buildWordsRepair({ messages, answer }, [])).toThrow();
});

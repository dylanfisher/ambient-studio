// The prompt that drafts a brief (decision 0074): every constraint kind and range feature from
// their tables, the words and the brief now, the size it stays under with everything at its
// limit, and the repair turn; and a suggestion's prompt, quoting as many of the owner's briefs as
// fit (0093).
import { describe, expect, test } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import { CONSTRAINT_KINDS } from "../../src/domain/constraint-schema.js";
import {
  buildDraftBriefPrompt,
  buildDraftBriefRepair,
  buildSuggestBriefPrompt,
  OTHER_BRIEF_CHARS,
} from "../../src/domain/draft-brief-prompt.js";
import { estimateTokens, promptText, ROLE } from "../../src/domain/prompt-tokens.js";
import { TARGET_FEATURES } from "../../src/domain/target-schema.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";

/** Half the context budget: the other half is left for the repair round (0024). */
const BUDGET = example.queue.contextBudgetTokens / 2;

/** The prompt's stated size with a brief, a name and words at their limits. */
const STATED_TOKENS = 2800;

const limits = { name: 200, brief: 4000 };
const words = "colder and sparser, drop the bells";
const current = {
  name: "Bell field",
  brief: "Struck bells over a quiet bed.",
  constraints: { pulse: /** @type {const} */ ("none") },
  softTargets: { features: { onsetRate: /** @type {[number, number]} */ ([0, 0.2]) } },
};

describe("the system message", () => {
  const [system] = buildDraftBriefPrompt({ words, current: null, limits }, BUDGET);
  test("names every constraint kind, voice type and range feature, and the limits", () => {
    expect(system?.role).toBe(ROLE.system);
    for (const kind of Object.keys(CONSTRAINT_KINDS)) {
      expect(system?.content).toMatch(new RegExp(`^  "${kind}": `, "m"));
    }
    for (const type of voiceTypeIds())
      expect(system?.content).toMatch(new RegExp(`^  ${type}: `, "m"));
    for (const feature of Object.keys(TARGET_FEATURES)) {
      expect(system?.content).toMatch(new RegExp(`^  "${feature}": `, "m"));
    }
    expect(system?.content).toContain('"bpm": {"min": 40..140 bpm int, "max": 40..140 bpm int}');
    expect(system?.content).toContain(
      '"lowEndShare": low-end share; each end from 0 to 1, or null for an open end',
    );
    expect(system?.content).toContain("at most 200 characters");
    expect(system?.content).toContain("at most 4000 characters");
  });
});

test("a new brief's user message holds the words alone; a rework's holds the brief now too", () => {
  const [, fresh] = buildDraftBriefPrompt({ words, current: null, limits }, BUDGET);
  expect(fresh?.content).toBe(
    `The owner's words for the brief, as a JSON string: ${JSON.stringify(words)}\n\nWrite the brief.`,
  );
  const kept = { ...current, softTargets: { ...current.softTargets, kept: 1 } };
  const [, rework] = buildDraftBriefPrompt({ words, current: kept, limits }, BUDGET);
  expect(rework?.content).toContain(`The brief now, as JSON: ${JSON.stringify(current)}`);
  expect(rework?.content).toContain(JSON.stringify(words));
  expect(rework?.content).toContain("keep what the words don't ask to change");
});

test("with every text at its limit the prompt stays under its stated size, and over the budget it throws", () => {
  const full = {
    ...current,
    name: "n".repeat(limits.name),
    brief: "b".repeat(limits.brief),
  };
  const built = buildDraftBriefPrompt({ words: "w".repeat(1000), current: full, limits }, BUDGET);
  expect(estimateTokens(promptText(built))).toBeLessThan(STATED_TOKENS);
  expect(() => buildDraftBriefPrompt({ words, current: full, limits }, 1000)).toThrow(
    /over its 1000-token budget/,
  );
});

test("the repair is a follow-up turn quoting every error", () => {
  const messages = buildDraftBriefPrompt({ words, current: null, limits }, BUDGET);
  const answer = { name: "" };
  const repair = buildDraftBriefRepair({ messages, answer }, [
    { path: "$.name", rule: "name", message: "must be a non-empty string" },
  ]);
  expect(repair.slice(0, 2)).toEqual(messages);
  expect(repair[2]).toEqual({ role: ROLE.assistant, content: JSON.stringify(answer) });
  expect(repair[3]?.content).toContain("- $.name (name): must be a non-empty string");
  expect(() => buildDraftBriefRepair({ messages, answer }, [])).toThrow();
});

describe("a suggestion's prompt", () => {
  const other = { name: "Bell field", brief: "Struck bells over a quiet bed.", constraints: {} };

  test("quotes the briefs newest first and the words, and says what to do with no words", () => {
    const newer = { ...other, name: "Underwater drone", brief: "b".repeat(OTHER_BRIEF_CHARS + 50) };
    const { messages, read } = buildSuggestBriefPrompt(
      { words: "something stranger", others: [newer, other], limits },
      BUDGET,
    );
    expect(read).toBe(2);
    const [system, user] = messages;
    expect(system?.content).toContain("You write briefs");
    const quoted = JSON.stringify({ ...newer, brief: `${"b".repeat(OTHER_BRIEF_CHARS)}…` });
    expect(user?.content).toContain(`one JSON object a line:\n${quoted}\n${JSON.stringify(other)}`);
    expect(user?.content).toContain(JSON.stringify("something stranger"));
    const [, bare] = buildSuggestBriefPrompt(
      { words: "", others: [other], limits },
      BUDGET,
    ).messages;
    expect(bare?.content).toContain("The owner gave no words");
  });

  test("drops the oldest briefs to fit the budget, and refuses none or one that never fits", () => {
    const long = { ...other, brief: "b".repeat(OTHER_BRIEF_CHARS) };
    const others = Array.from({ length: 40 }, (_, i) => ({ ...long, name: `brief ${i}` }));
    const { messages, read } = buildSuggestBriefPrompt({ words: "", others, limits }, BUDGET);
    expect(read).toBeGreaterThan(0);
    expect(read).toBeLessThan(others.length);
    expect(estimateTokens(promptText(messages))).toBeLessThanOrEqual(BUDGET);
    expect(messages[1]?.content).toContain('"brief 0"');
    expect(messages[1]?.content).not.toContain(`"brief ${read}"`);
    expect(() => buildSuggestBriefPrompt({ words: "", others: [], limits }, BUDGET)).toThrow(
      /no briefs to suggest from/,
    );
    expect(() => buildSuggestBriefPrompt({ words: "", others, limits }, 100)).toThrow(
      /even with one brief/,
    );
  });
});

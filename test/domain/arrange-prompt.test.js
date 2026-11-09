// The proposal prompt (decision 0067): what it lists, the cap on its material and the order it
// keeps, the reference arc's numbers, the size it stays under, and the repair turn.
/** @import { ArcWindow, MaterialItem } from "../../src/domain/arrange-prompt.js" */
/** @import { Features, HeardFeatures } from "../../src/domain/extract-features.js" */
import { describe, expect, test } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import {
  ARC_SPANS,
  arcLines,
  arrangeMaterial,
  buildArrangePrompt,
  buildArrangeRepair,
  MATERIAL_KIND,
  MAX_MATERIAL_LINES,
  materialLine,
} from "../../src/domain/arrange-prompt.js";
import { MAX_ARC_CHARS, MAX_TEXT_CHARS } from "../../src/domain/arrangement-schema.js";
import { estimateTokens, promptText, ROLE } from "../../src/domain/prompt-tokens.js";
import { MACROS } from "../../src/engine/genome-schema.js";

/** Half the context budget: the other half is left for the repair round (0024). */
const BUDGET = example.queue.contextBudgetTokens / 2;

/**
 * The first prompt's stated size with 24 full lines, a 600-character brief, the longest arc and
 * a 40-window region: 3,661 tokens measured once the answer asks for text (0082).
 */
const STATED_TOKENS = 3700;

/** @type {Features} */
const features = {
  raw: { loudness: -16, shortTermMax: -14.2, loudnessRange: 3.4, truePeak: -2.1 },
  heard: {
    gainDb: 0,
    centroidMean: 812.4,
    centroidSpread: 233.1,
    onsetRate: 0.42,
    lowEndShare: 0.31,
    stereoWidth: 0.58,
    flatness: 0.12,
  },
};

const macros = Object.fromEntries(
  Object.keys(MACROS).map((name, i) => [name, { min: 0.1 * i, max: 0.1 * i + 0.25, mean: 0.5 }]),
);

/**
 * @param {Partial<MaterialItem>} given
 * @returns {MaterialItem}
 */
const item = (given) => ({
  kind: MATERIAL_KIND.sketch,
  id: 1,
  intent: "a slow cold drone",
  notes: "",
  tags: [],
  duration: 300,
  features,
  macros,
  score: null,
  misses: 0,
  ...given,
});

/** A sketch line as long as one gets: every clipped field over its clip. */
const fullSketch = (/** @type {number} */ id) =>
  item({
    id,
    intent: "i".repeat(400),
    notes: "n".repeat(2000),
    tags: Array.from({ length: 32 }, () => "t".repeat(64)),
  });

/** @type {ArcWindow[]} */
const reference = Array.from({ length: 40 }, (_, i) => ({
  startSeconds: i * 12.5,
  seconds: 25,
  features: {
    ...features,
    heard: { .../** @type {HeardFeatures} */ (features.heard), centroidMean: 400 + 10 * i },
  },
}));

const ask = {
  name: "cold drone",
  brief: "b".repeat(600),
  length: 600,
  arc: "a".repeat(MAX_ARC_CHARS),
  reference,
  budgetTokens: BUDGET,
};

describe("the prompt", () => {
  test("holds every listed sketch and the arc, under its stated size", () => {
    const material = Array.from({ length: MAX_MATERIAL_LINES }, (_, i) => fullSketch(i + 1));
    const built = buildArrangePrompt({ ...ask, material });
    expect(built.material).toHaveLength(MAX_MATERIAL_LINES);
    const [system, user] = built.messages;
    expect(system?.role).toBe(ROLE.system);
    const text = user?.content ?? "";
    for (const sketch of material) expect(text).toContain(materialLine(sketch));
    expect(text).toContain(JSON.stringify(ask.arc));
    expect(text).toContain("Length: 600 s");
    expect(text).toContain("from 570 to 630 s");
    for (const line of arcLines(reference, ask.length)) expect(text).toContain(line);
    expect(text).not.toContain('"voices"');
    const tokens = estimateTokens(promptText(built.messages));
    expect(tokens).toBeLessThan(STATED_TOKENS);
  });

  test("a material line quotes the owner's text, clipped, and gives features and macros", () => {
    const line = materialLine(
      item({ id: 12, notes: 'keep "this" one', tags: ["cold", "dark"], score: 0.4 }),
    );
    expect(line).toBe(
      'sketch 12: 300 s; intent "a slow cold drone"; notes "keep \\"this\\" one"; tags "cold, dark"; measured 3.4, 812, 233, 0.42, 0.31, 0.58, 0.12; macros 0 to 0.25, 0.1 to 0.35, 0.2 to 0.45, 0.3 to 0.55, 0.4 to 0.65, 0.5 to 0.75',
    );
    const long = materialLine(fullSketch(3));
    expect(long).toContain(`notes "${"n".repeat(59)}…"`);
    expect(materialLine(item({ kind: MATERIAL_KIND.elite, id: 40, features: null }))).toMatch(
      /^elite 40: 300 s; intent "a slow cold drone"; not measured; macros /,
    );
  });

  test("trims material from the end to fit the budget, and throws when one line doesn't", () => {
    const material = Array.from({ length: MAX_MATERIAL_LINES }, (_, i) => fullSketch(i + 1));
    const built = buildArrangePrompt({ ...ask, material, budgetTokens: 1500 });
    expect(built.material.length).toBeLessThan(MAX_MATERIAL_LINES);
    expect(built.material).toEqual(material.slice(0, built.material.length));
    expect(estimateTokens(promptText(built.messages))).toBeLessThanOrEqual(1500);
    expect(() => buildArrangePrompt({ ...ask, material, budgetTokens: 200 })).toThrow(
      /over its 200-token budget/,
    );
    expect(() => buildArrangePrompt({ ...ask, material: [] })).toThrow(/at least one/);
  });

  test("asks for one short line of text on every section and transition, drawn from the arc (0082)", () => {
    const [system] = buildArrangePrompt({ ...ask, material: [item({})] }).messages;
    const rules = system?.content ?? "";
    // The answer format names text on a section and on each kind of transition.
    const format = rules.split("\n").find((line) => line.startsWith("Answer with")) ?? "";
    expect(format.match(/"text": "</g)).toHaveLength(3);
    expect(rules).toContain(
      `- Give every section and every transition its "text": one short line, at most ${MAX_TEXT_CHARS} characters`,
    );
    expect(rules).toMatch(/drawn from the owner's arc/);
  });

  test("leaves the reference section out with no region", () => {
    const built = buildArrangePrompt({ ...ask, reference: null, material: [item({})] });
    expect(built.messages[1]?.content).not.toContain("reference region");
  });
});

test("the material keeps at most 24 lines: sketches newest first, then elites by score", () => {
  const sketches = Array.from({ length: 5 }, (_, i) => item({ id: i + 1 }));
  const elites = [
    item({ kind: MATERIAL_KIND.elite, id: 100, score: null, misses: 0 }),
    item({ kind: MATERIAL_KIND.elite, id: 101, score: 0.2, misses: 1 }),
    item({ kind: MATERIAL_KIND.elite, id: 102, score: 0.9, misses: 3 }),
    item({ kind: MATERIAL_KIND.elite, id: 103, score: 0.2, misses: 0 }),
    item({ kind: MATERIAL_KIND.elite, id: 104, score: null, misses: 0 }),
    ...Array.from({ length: 30 }, (_, i) =>
      item({ kind: MATERIAL_KIND.elite, id: 200 + i, score: -1, misses: 0 }),
    ),
  ];
  const kept = arrangeMaterial(sketches, elites);
  expect(kept).toHaveLength(MAX_MATERIAL_LINES);
  expect(kept.slice(0, 9).map(({ id }) => id)).toEqual([5, 4, 3, 2, 1, 102, 103, 101, 229]);
  // Elites with no score come after every scored one, so the cap leaves them out here.
  expect(kept.map(({ id }) => id)).not.toContain(100);

  const many = Array.from({ length: 30 }, (_, i) => item({ id: i + 1 }));
  expect(arrangeMaterial(many, elites).map(({ id }) => id)).toEqual(
    Array.from({ length: MAX_MATERIAL_LINES }, (_, i) => 30 - i),
  );
});

test("the reference arc gives each span of the track its windows' medians", () => {
  const lines = arcLines(reference, 600);
  expect(lines).toHaveLength(ARC_SPANS);
  // Windows 0 to 4 have their middles in the first 75 s once stretched.
  expect(lines[0]).toBe("0 to 75 s: measured 3.4, 420, 233, 0.42, 0.31, 0.58, 0.12");
  expect(lines.at(-1)).toMatch(/^525 to 600 s: /);
  // One window over a long track lands in the span its middle does.
  expect(arcLines(reference.slice(0, 1), 600)).toEqual([expect.stringMatching(/^300 to 375 s: /)]);
});

test("the repair quotes each error with its rule and asks for the whole object again", () => {
  const built = buildArrangePrompt({ ...ask, material: [item({})] });
  const answer = { sections: [], transitions: [], lanes: [] };
  const repair = buildArrangeRepair({ messages: built.messages, answer }, [
    { path: "$.sections", rule: "length", message: "the track plays 0 s" },
  ]);
  expect(repair.slice(0, 2)).toEqual(built.messages);
  expect(repair[2]).toEqual({ role: ROLE.assistant, content: JSON.stringify(answer) });
  expect(repair[3]?.content).toContain("- $.sections (length): the track plays 0 s");
  expect(() => buildArrangeRepair({ messages: built.messages, answer }, [])).toThrow();
});

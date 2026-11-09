// The develop prompt (decision 0079): the task and the rules, the brief, the arc, the section's
// words and seconds, the sketch's genome and readings, and the neighbors where they meet it,
// within half the context at its largest; the readings left out for room in order; the repair
// quoting every error.
/** @import { Constraints } from "../../src/domain/constraint-schema.js" */
/** @import { DevelopParts, DevelopTrim } from "../../src/domain/develop-prompt.js" */
import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import { MAX_ARC_CHARS, MAX_TEXT_CHARS } from "../../src/domain/arrangement-schema.js";
import {
  buildDevelopPrompt,
  buildDevelopRepair,
  DEVELOP_TRIM,
} from "../../src/domain/develop-prompt.js";
import { lineageReading } from "../../src/domain/lineage-reading.js";
import { MEETING_EDGE, meetingState } from "../../src/domain/meeting-state.js";
import { estimateTokens, promptText, ROLE } from "../../src/domain/prompt-tokens.js";
import { sketchReading } from "../../src/domain/sketch-reading.js";
import { TARGET_FEATURES } from "../../src/domain/target-schema.js";
import { conciseGenome } from "../../src/engine/canonical-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { schemaText } from "../../src/engine/schema-text.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { worstGenome } from "../support/worst-genome.js";

const FIRST_PROMPT = example.queue.contextBudgetTokens / 2;

/** Every constraint kind set, as build-prompt.test.js's seed-sized vibe. @type {Constraints} */
const FULL_CONSTRAINTS = {
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

const FEATURES = {
  raw: { loudness: -20, shortTermMax: -18, loudnessRange: 3, truePeak: -4 },
  heard: {
    gainDb: 4,
    centroidMean: 900,
    centroidSpread: 200,
    onsetRate: 0.2,
    lowEndShare: 0.4,
    stereoWidth: 0.2,
    flatness: 0.01,
  },
};

const drone = requireGenome(droneGenome, "drone");

/** @type {DevelopParts} */
const SMALL = {
  revision: {
    name: "cold drone",
    brief: "slow and cold",
    constraints: { tuning: "12-tet" },
    ranges: {},
  },
  arc: "emerge, plateau, dissolve",
  index: 1,
  count: 3,
  section: { offset: 10, seconds: 180, text: 'a pad enters halfway, "softly"' },
  sketch: {
    id: 4,
    genome: drone,
    reading: sketchReading(drone, null),
    lineage: ["The sketch's chain, from its first ancestor:", "Step 1, candidate 3, first try."],
  },
  before: meetingState(drone, 60, MEETING_EDGE.end),
  after: meetingState(drone, 0, MEETING_EDGE.start),
};

test("holds the task, the rules, the schema, and every part the section is developed from", () => {
  const { messages, left } = buildDevelopPrompt({ ...SMALL, budgetTokens: FIRST_PROMPT });
  expect(left).toEqual([]);
  const [system, user] = /** @type {[any, any]} */ (messages);
  expect(system.role).toBe(ROLE.system);
  expect(system.content).toContain("duration is exactly the section's seconds");
  expect(system.content).toContain("Keep the sketch's tuning, scale, key, pulse and bpm unless");
  expect(system.content).toContain("otherwise the join crossfades");
  expect(system.content).toContain("at most 64 points");
  expect(system.content.endsWith(schemaText())).toBe(true);
  expect(user.role).toBe(ROLE.user);
  for (const part of [
    "Brief: cold drone\nslow and cold",
    `The track's arc, as a JSON string: "emerge, plateau, dissolve"`,
    "Section 2 of 3, 180 s. It plays sketch 4 from 10 s on the sketch's timeline",
    String.raw`The owner's words for this section, as a JSON string: "a pad enters halfway, \"softly\""`,
    `Sketch 4's genome:\n${conciseGenome(drone)}`,
    `Sketch 4, read in short lines:\n${SMALL.sketch.reading.join("\n")}`,
    "How sketch 4 was made:\nThe sketch's chain",
    `Where section 1 ends, as this section starts:\n${SMALL.before?.join("\n")}`,
    `Where section 3 starts, as this section ends:\n${SMALL.after?.join("\n")}`,
    "Write section 2's genome: duration 180,",
  ]) {
    expect(user.content).toContain(part);
  }
});

test("says when there is no arc, no words, or no neighbor", () => {
  const { messages } = buildDevelopPrompt({
    ...SMALL,
    arc: null,
    index: 0,
    count: 1,
    section: { ...SMALL.section, text: "" },
    before: null,
    after: null,
    budgetTokens: FIRST_PROMPT,
  });
  const user = /** @type {any} */ (messages[1]).content;
  expect(user).toContain("The owner wrote no arc for this track.");
  expect(user).toContain("The owner wrote nothing for this section");
  expect(user).toContain("This is the first section: nothing plays before it.");
  expect(user).toContain("This is the last section: nothing plays after it.");
});

test("at its largest the first prompt is under half the context", () => {
  // A seed-sized brief, the longest arc and words, both readings at their caps from the
  // largest genome the schema allows, both neighbors at theirs, and the largest stored genome
  // as the sketch's.
  const folder = "src/engine/genomes";
  const [largest] = readdirSync(folder)
    .map((file) => requireGenome(JSON.parse(readFileSync(`${folder}/${file}`, "utf8")), file))
    .sort((a, b) => conciseGenome(b).length - conciseGenome(a).length);
  const chain = Array.from({ length: 12 }, (_, i) => ({
    id: i + 1,
    operator: i === 0 ? null : "nudge",
    operatorParams: i === 0 ? null : { stepSize: "large" },
    parentIds: i === 0 ? [] : [i],
    intent: i === 0 ? "i".repeat(200) : null,
    genome: worstGenome(i),
  }));
  const built = buildDevelopPrompt({
    revision: {
      name: "cold dorian drone and pad",
      brief: "b".repeat(600),
      constraints: FULL_CONSTRAINTS,
      ranges: Object.fromEntries(Object.keys(TARGET_FEATURES).map((name) => [name, [0.12, 0.34]])),
    },
    arc: "a".repeat(MAX_ARC_CHARS),
    index: 5,
    count: 20,
    section: { offset: 450.5, seconds: 449.5, text: "t".repeat(MAX_TEXT_CHARS) },
    sketch: {
      id: 123456,
      genome: /** @type {any} */ (largest),
      reading: sketchReading(worstGenome(), FEATURES),
      lineage: lineageReading({ steps: chain, missingParentId: null }, () => null),
    },
    before: meetingState(worstGenome(1), 450, MEETING_EDGE.end),
    after: meetingState(worstGenome(2), 450, MEETING_EDGE.start),
    budgetTokens: Number.MAX_SAFE_INTEGER,
  });
  expect(built.left).toEqual([]);
  const tokens = estimateTokens(promptText(built.messages));
  expect(tokens).toBeLessThan(FIRST_PROMPT);
});

test("over its budget the lineage goes first, then the sketch's reading, then it throws", () => {
  const size = (/** @type {readonly DevelopTrim[]} */ left) => {
    const full = buildDevelopPrompt({ ...SMALL, budgetTokens: Number.MAX_SAFE_INTEGER });
    return { full: estimateTokens(promptText(full.messages)), left };
  };
  const { full } = size([]);
  const lineage = estimateTokens(SMALL.sketch.lineage.join("\n"));
  expect(buildDevelopPrompt({ ...SMALL, budgetTokens: full - 1 }).left).toEqual([
    DEVELOP_TRIM.lineage,
  ]);
  expect(buildDevelopPrompt({ ...SMALL, budgetTokens: full - lineage - 20 }).left).toEqual([
    DEVELOP_TRIM.lineage,
    DEVELOP_TRIM.reading,
  ]);
  // The largest genome the schema allows can't be developed in one request.
  expect(() =>
    buildDevelopPrompt({
      ...SMALL,
      sketch: { ...SMALL.sketch, genome: worstGenome() },
      budgetTokens: FIRST_PROMPT,
    }),
  ).toThrow(/over its 4096-token budget; the sketch's genome is about \d+ of them/);
});

test("the repair quotes every error and asks for the whole genome again", () => {
  const { messages } = buildDevelopPrompt({ ...SMALL, budgetTokens: FIRST_PROMPT });
  const answer = { duration: 60 };
  const repair = buildDevelopRepair({ messages, answer }, [
    { path: "$.duration", rule: "seconds", message: "must be 180" },
  ]);
  expect(repair.slice(0, 2)).toEqual(messages);
  expect(repair[2]).toEqual({ role: ROLE.assistant, content: JSON.stringify(answer) });
  expect(repair[3]?.content).toContain("- $.duration (seconds): must be 180");
  expect(repair[3]?.content).toContain("the whole corrected genome");
  expect(() => buildDevelopRepair({ messages, answer }, [])).toThrow(/at least one error/);
});

// The develop prompt (decision 0079): the task and the rules, the brief, the arc, the section's
// words and seconds, the sketch's genome and readings, and the neighbors where they meet it,
// within half the context at its largest; the readings left out for room in order; the repair
// quoting every error.
/** @import { Constraints } from "../../src/domain/constraint-schema.js" */
/** @import { DevelopBridge, DevelopParts, DevelopTrim } from "../../src/domain/develop-prompt.js" */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import { MAX_ARC_CHARS, MAX_TEXT_CHARS } from "../../src/domain/arrangement-schema.js";
import { BRIDGE_PART } from "../../src/domain/bridge-plan.js";
import {
  buildDevelopPrompt,
  buildDevelopRepair,
  DEVELOP_TRIM,
  DevelopPromptTooLong,
} from "../../src/domain/develop-prompt.js";
import { lineageReading } from "../../src/domain/lineage-reading.js";
import { BRIDGE_STATE_TOKENS, MEETING_EDGE, meetingState } from "../../src/domain/meeting-state.js";
import { estimateTokens, promptText, ROLE } from "../../src/domain/prompt-tokens.js";
import { sketchReading } from "../../src/domain/sketch-reading.js";
import { TARGET_FEATURES } from "../../src/domain/target-schema.js";
import { conciseGenome } from "../../src/engine/canonical-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { schemaText } from "../../src/engine/schema-text.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { longSettings, worstGenome } from "../support/worst-genome.js";

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

describe("a bridge (decision 0081)", () => {
  /** @type {DevelopBridge} */
  const WHOLE = {
    part: BRIDGE_PART.whole,
    from: 2,
    to: 4,
    into: 16,
    out: 12,
    middle: null,
    differs: [],
    keyless: false,
    held: { reverbDecay: 2 },
  };
  const bridged = {
    ...SMALL,
    index: 2,
    count: 5,
    section: { offset: 0, seconds: 120, text: "the drone falls away under rain" },
    before: meetingState(drone, 60, MEETING_EDGE.end, BRIDGE_STATE_TOKENS, { fixed: true }),
    after: meetingState(drone, 0, MEETING_EDGE.start, BRIDGE_STATE_TOKENS, { fixed: true }),
  };
  /** @param {Partial<DevelopParts>} parts */
  const user = (parts) =>
    /** @type {any} */ (
      buildDevelopPrompt({ ...bridged, ...parts, budgetTokens: FIRST_PROMPT }).messages[1]
    ).content;

  test("names both ends as the states it starts and ends in, with their settings", () => {
    const text = user({ bridge: WHOLE });
    for (const part of [
      "Section 3 of 5, 120 s, is a bridge the owner asked for between section 2 and section 4",
      "a 16 s weave joins it to section 2 and a 12 s weave to section 4",
      "It starts from sketch 4, which section 2 plays.",
      `The owner's words for how section 2 should become section 4, as a JSON string: "the drone falls away under rain"`,
      `Where section 2 ends, the state this bridge starts in:\n${bridged.before.join("\n")}`,
      `Where section 4 starts, the state this bridge ends in:\n${bridged.after.join("\n")}`,
      "At 0 s it holds exactly the voices sounding where section 2 ends, with the same ids, types and settings",
      "each from 0 s to at least 16 s",
      "At 120 s it holds exactly the voices sounding where section 4 starts",
      "each from 108 s or earlier to 120 s",
      "Keep reverbDecay 2 s: section 2 and section 4 have the same.",
      "Write the bridge's genome: duration 120,",
    ]) {
      expect(text).toContain(part);
    }
    // A voice's settings that can't move are in the states, which the plain section's leave out.
    expect(bridged.before.join("\n")).toContain("detune 4 cents");
    expect(SMALL.before?.join("\n")).not.toContain("detune 4 cents");
    expect(text).not.toContain("This is the first section");
    expect(user({ bridge: WHOLE, section: { ...bridged.section, text: "" } })).toContain(
      "The owner wrote nothing for this join",
    );
  });

  test("a bridge across a key is two halves, crossing on voices with no pitch", () => {
    const halves = { ...WHOLE, middle: 8, differs: ["key"], keyless: true };
    const first = user({ bridge: { ...halves, part: BRIDGE_PART.first }, after: null });
    for (const part of [
      "is the first half of a bridge the owner asked for between section 2 and section 4",
      "Section 4 has another key, which one genome can't change",
      "with a crossfade of 8 s between them",
      "From 112 s only voices with no pitch sound (types noise, recording, cymbal)",
      "Write the first half's genome: duration 120,",
    ]) {
      expect(first).toContain(part);
    }
    expect(first).not.toContain("Where section 4 starts");
    const second = user({
      index: 3,
      bridge: { ...halves, part: BRIDGE_PART.second },
    });
    for (const part of [
      "Section 4 of 5, 120 s, is the second half of a bridge",
      "It starts from sketch 4, which section 4 plays.",
      "Where section 3, the first half, ends, the state this half starts in:",
      "each from 0 s to at least 8 s",
      "its tuning, scale, key, pulse and bpm are section 4's",
      "Until 8 s only voices with no pitch sound",
      "Where section 4 starts, the state this half ends in:",
    ]) {
      expect(second).toContain(part);
    }
  });

  /**
   * A bridge's ask at its largest, TD.3's worst parts with the second half's bridge, between
   * `out` and `into` at their 450 s.
   * @param {import("../../src/engine/genome-schema.js").Genome} out
   * @param {import("../../src/engine/genome-schema.js").Genome} into
   */
  const largestBridge = (out, into) => {
    const largest = requireGenome(
      JSON.parse(readFileSync("src/engine/genomes/field-recording.json", "utf8")),
      "largest",
    );
    return /** @type {import("../../src/domain/develop-prompt.js").DevelopAsk} */ ({
      revision: {
        name: "cold dorian drone and pad",
        brief: "b".repeat(600),
        constraints: FULL_CONSTRAINTS,
        ranges: Object.fromEntries(
          Object.keys(TARGET_FEATURES).map((name) => [name, [0.12, 0.34]]),
        ),
      },
      arc: "a".repeat(MAX_ARC_CHARS),
      index: 5,
      count: 20,
      section: { offset: 0, seconds: 449.5, text: "t".repeat(MAX_TEXT_CHARS) },
      sketch: {
        id: 123456,
        genome: largest,
        reading: sketchReading(worstGenome(), FEATURES),
        lineage: lineageReading(
          {
            steps: Array.from({ length: 12 }, (_, i) => ({
              id: i + 1,
              operator: i === 0 ? null : "nudge",
              operatorParams: i === 0 ? null : { stepSize: "large" },
              parentIds: i === 0 ? [] : [i],
              intent: i === 0 ? "i".repeat(200) : null,
              genome: worstGenome(i),
            })),
            missingParentId: null,
          },
          () => null,
        ),
      },
      bridge: {
        ...WHOLE,
        part: BRIDGE_PART.second,
        middle: 8,
        differs: ["tuning", "scale", "key", "pulse", "bpm"],
        keyless: true,
        held: { width: -3, reverbDecay: 12.5, delayTime: 1.25, loudness: -18, ceiling: -1 },
      },
      before: meetingState(out, 450, MEETING_EDGE.end, BRIDGE_STATE_TOKENS, { fixed: true }),
      after: meetingState(into, 450, MEETING_EDGE.start, BRIDGE_STATE_TOKENS, { fixed: true }),
      budgetTokens: FIRST_PROMPT,
    });
  };

  test("at its largest a bridge's first prompt fits half the context with the lineage left out", () => {
    const built = buildDevelopPrompt(largestBridge(worstGenome(1), worstGenome(2)));
    expect(built.left).toEqual([DEVELOP_TRIM.lineage]);
    expect(estimateTokens(promptText(built.messages))).toBeLessThanOrEqual(FIRST_PROMPT);
  });

  test("neighbors with long settings on every voice are refused loudly, not rounded (0082)", () => {
    // Each state keeps every value its check compares, past its cap: 694 tokens a side.
    const ask = largestBridge(longSettings(worstGenome(1), 16), longSettings(worstGenome(2), 16));
    const refused = /** @type {any} */ (
      (() => {
        try {
          buildDevelopPrompt(ask);
        } catch (error) {
          return error;
        }
        throw new Error("the prompt was built");
      })()
    );
    expect(refused).toBeInstanceOf(DevelopPromptTooLong);
    expect(refused).toMatchObject({ budgetTokens: FIRST_PROMPT });
    expect(refused.tokens).toBeGreaterThan(FIRST_PROMPT);
    expect(refused.message).toMatch(/over its 4096-token budget/);
    // With 8 such voices a side it still fits, leaving both readings out at most.
    const eight = largestBridge(longSettings(worstGenome(1), 8), longSettings(worstGenome(2), 8));
    expect(estimateTokens(promptText(buildDevelopPrompt(eight).messages))).toBeLessThanOrEqual(
      FIRST_PROMPT,
    );
  });
});

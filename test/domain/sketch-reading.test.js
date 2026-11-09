// A sketch read in short lines (decision 0078): its globals, each voice, its macros and its
// excerpt's ranged features, with every raw number in parentheses after the words that name it;
// the reading's cap and what it cuts first; and the room both readings leave in the develop
// prompt of step TD.3.
/** @import { Constraints } from "../../src/domain/constraint-schema.js" */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import { MAX_ARC_CHARS, MAX_TEXT_CHARS } from "../../src/domain/arrangement-schema.js";
import { buildPrompt } from "../../src/domain/build-prompt.js";
import { LINEAGE_READING_TOKENS } from "../../src/domain/lineage-reading.js";
import { estimateTokens, promptText } from "../../src/domain/prompt-tokens.js";
import { SKETCH_READING_TOKENS, sketchReading } from "../../src/domain/sketch-reading.js";
import { TARGET_FEATURES } from "../../src/domain/target-schema.js";
import { conciseGenome } from "../../src/engine/canonical-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import exampleGenome from "../../src/engine/genomes/example.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { requireVoiceType, voiceTypeIds } from "../../src/engine/voice-registry.js";
import { worstGenome } from "../support/worst-genome.js";

/** Features as an excerpt is measured. */
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

const RECORDING = "810ab2357cb6dd62882afd92502fc013609b1bb326a5ff50873513b125fb0d3f";

/** @param {string} text */
const tokens = (text) => estimateTokens(text);

describe("sketchReading", () => {
  test("reads the drone fixture in four lines: the piece, its voice, its macros, its features", () => {
    expect(sketchReading(requireGenome(droneGenome, "drone.json"), FEATURES)).toEqual([
      "Whole piece: duration (60 s), tuning 12-tet, scale dorian, key (2), pulse none.",
      "Voice drone, a drone [sine stack ×3 detuned, swept low-pass]: voice level (-10 dB); plays throughout; root, nearest scale note (37 Hz); moves: cutoff, low-pass (250 → 900 Hz over 0–3 s).",
      "Macros (0.5 is neutral): brightness brighter (0.7); the rest neutral: density, motion, space, warmth, tension.",
      "Its excerpt, measured: loudness range (3.0 LU), spectral centroid (900 Hz), centroid spread (200 Hz), onset rate (0.20 a second), low-end share (0.40), stereo width (0.20), spectral flatness (0.01).",
    ]);
  });

  test("says when the sketch hasn't been measured", () => {
    const lines = sketchReading(requireGenome(droneGenome, "drone.json"), null);
    expect(lines.at(-1)).toBe("The sketch hasn't been measured yet, so no features are given.");
  });

  test("gives only the ranged features, and says which weren't measurable", () => {
    const quiet = { raw: { ...FEATURES.raw }, heard: null };
    const [line] = sketchReading(requireGenome(droneGenome, "drone.json"), quiet).slice(-1);
    for (const { feature } of Object.values(TARGET_FEATURES)) expect(line).toContain(feature.label);
    expect(line).not.toMatch(/true peak|loudest 3 s/);
    expect(line).toContain("spectral centroid (none measurable)");
  });

  test("reads every voice type with its description and its choices", () => {
    for (const type of voiceTypeIds()) {
      const voice = /** @type {Record<string, unknown>} */ ({ id: "v", type });
      if (type === "recording") voice.recording = RECORDING;
      const genome = requireGenome(
        { ...droneGenome, voices: [voice] },
        `a genome with one ${type} voice`,
      );
      const [, line] = sketchReading(genome, null);
      const { description, params } = requireVoiceType(type);
      expect(line, type).toMatch(new RegExp(`^Voice v, a ${type} \\[`));
      expect(line, type).toContain(description);
      for (const [name, descriptor] of Object.entries(params)) {
        if (descriptor.kind === "enum")
          expect(line, type).toContain(`${name} ${descriptor.default}`);
      }
      // A recording's hash is no words for anyone; the type's description says what it plays.
      expect(line, type).not.toContain(RECORDING);
    }
  });

  test("says when a voice enters and leaves, and what moves as a trajectory", () => {
    const genome = requireGenome(
      {
        ...droneGenome,
        duration: 300,
        voices: [
          { ...droneGenome.voices[0], id: "late", start: 40 },
          {
            ...droneGenome.voices[0],
            id: "early",
            end: 200,
            level: {
              points: [
                [0, -30],
                [100, -12],
                [200, -40],
              ],
            },
          },
          { ...droneGenome.voices[0], id: "middle", start: 40, end: 200 },
        ],
      },
      "three drones",
    );
    const [, late, early, middle] = sketchReading(genome, null);
    expect(late).toContain("enters (40 s), plays to the end;");
    expect(early).toContain("plays from the start, leaves (200 s);");
    expect(early).toContain(
      "moves: voice level (-30 → -40 dB over 0–200 s, ranging -40 to -12, 3 points); cutoff, low-pass",
    );
    expect(early).toContain("]: plays from the start");
    expect(middle).toContain("enters (40 s), leaves (200 s);");
  });

  test("reads a beat's tempo, an absolute tuning without a key, and globals that move", () => {
    const genome = requireGenome(
      { ...exampleGenome, pulse: "beat", bpm: 72 },
      "example.json with a beat",
    );
    const [piece, moving] = sketchReading(genome, null);
    expect(piece).toBe(
      "Whole piece: duration (300 s), tuning 12-tet, scale dorian, key (2), pulse beat (72 bpm).",
    );
    expect(moving).toBe(
      "Moves across the piece: reverbLevel, reverb wet level (-16 → -15 dB over 0–300 s, ranging -16 to -12, 3 points).",
    );
    const absolute = requireGenome(
      { ...droneGenome, tuning: "colundi", scale: "core36", key: undefined },
      "the drone in colundi",
    );
    expect(sketchReading(absolute, null)[0]).toBe(
      "Whole piece: duration (60 s), tuning colundi, scale core36, pulse none.",
    );
  });

  test("words a macro's value or its motion with the macro's own words", () => {
    const genome = requireGenome(
      {
        ...droneGenome,
        macros: {
          brightness: 0.3,
          motion: {
            points: [
              [0, 0.2],
              [60, 0.8, "smooth"],
            ],
          },
          space: {
            points: [
              [0, 0.6],
              [60, 0.9],
            ],
          },
        },
      },
      "moving macros",
    );
    const macros = sketchReading(genome, null).find((line) => line.startsWith("Macros"));
    expect(macros).toBe(
      "Macros (0.5 is neutral): brightness darker (0.3); motion from stay stiller to move more (0.2 → 0.8 over 0–60 s); space sound more spacious, moving (0.6 → 0.9 over 0–60 s); the rest neutral: density, warmth, tension.",
    );
  });

  test("a sketch's numbers are all in parentheses, so the words read without them", () => {
    const lines = sketchReading(requireGenome(exampleGenome, "example.json"), FEATURES);
    // Names may hold digits (the tuning 12-tet), and so may a type's description in brackets;
    // nothing else outside parentheses does.
    const words = lines
      .join("\n")
      .replace(/\([^()]*\)|\[[^\]]*\]/g, "")
      .replaceAll("12-tet", "");
    expect(words).not.toMatch(/\d/);
  });

  test("a typical sketch is read in full, under its cap", () => {
    const lines = sketchReading(requireGenome(exampleGenome, "example.json"), FEATURES);
    expect(lines.join("\n")).not.toContain("left out");
    expect(tokens(lines.join("\n"))).toBeLessThan(SKETCH_READING_TOKENS / 2);
  });

  test("over its cap, the last voices lose their detail first, then are left out", () => {
    const genome = requireGenome(exampleGenome, "example.json");
    const full = sketchReading(genome, FEATURES);
    const fullTokens = tokens(full.join("\n"));
    const shorter = sketchReading(genome, FEATURES, fullTokens - 1);
    const last = /** @type {string} */ (shorter.at(-3));
    expect(last).toMatch(/^Voice \w+, a \w+: /);
    expect(last).not.toMatch(/\[|→/);
    expect(shorter.slice(0, 3)).toEqual(full.slice(0, 3));

    const tight = sketchReading(genome, FEATURES, 200);
    expect(tight.join("\n")).toMatch(/Left out for room: (one voice|\d+ voices), [\w, -]+\./);
    expect(tight.filter((line) => line.startsWith("Voice ")).length).toBeLessThan(
      genome.voices.length,
    );
    expect(tokens(tight.join("\n"))).toBeLessThanOrEqual(200);
  });

  test("16 voices with every trajectory full stays under the cap", () => {
    const genome = worstGenome();
    const text = sketchReading(genome, FEATURES).join("\n");
    expect(tokens(text)).toBeLessThanOrEqual(SKETCH_READING_TOKENS);
    expect(text).toContain("Whole piece:");
    expect(text).toContain("Its excerpt, measured:");
  });
});

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

test("both readings at their caps leave the develop prompt room within half the context", () => {
  // TD.3's first prompt: the generation prompt's system and brief for a seed-sized vibe, the
  // arc, the section's text, the sketch's genome and two neighbors' states, and both readings.
  const brief = buildPrompt(
    {
      name: "cold dorian drone and pad",
      brief: "b".repeat(600),
      constraints: FULL_CONSTRAINTS,
      ranges: Object.fromEntries(Object.keys(TARGET_FEATURES).map((name) => [name, [0.12, 0.34]])),
    },
    { notes: [], locks: [], examples: [], budgetTokens: Number.MAX_SAFE_INTEGER, recordings: [] },
  );
  const folder = "src/engine/genomes";
  const largestGenome = Math.max(
    ...readdirSync(folder).map((file) =>
      tokens(conciseGenome(JSON.parse(readFileSync(`${folder}/${file}`, "utf8")))),
    ),
  );
  const used =
    tokens(promptText(brief.messages)) +
    tokens("a".repeat(MAX_ARC_CHARS)) +
    tokens("t".repeat(MAX_TEXT_CHARS)) +
    3 * largestGenome +
    SKETCH_READING_TOKENS +
    LINEAGE_READING_TOKENS;
  // What's left is for the develop prompt's own headings and ask.
  expect(example.queue.contextBudgetTokens / 2 - used).toBeGreaterThan(300);
});

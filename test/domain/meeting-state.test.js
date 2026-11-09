// Where a neighbor meets a developed section (decision 0079): the globals a join must match, the
// macros, and each voice sounding there with its values at that moment, under its token cap.
import { expect, test } from "vitest";
import {
  BRIDGE_STATE_TOKENS,
  MEETING_EDGE,
  MEETING_STATE_TOKENS,
  meetingState,
  sounds,
} from "../../src/domain/meeting-state.js";
import { fixedParams } from "../../src/domain/morph-genome.js";
import { exactText } from "../../src/domain/param-text.js";
import { estimateTokens } from "../../src/domain/prompt-tokens.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { voiceParams } from "../../src/engine/voice-registry.js";
import { longSettings, worstGenome } from "../support/worst-genome.js";

/** The drone, a pad that leaves at 40 s and a bell that enters at 40 s, brightness rising. */
const genome = requireGenome(
  {
    ...droneGenome,
    macros: {
      brightness: {
        points: [
          [0, 0.5],
          [60, 0.9],
        ],
      },
      space: 0.5,
    },
    voices: [
      ...droneGenome.voices,
      { id: "pad", type: "pad", level: -14, end: 40 },
      { id: "bell", type: "bell", level: -18, start: 40 },
    ],
  },
  "three voices",
);

test("reads each voice sounding where the sections meet, its moving values as they stand there", () => {
  expect(meetingState(genome, 60, MEETING_EDGE.end)).toEqual([
    "Globals: tuning 12-tet, scale dorian, key 2, pulse none; macros brightness 0.9, the rest neutral.",
    "Voices sounding: drone (drone): level -10 dB, root 37 Hz, cutoff 900 Hz; bell (bell): level -18 dB.",
  ]);
  // At 40 s the pad has just left and the bell just entered: the end edge holds the pad, the
  // start edge the bell.
  expect(meetingState(genome, 40, MEETING_EDGE.end).at(-1)).toMatch(/pad \(pad\)/);
  expect(meetingState(genome, 40, MEETING_EDGE.end).at(-1)).not.toMatch(/bell/);
  expect(meetingState(genome, 40, MEETING_EDGE.start).at(-1)).toMatch(/bell \(bell\)/);
  expect(meetingState(genome, 40, MEETING_EDGE.start).at(-1)).not.toMatch(/pad/);
  expect(meetingState(genome, 0, MEETING_EDGE.start)[0]).toMatch(/macros all neutral\./);
});

test("says when no voice sounds there", () => {
  const silent = requireGenome(
    { ...droneGenome, voices: [{ ...droneGenome.voices[0], end: 20 }] },
    "short voice",
  );
  expect(meetingState(silent, 60, MEETING_EDGE.end).at(-1)).toBe("No voice sounds here.");
});

test("16 voices with every trajectory full stay under the cap, the last named only", () => {
  const lines = meetingState(worstGenome(), 450, MEETING_EDGE.end);
  expect(estimateTokens(lines.join("\n"))).toBeLessThanOrEqual(MEETING_STATE_TOKENS);
  expect(lines[0]).toMatch(/^Globals: /);
  expect(lines.at(-1)).toMatch(/; and [a-z0-9-]+/);
});

/** @param {number} count */
const denseNeighbor = (count) => longSettings(worstGenome(1), count);

/**
 * Every value `checkBridge` compares exactly for the voices sounding at `at`: each voice's id and
 * type, each fixed setting that isn't its default, at every digit.
 * @param {import("../../src/engine/genome-schema.js").Genome} genome
 * @param {number} at
 */
const comparedTexts = (genome, at) =>
  genome.voices
    .filter((voice) => sounds(voice, at, MEETING_EDGE.end))
    .flatMap((voice) => {
      const table = /** @type {Record<string, any>} */ (voiceParams(voice.type));
      const record = /** @type {Record<string, unknown>} */ (voice);
      return [
        `${voice.id} (${voice.type})`,
        ...fixedParams(voice.type)
          .filter((name) => record[name] !== undefined && record[name] !== table[name].default)
          .map((name) =>
            typeof record[name] === "number"
              ? `${name} ${exactText(/** @type {number} */ (record[name]), table[name].unit)}`
              : `${name} ${String(record[name])}`,
          ),
      ];
    });

test("a bridge's state at its cap keeps every value the check compares, cutting the rest first (0082)", () => {
  const genome = denseNeighbor(2);
  const full = meetingState(genome, 450, MEETING_EDGE.end, Number.MAX_SAFE_INTEGER, {
    fixed: true,
  });
  expect(estimateTokens(full.join("\n"))).toBeGreaterThan(BRIDGE_STATE_TOKENS);
  const lines = meetingState(genome, 450, MEETING_EDGE.end, BRIDGE_STATE_TOKENS, { fixed: true });
  const text = lines.join("\n");
  expect(estimateTokens(text)).toBeLessThanOrEqual(BRIDGE_STATE_TOKENS);
  const compared = comparedTexts(genome, 450);
  expect(compared.filter((part) => /\d{12}/.test(part)).length).toBeGreaterThan(10);
  for (const part of compared) expect(text).toContain(part);
  // The join globals are written as the check compares them.
  expect(lines[0]).toContain(`key ${genome.key}, pulse ${genome.pulse} at ${genome.bpm} bpm`);
  // No voice is cut to its id alone: its type is compared too.
  expect(text).not.toMatch(/; and /);
});

test("a bridge's state goes over its cap rather than leave out a value the check compares (0082)", () => {
  const genome = denseNeighbor(16);
  const lines = meetingState(genome, 450, MEETING_EDGE.end, BRIDGE_STATE_TOKENS, { fixed: true });
  const text = lines.join("\n");
  expect(estimateTokens(text)).toBeGreaterThan(BRIDGE_STATE_TOKENS);
  for (const part of comparedTexts(genome, 450)) expect(text).toContain(part);
  // Only what the check compares is left on each voice: no level or moving value.
  expect(text).not.toMatch(/level /);
});

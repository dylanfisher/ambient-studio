// Where a neighbor meets a developed section (decision 0079): the globals a join must match, the
// macros, and each voice sounding there with its values at that moment, under its token cap.
import { expect, test } from "vitest";
import {
  MEETING_EDGE,
  MEETING_STATE_TOKENS,
  meetingState,
} from "../../src/domain/meeting-state.js";
import { estimateTokens } from "../../src/domain/prompt-tokens.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { worstGenome } from "../support/worst-genome.js";

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

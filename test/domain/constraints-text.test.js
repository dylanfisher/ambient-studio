/** @import { Constraints } from "../../src/domain/constraint-schema.js" */
import { describe, expect, test } from "vitest";
import { CONSTRAINT_KINDS } from "../../src/domain/constraint-schema.js";
import { constraintsText } from "../../src/domain/constraints-text.js";
import { validateConstraints } from "../../src/domain/validate-constraints.js";

/** @type {Constraints} */
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

/** One line for each kind, in genome terms, so the model knows which field to set. */
const lines = {
  tuning: /^tuning = 12-tet$/m,
  scale: /^scale = dorian$/m,
  key: /^key = 2$/m,
  pulse: /^pulse = beat$/m,
  bpm: /^bpm from 60 to 90 bpm$/m,
  duration: /^duration from 120 to 240 s$/m,
  loudness: /^loudness = -16 LUFS$/m,
  allowedVoices: /^voice types only drone\|pad\|bell\|granular$/m,
  bannedVoices: /^voice types never noise$/m,
  bellNotes: /^bell density at most 4 \/min, macro offsets included$/m,
  grains: /^granular density at most 10 \/s, macro offsets included$/m,
  padChords: /^pad hold at least 40 s \(at most 1\.5 chords a minute\)$/m,
  brightness: /^macros\.brightness between 0\.3 and 0\.7 \(one number\)$/m,
  cost: /^render cost at most 300; /m,
};

describe("constraintsText", () => {
  test("the full set is valid, so the text describes a set a vibe can hold", () => {
    expect(validateConstraints(full).ok).toBe(true);
  });

  test("names every kind, each on its own line", () => {
    expect(Object.keys(lines).sort()).toEqual(Object.keys(CONSTRAINT_KINDS).sort());
    const text = constraintsText(full);
    for (const pattern of Object.values(lines)) expect(text).toMatch(pattern);
  });

  // A model read "from 0.1 to 0.45 over the whole timeline" as a ramp and wrote a trajectory.
  test("words the brightness range as one number, not a ramp", () => {
    const text = constraintsText(full);
    expect(text).not.toContain("over the whole timeline");
    expect(text).not.toMatch(/macros\.brightness from /);
  });

  test("stays under 800 characters with every kind set", () => {
    expect(constraintsText(full).length).toBeLessThan(800);
  });

  test("leaves out kinds the set doesn't give", () => {
    const text = constraintsText({ loudness: -16 });
    expect(text).toMatch(lines.loudness);
    expect(text).not.toMatch(/tuning|duration/);
  });

  test("says so when the vibe sets no constraint", () => {
    expect(constraintsText({})).toMatch(/no hard constraints/);
  });
});

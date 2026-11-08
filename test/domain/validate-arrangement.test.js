// A track's arrangement (decision 0061): a valid one passes, and each malformed one fails with
// the path of the value it is about. The sketches are given as the server reads them.
/** @import { ArrangementSketch } from "../../src/domain/validate-arrangement.js" */
import { describe, expect, test } from "vitest";
import { arrangementLength } from "../../src/domain/arrangement-length.js";
import {
  emptyArrangement,
  MAX_TRACK_SECONDS,
  TRANSITION_KIND,
  TRANSITION_SECONDS,
} from "../../src/domain/arrangement-schema.js";
import { validateArrangement } from "../../src/domain/validate-arrangement.js";

const VIBE = 1;

/** Sketches 1 and 2 are live sketches of vibe 1, 60 s and 300 s long. */
const SKETCHES = new Map(
  /** @type {[number, ArrangementSketch][]} */ ([
    [1, { vibeId: VIBE, removedReason: null, duration: 60 }],
    [2, { vibeId: VIBE, removedReason: null, duration: 300 }],
    [3, { vibeId: VIBE, removedReason: "removed", duration: 60 }],
    [4, { vibeId: 2, removedReason: null, duration: 60 }],
  ]),
);
const context = { vibeId: VIBE, sketch: (/** @type {number} */ id) => SKETCHES.get(id) };

/** Three sections with two crossfades: 40 + 200 + 50 less 8 + 10. */
const VALID = Object.freeze({
  length: null,
  arc: null,
  sections: [
    { sketchId: 1, offset: 10, seconds: 40 },
    { sketchId: 2, offset: 0, seconds: 200 },
    { sketchId: 1, offset: 0, seconds: 50 },
  ],
  transitions: [
    { kind: "crossfade", seconds: 8 },
    { kind: "crossfade", seconds: 10 },
  ],
  lanes: [],
  proposal: null,
});

/** @param {unknown} value */
function errorsOf(value) {
  const result = validateArrangement(value, context);
  if (result.ok) throw new Error("expected errors, got a valid arrangement");
  return result.errors;
}

/**
 * The arrangement with its parts changed.
 * @param {(copy: any) => void} change
 */
function changed(change) {
  const copy = structuredClone(VALID);
  change(copy);
  return copy;
}

describe("validateArrangement", () => {
  test("a valid arrangement comes back as given", () => {
    expect(validateArrangement(VALID, context)).toEqual({ ok: true, arrangement: VALID });
  });

  test("a new track's empty arrangement is valid, with the owner's length and arc", () => {
    expect(validateArrangement(emptyArrangement(), context).ok).toBe(true);
    const aimed = { ...VALID, length: 600, arc: "emerge, plateau, dissolve", proposal: 12 };
    expect(validateArrangement(aimed, context).ok).toBe(true);
  });

  test("a crossfade's default is 8 s", () => {
    expect(TRANSITION_KIND.crossfade).toBe("crossfade");
    expect(TRANSITION_SECONDS.default).toBe(8);
  });

  test("a morph with its curve passes, and its length counts as a crossfade's", () => {
    const morphed = changed(
      (a) => (a.transitions[1] = { kind: "morph", seconds: 10, curve: "late" }),
    );
    expect(TRANSITION_KIND.morph).toBe("morph");
    expect(validateArrangement(morphed, context)).toEqual({ ok: true, arrangement: morphed });
    expect(arrangementLength(morphed)).toBe(arrangementLength(VALID));
  });

  /** @type {[string, (copy: any) => void, string, RegExp][]} */
  const refused = [
    [
      "an unknown sketch",
      (a) => (a.sections[1].sketchId = 99),
      "$.sections[1].sketchId",
      /no sketch 99/,
    ],
    [
      "a removed sketch",
      (a) => (a.sections[0].sketchId = 3),
      "$.sections[0].sketchId",
      /sketch 3 was removed/,
    ],
    [
      "a sketch of another vibe",
      (a) => (a.sections[2].sketchId = 4),
      "$.sections[2].sketchId",
      /another vibe/,
    ],
    [
      "a sketch id that isn't one",
      (a) => (a.sections[0].sketchId = "1"),
      "$.sections[0].sketchId",
      /whole number/,
    ],
    [
      "a transition longer than half a section",
      (a) => (a.transitions[0].seconds = 21),
      "$.transitions[0].seconds",
      /at most half the shorter of its two sections, 20 s/,
    ],
    [
      "an offset past the sketch's end",
      (a) => (a.sections[0].offset = 60),
      "$.sections[0].offset",
      /under its sketch's 60 s/,
    ],
    [
      "a negative offset",
      (a) => (a.sections[0].offset = -1),
      "$.sections[0].offset",
      /must be from 0/,
    ],
    [
      "a section past 900 s on its sketch's timeline",
      (a) => {
        a.sections[1].offset = 250;
        a.sections[1].seconds = 651;
      },
      "$.sections[1].seconds",
      /ends at 901 s/,
    ],
    [
      "a section too short",
      (a) => (a.sections[0].seconds = 5),
      "$.sections[0].seconds",
      /must be from 10/,
    ],
    [
      "a missing transition",
      (a) => a.transitions.pop(),
      "$.transitions",
      /2 transitions for 3 sections, got 1/,
    ],
    [
      "an unknown transition kind",
      (a) => (a.transitions[1].kind = "cut"),
      "$.transitions[1].kind",
      /"crossfade"/,
    ],
    [
      "a transition with no seconds",
      (a) => delete a.transitions[1].seconds,
      "$.transitions[1].seconds",
      /missing/,
    ],
    [
      "a morph with no curve",
      (a) => (a.transitions[1] = { kind: "morph", seconds: 10 }),
      "$.transitions[1].curve",
      /missing/,
    ],
    [
      "a morph with an unknown curve",
      (a) => (a.transitions[1] = { kind: "morph", seconds: 10, curve: "steep" }),
      "$.transitions[1].curve",
      /"smooth"/,
    ],
    [
      "a curve on a crossfade",
      (a) => (a.transitions[1].curve = "smooth"),
      "$.transitions[1].curve",
      /unknown key/,
    ],
    [
      "a morph too short to move before it hands over",
      (a) => (a.transitions[1] = { kind: "morph", seconds: 7, curve: "linear" }),
      "$.transitions[1].seconds",
      /a morph must be at least 8 s/,
    ],
    ["an unknown key", (a) => (a.tempo = 90), "$.tempo", /unknown key/],
    [
      "an unknown section key",
      (a) => (a.sections[0].gain = 1),
      "$.sections[0].gain",
      /unknown key/,
    ],
    ["a missing key", (a) => delete a.lanes, "$.lanes", /missing/],
    ["lanes before 6f", (a) => (a.lanes = [{}]), "$.lanes", /empty/],
    ["a length outside 3 to 20 minutes", (a) => (a.length = 100), "$.length", /must be from 180/],
    ["an arc on two lines", (a) => (a.arc = "rise\nfall"), "$.arc", /one line/],
    ["a proposal that isn't an id", (a) => (a.proposal = 0), "$.proposal", /generation id or null/],
    ["sections not a list", (a) => (a.sections = {}), "$.sections", /must be a list/],
  ];

  test.each(refused)("%s fails at its path", (_, change, path, message) => {
    const errors = errorsOf(changed(change));
    expect(errors.map((error) => error.path)).toContain(path);
    expect(errors.find((error) => error.path === path)?.message).toMatch(message);
  });

  test("a track over 20 minutes fails at its sections", () => {
    const long = changed((a) => {
      a.sections = [1, 2, 3].map(() => ({ sketchId: 2, offset: 0, seconds: 450 }));
      a.transitions = [1, 2].map(() => ({ kind: "crossfade", seconds: 8 }));
    });
    expect(errorsOf(long)).toEqual([
      {
        path: "$.sections",
        message: `the track would be 1334 s; a track is at most ${MAX_TRACK_SECONDS} s`,
      },
    ]);
  });

  test("not an object fails at the root", () => {
    expect(errorsOf([])).toEqual([{ path: "$", message: "must be an object, got []" }]);
  });
});

describe("arrangementLength", () => {
  test("is the sections' sum less the overlaps", () => {
    expect(arrangementLength(VALID)).toBe(40 + 200 + 50 - 8 - 10);
    expect(arrangementLength(emptyArrangement())).toBe(0);
  });
});

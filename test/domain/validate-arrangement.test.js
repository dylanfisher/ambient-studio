// A track's arrangement (decision 0061): a valid one passes, and each malformed one fails with
// the path of the value it is about. The sketches are given as the server reads them.
/** @import { ArrangementSketch } from "../../src/domain/validate-arrangement.js" */
import { describe, expect, test } from "vitest";
import { arrangementLength } from "../../src/domain/arrangement-length.js";
import {
  emptyArrangement,
  MAX_TEXT_CHARS,
  MAX_TRACK_SECONDS,
  TRANSITION_KIND,
  TRANSITION_SECONDS,
} from "../../src/domain/arrangement-schema.js";
import { LANE_MOST_POINTS } from "../../src/domain/lane-schema.js";
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
    { sketchId: 1, offset: 10, seconds: 40, text: "" },
    { sketchId: 2, offset: 0, seconds: 200, text: "a long slow swell, nothing new comes in" },
    { sketchId: 1, offset: 0, seconds: 50, text: "" },
  ],
  transitions: [
    { kind: "crossfade", seconds: 8, text: "" },
    { kind: "crossfade", seconds: 10, text: "the swell falls away under the return" },
  ],
  lanes: [],
  proposal: null,
});

/** A brightness lane: up from no change, then down past the first section. */
const LANE = Object.freeze({
  macro: "brightness",
  points: [
    [0, 0],
    [30, 0.25, "smooth"],
    [100, -0.5, "linear"],
  ],
});

/**
 * A change to a copy of `LANE`, as the arrangement's one lane.
 * @param {(lane: any) => void} change
 * @returns {(copy: any) => void}
 */
const withLane = (change) => (copy) => {
  copy.lanes = [structuredClone(LANE)];
  change(copy.lanes[0]);
};

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

  test("macro lanes pass, one per macro, empty or with breakpoints in track seconds", () => {
    const laned = changed((a) => (a.lanes = [LANE, { macro: "tension", points: [] }]));
    expect(validateArrangement(laned, context)).toEqual({ ok: true, arrangement: laned });
  });

  test("text of up to 300 characters passes, on more than one line", () => {
    expect(MAX_TEXT_CHARS).toBe(300);
    const written = changed((a) => {
      a.sections[0].text = "x".repeat(MAX_TEXT_CHARS);
      a.transitions[0].text = "first the hiss thins\nthen the bell comes in";
    });
    expect(validateArrangement(written, context)).toEqual({ ok: true, arrangement: written });
  });

  test("a crossfade's default is 8 s", () => {
    expect(TRANSITION_KIND.crossfade).toBe("crossfade");
    expect(TRANSITION_SECONDS.default).toBe(8);
  });

  test("a morph with its curve passes, and its length counts as a crossfade's", () => {
    const morphed = changed(
      (a) => (a.transitions[1] = { kind: "morph", seconds: 10, curve: "late", text: "" }),
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
      (a) => (a.transitions[1] = { kind: "morph", seconds: 10, text: "" }),
      "$.transitions[1].curve",
      /missing/,
    ],
    [
      "a morph with an unknown curve",
      (a) => (a.transitions[1] = { kind: "morph", seconds: 10, curve: "steep", text: "" }),
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
      (a) => (a.transitions[1] = { kind: "morph", seconds: 7, curve: "linear", text: "" }),
      "$.transitions[1].seconds",
      /a morph must be at least 8 s/,
    ],
    ["a section with no text", (a) => delete a.sections[1].text, "$.sections[1].text", /missing/],
    [
      "a section's text that isn't text",
      (a) => (a.sections[0].text = 5),
      "$.sections[0].text",
      /must be text, got 5/,
    ],
    [
      "a section's text too long",
      (a) => (a.sections[2].text = "a".repeat(MAX_TEXT_CHARS + 1)),
      "$.sections[2].text",
      /at most 300 characters, got 301/,
    ],
    [
      "a transition with no text",
      (a) => delete a.transitions[0].text,
      "$.transitions[0].text",
      /missing/,
    ],
    [
      "a morph with no text",
      (a) => (a.transitions[1] = { kind: "morph", seconds: 10, curve: "linear" }),
      "$.transitions[1].text",
      /missing/,
    ],
    [
      "a transition's text that isn't text",
      (a) => (a.transitions[1].text = null),
      "$.transitions[1].text",
      /must be text, got null/,
    ],
    [
      "a transition's text too long",
      (a) => (a.transitions[0].text = "b".repeat(MAX_TEXT_CHARS + 1)),
      "$.transitions[0].text",
      /at most 300 characters/,
    ],
    ["an unknown key", (a) => (a.tempo = 90), "$.tempo", /unknown key/],
    [
      "an unknown section key",
      (a) => (a.sections[0].gain = 1),
      "$.sections[0].gain",
      /unknown key/,
    ],
    ["a missing key", (a) => delete a.lanes, "$.lanes", /missing/],
    ["lanes not a list", (a) => (a.lanes = {}), "$.lanes", /must be a list/],
    ["a lane not an object", (a) => (a.lanes = [3]), "$.lanes[0]", /must be an object/],
    [
      "a lane of an unknown macro",
      (a) => (a.lanes = [{ macro: "loudness", points: [] }]),
      "$.lanes[0].macro",
      /"brightness"/,
    ],
    [
      "two lanes of one macro",
      (a) => (a.lanes = [LANE, structuredClone(LANE)]),
      "$.lanes[1].macro",
      /one lane per macro/,
    ],
    [
      "a lane with no points key",
      (a) => (a.lanes = [{ macro: "density" }]),
      "$.lanes[0].points",
      /missing/,
    ],
    [
      "an unknown lane key",
      (a) => (a.lanes = [{ ...LANE, curve: "smooth" }]),
      "$.lanes[0].curve",
      /unknown key/,
    ],
    [
      "a lane over its points",
      (a) =>
        (a.lanes = [
          {
            macro: "density",
            points: Array.from({ length: LANE_MOST_POINTS + 1 }, (_, i) =>
              i === 0 ? [0, 0] : [i, 0, "linear"],
            ),
          },
        ]),
      "$.lanes[0].points",
      new RegExp(`at most ${LANE_MOST_POINTS} points`),
    ],
    [
      "an offset past a half",
      (a) => (a.lanes = [{ macro: "density", points: [[0, 0.6]] }]),
      "$.lanes[0].points[0][1]",
      /must be from -0.5 to 0.5/,
    ],
    [
      "lane times that don't rise",
      withLane((lane) => (lane.points[1][0] = 0)),
      "$.lanes[0].points[1][0]",
      /must rise/,
    ],
    [
      "a lane time past the longest track",
      withLane((lane) => (lane.points[1][0] = MAX_TRACK_SECONDS + 1)),
      "$.lanes[0].points[1][0]",
      /from 0 to 1200/,
    ],
    [
      "a curve on a lane's first point",
      withLane((lane) => (lane.points[0] = [0, 0, "linear"])),
      "$.lanes[0].points[0][2]",
      /first point/,
    ],
    [
      "a later lane point with no curve",
      withLane((lane) => (lane.points[1] = [30, 0.2])),
      "$.lanes[0].points[1]",
      /\[seconds, offset, curve\]/,
    ],
    [
      "a lane point with an unknown curve",
      withLane((lane) => (lane.points[1][2] = "steep")),
      "$.lanes[0].points[1][2]",
      /"smooth"/,
    ],
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
      a.sections = [1, 2, 3].map(() => ({ sketchId: 2, offset: 0, seconds: 450, text: "" }));
      a.transitions = [1, 2].map(() => ({ kind: "crossfade", seconds: 8, text: "" }));
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

// The track page in words (decision 0087), with no DOM: what the timeline leads with, each
// section's and transition's words and development; a lane and a section's play in words; and
// what a words answer changed, said from templates.
/** @import { Arrangement } from "../../src/domain/arrangement-schema.js" */
import { expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import { laneField } from "../../src/domain/track-words.js";
import { WORDS_SETS } from "../../src/domain/words-sets.js";
import { developedText } from "../../src/web/develop-text.js";
import { laneWords } from "../../src/web/lane-layout.js";
import { playsWords } from "../../src/web/timeline-layout.js";
import { timelineWords, trackChangeLines } from "../../src/web/track-words-text.js";
import { transitionWords } from "../../src/web/transition-text.js";

const TRACK = /** @type {Arrangement} */ (
  Object.freeze({
    ...emptyArrangement(),
    sections: [
      { sketchId: 1, offset: 0, seconds: 120, text: "dark start", developmentId: null },
      { sketchId: 2, offset: 0, seconds: 120, text: "", developmentId: 7 },
    ],
    transitions: [{ kind: "morph", seconds: 20, curve: "smooth", text: "melt" }],
  })
);

const sketches = [
  { id: 1, intent: "low drone", duration: 300 },
  { id: 2, intent: null, duration: 300 },
];
const developments = [
  { id: 7, sketchId: 2, text: "bells come in", seconds: 120, bridge: false, createdAt: 0 },
];

test("the timeline leads with each section's words and development, and each join's", () => {
  const items = timelineWords(
    TRACK,
    (id) => sketches.find((sketch) => sketch.id === id),
    (id) => developments.find((development) => development.id === id),
  );
  expect(items).toEqual([
    "Section 1: Sketch 1: low drone. Your words: “dark start”. It plays its sketch as it is.",
    "Then section 1 morphs into section 2, easing in and out. Your words: “melt”.",
    `Section 2: Sketch 2, developed. No words for it yet. ${developedText(/** @type {any} */ (developments[0]))}`,
  ]);
});

test("a transition says its kind and curve in words, with no seconds", () => {
  expect(transitionWords(0, { kind: "crossfade", seconds: 8, text: "" })).toBe(
    "section 1 crossfades into section 2",
  );
  expect(transitionWords(2, { kind: "weave", seconds: 30, curve: "late", text: "" })).toBe(
    "section 3 weaves into section 4, most of the change near the end",
  );
});

test("a section says where it plays from in words; a developed one from its development", () => {
  const sketch = { id: 1, intent: null, duration: 100 };
  const base = { sketchId: 1, offset: 0, seconds: 60, text: "", developmentId: null };
  expect(playsWords(base, sketch)).toBe("It plays its sketch from the start.");
  expect(playsWords({ ...base, offset: 30, seconds: 90 }, sketch)).toBe(
    "It plays its sketch from partway in, and runs past its end, which extends it.",
  );
  expect(playsWords({ ...base, developmentId: 3 }, sketch, { seconds: 60, bridge: false })).toBe(
    "It plays its development from the start.",
  );
  expect(playsWords({ ...base, developmentId: 3 }, sketch, { seconds: 60, bridge: true })).toBe(
    "It plays its bridge from the start.",
  );
});

test("a lane is said by its points' times and directions, with no offsets", () => {
  expect(laneWords("brightness", [])).toBe("Brightness: each section plays its own brightness.");
  expect(
    laneWords("brightness", [
      [480, 0],
      [540, -0.1, "linear"],
      [600, -0.4, "linear"],
    ]),
  ).toBe(
    "Brightness: as each section has it at 8:00, darker by a little at 9:00, darker by a lot at 10:00.",
  );
  expect(laneWords("space", [[60, 0.25]])).toBe("Space: sound more spacious at 1:00.");
});

test("each answer's change is said in words", () => {
  const length = WORDS_SETS.length.apply({ arrangement: TRACK, target: 0 }, { seconds: 200 });
  expect(trackChangeLines("length", TRACK, 0, length)).toEqual([
    "Section 1 plays for 3:20 instead of 2:00.",
  ]);
  const fade = WORDS_SETS.transition.apply(
    { arrangement: TRACK, target: 0 },
    { kind: "crossfade", seconds: 8 },
  );
  expect(trackChangeLines("transition", TRACK, 0, fade)).toEqual([
    "Section 1 crossfades into section 2, instead of morphing.",
    "The two overlap for 0:08 instead of 0:20.",
  ]);
  const laned = {
    ...TRACK,
    lanes: [
      {
        macro: /** @type {const} */ ("brightness"),
        points: /** @type {any} */ ([
          [100, 0.2],
          [130, 0.3, "smooth"],
        ]),
      },
    ],
  };
  const lane = WORDS_SETS.lane.apply(
    { arrangement: laned, target: "brightness" },
    { [laneField(120)]: -0.4 },
  );
  expect(trackChangeLines("lane", laned, "brightness", lane)).toEqual([
    "Brightness: brighter at 1:30, darker by a lot at 2:00, brighter at 2:30.",
    "Replaces your point at 1:40.",
    "Replaces your point at 2:10.",
  ]);
  const same = WORDS_SETS.length.apply({ arrangement: TRACK, target: 0 }, {});
  expect(trackChangeLines("length", TRACK, 0, same)).toEqual([]);
});

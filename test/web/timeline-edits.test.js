// The timeline's edits (decision 0061), with no DOM: each action a key and a button run makes
// a new arrangement and leaves the one it was given as it was.
import { expect, test } from "vitest";
import { emptyArrangement, MORPH_CURVE } from "../../src/domain/arrangement-schema.js";
import { CURVES } from "../../src/engine/trajectory.js";
import {
  addSection,
  dragEdge,
  moveSection,
  nextCurve,
  removeSection,
  SECTION_STEP,
  setSection,
  setSectionText,
  setTransition,
  setTransitionText,
  stepSection,
  stepTransition,
  toggleMorph,
  transitionOf,
} from "../../src/web/timeline-edits.js";

const THREE = Object.freeze({
  ...emptyArrangement(),
  sections: [
    { sketchId: 1, offset: 0, seconds: 40, text: "" },
    { sketchId: 2, offset: 10, seconds: 60, text: "the bell comes forward" },
    { sketchId: 3, offset: 0, seconds: 30, text: "" },
  ],
  transitions: [
    { kind: "crossfade", seconds: 8, text: "" },
    { kind: "crossfade", seconds: 5, text: "hold the hiss through the join" },
  ],
});
const frozen = structuredClone(THREE);

test("adding a sketch places it after the chosen section, with a default crossfade and no text", () => {
  const first = addSection(emptyArrangement(), { id: 4, duration: 300 }, null);
  expect(first).toEqual({
    arrangement: {
      ...emptyArrangement(),
      sections: [{ sketchId: 4, offset: 0, seconds: 120, text: "" }],
    },
    index: 0,
  });
  const { arrangement, index } = addSection(THREE, { id: 5, duration: 12 }, 0);
  expect(index).toBe(1);
  expect(arrangement.sections.map((s) => s.sketchId)).toEqual([1, 5, 2, 3]);
  expect(arrangement.sections[1]).toEqual({ sketchId: 5, offset: 0, seconds: 12, text: "" });
  expect(arrangement.transitions[0]).toEqual({ kind: "crossfade", seconds: 6, text: "" });
  // The new crossfade, between sketch 1 and the new section, is at most half the 12 s section.
  // The 8 s one now between the new section and sketch 2 is left as it was.
  expect(arrangement.transitions.map((t) => t.seconds)).toEqual([6, 8, 5]);
  expect(THREE).toEqual(frozen);
});

test("removing a section takes its crossfade with it", () => {
  expect(removeSection(THREE, 1).sections.map((s) => s.sketchId)).toEqual([1, 3]);
  expect(removeSection(THREE, 1).transitions.map((t) => t.seconds)).toEqual([8]);
  expect(removeSection(THREE, 0).transitions.map((t) => t.seconds)).toEqual([5]);
  expect(removeSection(THREE, 2).transitions.map((t) => t.seconds)).toEqual([8]);
  expect(removeSection(removeSection(removeSection(THREE, 0), 0), 0)).toEqual(emptyArrangement());
});

test("moving a section swaps it with its neighbor, and stops at the ends", () => {
  const moved = moveSection(THREE, 0, 1);
  expect(moved.index).toBe(1);
  expect(moved.arrangement.sections.map((s) => s.sketchId)).toEqual([2, 1, 3]);
  expect(moved.arrangement.transitions).toEqual(THREE.transitions);
  expect(moveSection(THREE, 0, -1)).toEqual({ arrangement: THREE, index: 0 });
  expect(moveSection(THREE, 2, 1)).toEqual({ arrangement: THREE, index: 2 });
});

test("a section's seconds and offset step, and are set by fields, never under their least", () => {
  expect(stepSection(THREE, 1, "seconds", 1).sections[1]).toEqual({
    sketchId: 2,
    offset: 10,
    seconds: 60 + SECTION_STEP,
    text: "the bell comes forward",
  });
  expect(stepSection(THREE, 1, "offset", -1).sections[1]?.offset).toBe(0);
  expect(stepSection(THREE, 1, "offset", -2).sections[1]?.offset).toBe(0);
  expect(stepSection(THREE, 2, "seconds", -3).sections[2]?.seconds).toBe(10);
  expect(setSection(THREE, 0, { offset: 5, seconds: 25 }).sections[0]).toEqual({
    sketchId: 1,
    offset: 5,
    seconds: 25,
    text: "",
  });
  expect(THREE).toEqual(frozen);
});

test("dragging the end edge changes the seconds; the start edge moves the start and keeps the end", () => {
  expect(dragEdge(THREE, 1, "end", 12.5).sections[1]).toEqual({
    sketchId: 2,
    offset: 10,
    seconds: 72.5,
    text: "the bell comes forward",
  });
  expect(dragEdge(THREE, 1, "start", 4).sections[1]).toEqual({
    sketchId: 2,
    offset: 14,
    seconds: 56,
    text: "the bell comes forward",
  });
  // Back past the sketch's start stops at 0 s.
  expect(dragEdge(THREE, 1, "start", -15).sections[1]).toEqual({
    sketchId: 2,
    offset: 0,
    seconds: 70,
    text: "the bell comes forward",
  });
});

test("the selected section's crossfade is the one after it, or before the last", () => {
  expect(transitionOf(THREE, 0)).toBe(0);
  expect(transitionOf(THREE, 2)).toBe(1);
  expect(transitionOf({ ...THREE, transitions: [] }, 0)).toBeNull();
  expect(stepTransition(THREE, 1, 1).transitions[1]?.seconds).toBe(6);
  expect(stepTransition(THREE, 1, -10).transitions[1]?.seconds).toBe(1);
  expect(setTransition(THREE, 0, 12).transitions[0]).toEqual({
    kind: "crossfade",
    seconds: 12,
    text: "",
  });
});

test("a transition turns into a morph with the default curve and back, keeping its seconds and text", () => {
  const morphed = toggleMorph(THREE, 1);
  expect(morphed.transitions).toEqual([
    { kind: "crossfade", seconds: 8, text: "" },
    { kind: "morph", seconds: 5, curve: MORPH_CURVE, text: "hold the hiss through the join" },
  ]);
  expect(toggleMorph(morphed, 1)).toEqual(THREE);
  expect(setTransition(morphed, 1, 9).transitions[1]).toEqual({
    kind: "morph",
    seconds: 9,
    curve: MORPH_CURVE,
    text: "hold the hiss through the join",
  });
});

test("a morph's curve steps through 0007's curves in order, and a crossfade has none", () => {
  const names = Object.keys(CURVES);
  let arrangement = toggleMorph(THREE, 0);
  const seen = [];
  for (const _ of names) {
    arrangement = nextCurve(arrangement, 0);
    seen.push(arrangement.transitions[0]?.curve);
  }
  const from = names.indexOf(MORPH_CURVE);
  expect(seen).toEqual(names.map((_, i) => names[(from + 1 + i) % names.length]));
  expect(nextCurve(THREE, 0)).toEqual(THREE);
});

test("a section's text and its transition's text are set as typed, and change nothing else", () => {
  const written = setSectionText(THREE, 0, "only the low drone, very quiet");
  expect(written.sections).toEqual([
    { ...THREE.sections[0], text: "only the low drone, very quiet" },
    THREE.sections[1],
    THREE.sections[2],
  ]);
  expect(written.transitions).toBe(THREE.transitions);
  expect(setSectionText(THREE, 1, "").sections[1]?.text).toBe("");
  const joined = setTransitionText(THREE, 1, "let the bell ring out over the start");
  expect(joined.transitions).toEqual([
    THREE.transitions[0],
    { kind: "crossfade", seconds: 5, text: "let the bell ring out over the start" },
  ]);
  expect(joined.sections).toBe(THREE.sections);
  expect(THREE).toEqual(frozen);
});

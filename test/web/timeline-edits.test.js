// The timeline's edits (decision 0061), with no DOM: each action a key and a button run makes
// a new arrangement and leaves the one it was given as it was.
import { expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import {
  addSection,
  dragEdge,
  moveSection,
  removeSection,
  SECTION_STEP,
  setSection,
  setTransition,
  stepSection,
  stepTransition,
  transitionOf,
} from "../../src/web/timeline-edits.js";

const THREE = Object.freeze({
  ...emptyArrangement(),
  sections: [
    { sketchId: 1, offset: 0, seconds: 40 },
    { sketchId: 2, offset: 10, seconds: 60 },
    { sketchId: 3, offset: 0, seconds: 30 },
  ],
  transitions: [
    { kind: "crossfade", seconds: 8 },
    { kind: "crossfade", seconds: 5 },
  ],
});
const frozen = structuredClone(THREE);

test("adding a sketch places it after the chosen section, with a default crossfade", () => {
  const first = addSection(emptyArrangement(), { id: 4, duration: 300 }, null);
  expect(first).toEqual({
    arrangement: { ...emptyArrangement(), sections: [{ sketchId: 4, offset: 0, seconds: 120 }] },
    index: 0,
  });
  const { arrangement, index } = addSection(THREE, { id: 5, duration: 12 }, 0);
  expect(index).toBe(1);
  expect(arrangement.sections.map((s) => s.sketchId)).toEqual([1, 5, 2, 3]);
  expect(arrangement.sections[1]).toEqual({ sketchId: 5, offset: 0, seconds: 12 });
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
  });
  expect(stepSection(THREE, 1, "offset", -1).sections[1]?.offset).toBe(0);
  expect(stepSection(THREE, 1, "offset", -2).sections[1]?.offset).toBe(0);
  expect(stepSection(THREE, 2, "seconds", -3).sections[2]?.seconds).toBe(10);
  expect(setSection(THREE, 0, { offset: 5, seconds: 25 }).sections[0]).toEqual({
    sketchId: 1,
    offset: 5,
    seconds: 25,
  });
  expect(THREE).toEqual(frozen);
});

test("dragging the end edge changes the seconds; the start edge moves the start and keeps the end", () => {
  expect(dragEdge(THREE, 1, "end", 12.5).sections[1]).toEqual({
    sketchId: 2,
    offset: 10,
    seconds: 72.5,
  });
  expect(dragEdge(THREE, 1, "start", 4).sections[1]).toEqual({
    sketchId: 2,
    offset: 14,
    seconds: 56,
  });
  // Back past the sketch's start stops at 0 s.
  expect(dragEdge(THREE, 1, "start", -15).sections[1]).toEqual({
    sketchId: 2,
    offset: 0,
    seconds: 70,
  });
});

test("the selected section's crossfade is the one after it, or before the last", () => {
  expect(transitionOf(THREE, 0)).toBe(0);
  expect(transitionOf(THREE, 2)).toBe(1);
  expect(transitionOf({ ...THREE, transitions: [] }, 0)).toBeNull();
  expect(stepTransition(THREE, 1, 1).transitions[1]?.seconds).toBe(6);
  expect(stepTransition(THREE, 1, -10).transitions[1]?.seconds).toBe(1);
  expect(setTransition(THREE, 0, 12).transitions[0]).toEqual({ kind: "crossfade", seconds: 12 });
});

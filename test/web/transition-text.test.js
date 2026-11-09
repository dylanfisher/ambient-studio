// What the timeline says of the chosen transition (decision 0064): a crossfade, a morph and its
// curve, or a morph that plays as a crossfade and why.
import { expect, test } from "vitest";
import { curveWords, kindButtonWords, transitionText } from "../../src/web/transition-text.js";

test("a crossfade names its two sections", () => {
  expect(transitionText(0, { kind: "crossfade", seconds: 8, text: "" }, null)).toBe(
    "The crossfade from section 1 into section 2.",
  );
});

test("a morph says how long its sounds move, along which curve, and when the next takes over", () => {
  const morph = { kind: "morph", seconds: 20, curve: "smooth", text: "" };
  expect(transitionText(1, morph, { ok: true })).toBe(
    "Section 2 morphs into section 3 along the smooth curve, easing in and out: its sounds move toward section 3's for 16 s, then section 3 takes over in the last 4 s.",
  );
  expect(transitionText(1, { ...morph, curve: "early" }, null)).toContain(
    "along the early curve, most of the change near the start",
  );
});

test("a morph too short says how long it must be, whatever else the timeline knows", () => {
  expect(transitionText(0, { kind: "morph", seconds: 5, curve: "smooth", text: "" }, null)).toBe(
    "A morph needs at least 8 s: its sounds move, then section 2 takes over in the last 4 s. Make this one 3 s longer, or make it a crossfade again.",
  );
});

test("a curve's button names its shape in plain words", () => {
  expect(curveWords("late")).toBe("most of the change near the end");
});

test("a weave says its sounds hand over one at a time, and in what order", () => {
  const weave = { kind: "weave", seconds: 12, curve: "smooth", text: "" };
  const general =
    "Section 1 weaves into section 2 along the smooth curve, easing in and out: for 8 s the sounds both play move toward section 2's, while the others hand over one at a time, section 1's leaving from the highest down as section 2's come in from the lowest up; then section 2 takes over in the last 4 s.";
  expect(transitionText(0, weave, null)).toBe(general);
  const order = [
    { id: "bell", leaves: true, from: 0, to: 1 },
    { id: "pad", leaves: true, from: 0, to: 1 },
    { id: "pad--in", leaves: false, from: 0, to: 1 },
    { id: "cloud", leaves: false, from: 0, to: 1 },
  ];
  expect(transitionText(0, weave, { ok: true, order })).toBe(
    `${general} Leaving: bell, then pad. Coming in: pad, then cloud.`,
  );
  expect(transitionText(0, weave, { ok: true, order: order.slice(2) })).toBe(
    `${general} Coming in: pad, then cloud.`,
  );
  expect(transitionText(0, weave, { ok: true, order: [] })).toBe(
    `${general} No sound hands over on its own here, so it plays as a morph would.`,
  );
});

test("a weave too short, or one that can't hold, says so as a morph does", () => {
  expect(transitionText(1, { kind: "weave", seconds: 6, curve: "late", text: "" }, null)).toBe(
    "A weave needs at least 8 s: its sounds hand over, then section 3 takes over in the last 4 s. Make this one 2 s longer, or make it a crossfade.",
  );
  expect(
    transitionText(
      0,
      { kind: "weave", seconds: 10, curve: "linear", text: "" },
      {
        ok: false,
        reason: "the two sketches have different keys (2, 9), which a weave can't move between",
      },
    ),
  ).toBe(
    "Section 1 plays into section 2 as a crossfade, not a weave: the two sketches have different keys (2, 9), which a weave can't move between.",
  );
});

test("the kind button names the kind M steps to next", () => {
  expect(["crossfade", "morph", "weave"].map(kindButtonWords)).toEqual([
    "Make it a morph",
    "Make it a weave",
    "Make it a crossfade",
  ]);
});

test("a morph that can't hold says it plays as a crossfade, and why", () => {
  expect(
    transitionText(
      0,
      { kind: "morph", seconds: 10, curve: "linear", text: "" },
      { ok: false, reason: "the two sketches have different keys (2, 9)" },
    ),
  ).toBe(
    "Section 1 plays into section 2 as a crossfade, not a morph: the two sketches have different keys (2, 9).",
  );
});

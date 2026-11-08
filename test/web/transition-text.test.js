// What the timeline says of the chosen transition (decision 0064): a crossfade, a morph and its
// curve, or a morph that plays as a crossfade and why.
import { expect, test } from "vitest";
import { transitionText } from "../../src/web/transition-text.js";

test("a crossfade names its two sections", () => {
  expect(transitionText(0, { kind: "crossfade", seconds: 8 }, null)).toBe(
    "The crossfade from section 1 into section 2.",
  );
});

test("a morph says how long its sounds move, along which curve, and when the next takes over", () => {
  const morph = { kind: "morph", seconds: 20, curve: "smooth" };
  expect(transitionText(1, morph, { ok: true })).toBe(
    "Section 2 morphs into section 3 along the smooth curve, easing in and out: its sounds move toward section 3's for 16 s, then section 3 takes over in the last 4 s.",
  );
  expect(transitionText(1, { ...morph, curve: "early" }, null)).toContain(
    "along the early curve, most of the change near the start",
  );
});

test("a morph that can't hold says it plays as a crossfade, and why", () => {
  expect(
    transitionText(
      0,
      { kind: "morph", seconds: 10, curve: "linear" },
      { ok: false, reason: "the two sketches have different keys (2, 9)" },
    ),
  ).toBe(
    "Section 1 plays into section 2 as a crossfade, not a morph: the two sketches have different keys (2, 9).",
  );
});

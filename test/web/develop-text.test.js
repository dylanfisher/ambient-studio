// Developing a section on the timeline (decision 0079): the confirm, why the button is off, what
// a developed section says, and where a finished development goes when the timeline changed or
// another version was opened during the run (0066's rules).
import { expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import {
  developCostText,
  developedText,
  developRefusal,
  developSwap,
} from "../../src/web/develop-text.js";
import { SWAP } from "../../src/web/material-actions.js";

test("the confirm states the requests, what the model reads and their time", () => {
  const text = developCostText(1, 240, { seconds: 50, timed: 20 });
  expect(text).toMatch(/^Ask the model to develop section 2\?/);
  expect(text).toContain("writes the section's own 4:00");
  expect(text).toContain("1 or 2 requests to the model");
  expect(text).toContain("the sketch stays as it is");
  expect(text).toContain("about 1 to 2 minutes");
  expect(developCostText(0, 60, { seconds: null, timed: 0 })).toMatch(/can't be estimated/);
});

test("the button is off on an unsaved timeline and under 60 s, and says why", () => {
  const section = { sketchId: 1, offset: 0, seconds: 90, text: "", developmentId: null };
  expect(developRefusal(section, false)).toBeNull();
  expect(developRefusal(section, true)).toMatch(/only a saved version is developed/);
  expect(developRefusal({ ...section, seconds: 30 }, false)).toMatch(
    /at least 1:00 to be developed, and this one plays 0:30/,
  );
});

test("a developed section names its development and the words it was written from", () => {
  expect(developedText(undefined)).toBe("It plays its sketch as it is.");
  expect(developedText({ id: 4, text: "thin out", createdAt: 0 })).toMatch(
    /^It plays development 4 of its sketch, written .* from your words “thin out”\.$/,
  );
  expect(developedText({ id: 4, text: "", createdAt: 0 })).toMatch(/with no words\.$/);
});

test("a finished development goes into its own section on the line of versions it started on", () => {
  const from = { sketchId: 2, offset: 20, seconds: 90, text: "rise", developmentId: null };
  const other = { sketchId: 1, offset: 0, seconds: 120, text: "", developmentId: null };
  const arrangement = {
    ...emptyArrangement(),
    sections: [other, from],
    transitions: [{ kind: "crossfade", seconds: 8, text: "" }],
  };
  const started = { from, at: 1, openedThen: 2 };
  const developed = { ...from, offset: 0, developmentId: 7 };
  // Nothing changed: saved, the section playing the development from its start.
  expect(developSwap({ ...started, arrangement, openedNow: 2, unsaved: false }, 7)).toEqual({
    kind: SWAP.save,
    index: 1,
    arrangement: { ...arrangement, sections: [other, developed] },
  });
  // Edited since but not saved: put on the timeline for the owner to save.
  expect(developSwap({ ...started, arrangement, openedNow: 2, unsaved: true }, 7)).toMatchObject({
    kind: SWAP.edit,
    index: 1,
  });
  // Saved since with the section moved first: saved in its new place.
  const moved = { ...arrangement, sections: [from, other] };
  expect(developSwap({ ...started, arrangement: moved, openedNow: 2, unsaved: false }, 7)).toEqual({
    kind: SWAP.save,
    index: 0,
    arrangement: { ...moved, sections: [developed, other] },
  });
  // Words written on it since: still its window, so it still takes the development, words kept.
  const worded = { ...arrangement, sections: [other, { ...from, text: "rise, then fall" }] };
  const taken = developSwap({ ...started, arrangement: worded, openedNow: 2, unsaved: true }, 7);
  expect(taken.kind === SWAP.edit && taken.arrangement.sections[1]).toEqual({
    ...developed,
    text: "rise, then fall",
  });
  // Another version opened by hand, even one holding the same section: left alone.
  expect(developSwap({ ...started, arrangement, openedNow: 3, unsaved: false }, 7)).toEqual({
    kind: SWAP.skip,
    reason: "another version was opened while it ran",
  });
  // Its window changed, or the section removed.
  const shortened = { ...arrangement, sections: [other, { ...from, seconds: 80 }] };
  for (const changed of [shortened, { ...arrangement, sections: [other] }]) {
    expect(
      developSwap({ ...started, arrangement: changed, openedNow: 2, unsaved: true }, 7),
    ).toEqual({ kind: SWAP.skip, reason: "its section has changed or been removed since" });
  }
  // Developing a developed section again: found by its window, and takes the new one.
  const again = { ...arrangement, sections: [other, developed] };
  expect(
    developSwap(
      { from: developed, at: 1, openedThen: 2, arrangement: again, openedNow: 2, unsaved: false },
      8,
    ),
  ).toMatchObject({ kind: SWAP.save, arrangement: { sections: [other, { developmentId: 8 }] } });
});

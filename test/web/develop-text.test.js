// Developing a section on the timeline (decision 0079): the confirm, why the button is off, what
// a developed section says, and where a finished development goes when the timeline changed or
// another version was opened during the run (0066's rules).
import { describe, expect, test } from "vitest";
import { emptyArrangement } from "../../src/domain/arrangement-schema.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import {
  bridgeCostText,
  bridgeRefusal,
  bridgeSwap,
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
  expect(developedText({ id: 4, text: "thin out", createdAt: 0, bridge: false })).toMatch(
    /^It plays development 4 of its sketch, written .* from your words “thin out”\.$/,
  );
  expect(developedText({ id: 4, text: "", createdAt: 0, bridge: false })).toMatch(
    /with no words\.$/,
  );
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

describe("a bridge (decision 0081)", () => {
  const out = { sketchId: 1, offset: 0, seconds: 100, text: "", developmentId: null };
  const into = { sketchId: 2, offset: 0, seconds: 100, text: "", developmentId: null };
  const arrangement = {
    ...emptyArrangement(),
    sections: [out, into],
    transitions: [{ kind: "crossfade", seconds: 8, text: "let the pad rise" }],
  };
  const whole = {
    parts: [{ sketchId: 1, seconds: 60 }],
    into: 16,
    out: 16,
    middle: null,
    differs: [],
    keyless: false,
  };
  const halves = {
    ...whole,
    parts: [
      { sketchId: 1, seconds: 60 },
      { sketchId: 2, seconds: 60 },
    ],
    middle: 8,
    differs: /** @type {"key"[]} */ (["key"]),
    keyless: true,
  };

  test("the confirm states the requests and, between two keys, the two halves", () => {
    const one = bridgeCostText(0, whole, { seconds: 50, timed: 20 });
    expect(one).toMatch(/^Ask the model to write a bridge between section 1 and section 2\?/);
    expect(one).toContain(
      "writes 1:00 that starts where section 1 ends and ends where section 2 starts",
    );
    expect(one).toContain("1 or 2 requests to the model");
    expect(one).toContain("about 1 to 2 minutes");
    const two = bridgeCostText(0, halves, { seconds: 50, timed: 20 });
    expect(two).toContain(
      "differ in key, which one genome can't change, so it writes two halves of 1:00 and 1:00",
    );
    expect(two).toContain("2 to 4 requests to the model");
    expect(two).toContain("about 2 to 3 minutes");
  });

  test("the button is off on an unsaved timeline, with one section, or for the plan's reason", () => {
    const sketches = new Map(
      /** @type {[number | string, unknown][]} */ ([
        [1, { ...droneGenome, duration: 120 }],
        [2, { ...droneGenome, duration: 120 }],
      ]),
    );
    expect(bridgeRefusal(arrangement, 0, 60, false, sketches)).toBeNull();
    expect(bridgeRefusal(arrangement, 0, 60, true, sketches)).toMatch(
      /only a saved version is bridged/,
    );
    expect(bridgeRefusal(arrangement, null, 60, false, sketches)).toMatch(/one section/);
    expect(bridgeRefusal(arrangement, 0, 30, false, sketches)).toMatch(
      /^Turned off: a bridge plays from 60 to 900 s, not 30 s\.$/,
    );
  });

  test("a finished bridge goes between its two sections, joined by weaves", () => {
    const started = { from: out, into, at: 0, openedThen: 1 };
    const result = { developmentIds: [7], plan: whole };
    const swap = bridgeSwap(
      { ...started, arrangement, openedNow: 1, unsaved: false },
      result,
      "let the pad rise",
    );
    expect(swap).toMatchObject({ kind: SWAP.save, index: 0 });
    expect(swap.kind !== SWAP.skip && swap.arrangement).toEqual({
      ...arrangement,
      sections: [
        out,
        { sketchId: 1, offset: 0, seconds: 60, text: "let the pad rise", developmentId: 7 },
        into,
      ],
      transitions: [
        { kind: "weave", seconds: 16, curve: "smooth", text: "" },
        { kind: "weave", seconds: 16, curve: "smooth", text: "" },
      ],
    });
    // Two halves, with the crossfade between them.
    const two = bridgeSwap(
      { ...started, arrangement, openedNow: 1, unsaved: true },
      { developmentIds: [7, 8], plan: halves },
      "",
    );
    expect(two.kind).toBe(SWAP.edit);
    expect(two.kind !== SWAP.skip && two.arrangement.transitions.map(({ kind }) => kind)).toEqual([
      "weave",
      "crossfade",
      "weave",
    ]);
    // The incoming section changed, or another version was opened: left out, saying why.
    const changed = { ...arrangement, sections: [out, { ...into, seconds: 90 }] };
    expect(
      bridgeSwap({ ...started, arrangement: changed, openedNow: 1, unsaved: true }, result, ""),
    ).toEqual({
      kind: SWAP.skip,
      reason: "the two sections it joins have changed or been parted since",
    });
    expect(
      bridgeSwap({ ...started, arrangement, openedNow: 2, unsaved: false }, result, ""),
    ).toEqual({ kind: SWAP.skip, reason: "another version was opened while it ran" });
  });

  test("a bridge's section says it is a bridge and the words it was written from", () => {
    expect(developedText({ id: 4, text: "rise", createdAt: 0, bridge: true })).toMatch(
      /^It plays bridge 4, written .* from your words for the join “rise”\.$/,
    );
  });
});

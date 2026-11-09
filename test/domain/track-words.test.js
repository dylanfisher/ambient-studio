// The track's field sets for words (decision 0087): a section's length, a transition's kind and
// seconds, and a macro lane read on a 30 s grid, each with its values now read from the
// arrangement, its answer applied to a new arrangement, and its reading; and each set's largest
// first prompt held under half the context budget.
/** @import { Arrangement } from "../../src/domain/arrangement-schema.js" */
import { describe, expect, test } from "vitest";
import example from "../../src/config/example.json" with { type: "json" };
import { arrangementLength } from "../../src/domain/arrangement-length.js";
import {
  emptyArrangement,
  MAX_ARC_CHARS,
  MAX_TEXT_CHARS,
  MAX_TRACK_SECONDS,
  MORPH_CURVE,
  SECTION_FIELDS,
  TRANSITION_SECONDS,
} from "../../src/domain/arrangement-schema.js";
import { LANE_OFFSET } from "../../src/domain/lane-schema.js";
import { estimateTokens, promptText } from "../../src/domain/prompt-tokens.js";
import {
  LANE_GRID_SECONDS,
  laneField,
  laneGrid,
  sectionNames,
  TRACK_TARGET,
  trackTargets,
} from "../../src/domain/track-words.js";
import { validateArrangement } from "../../src/domain/validate-arrangement.js";
import { fitWordsPrompt, WORDS_CHARS } from "../../src/domain/words-prompt.js";
import { WORDS_SCOPE, WORDS_SETS } from "../../src/domain/words-sets.js";
import { MACROS } from "../../src/engine/genome-schema.js";
import { MAX_DURATION } from "../../src/engine/timeline.js";
import { MAX_CHARS } from "../../src/server/request-fields.js";

const BUDGET = example.queue.contextBudgetTokens / 2;

/** Three sections of 200 s with 10 s crossfades: 570 s. */
const TRACK = /** @type {Arrangement} */ (
  Object.freeze({
    ...emptyArrangement(),
    arc: "a slow rise",
    sections: [1, 2, 3].map((sketchId) => ({
      sketchId,
      offset: 0,
      seconds: 200,
      text: `part ${sketchId}`,
      developmentId: null,
    })),
    transitions: [
      { kind: "crossfade", seconds: 10, text: "fade" },
      { kind: "morph", seconds: 20, curve: "early", text: "melt" },
    ],
  })
);

describe("the length set", () => {
  const set = WORDS_SETS.length;
  const context = { arrangement: TRACK, target: 1 };

  test("is the track's, with the section's seconds as its one field", () => {
    expect(set.scope).toBe(WORDS_SCOPE.track);
    expect(set.target).toBe(TRACK_TARGET.section);
    expect(set.fields()).toEqual({ seconds: SECTION_FIELDS.seconds });
    expect(set.current(context)).toEqual({ seconds: 200 });
  });

  test("sets the section's seconds and nothing else", () => {
    const { arrangement, removed } = set.apply(context, { seconds: 312.5 });
    expect(arrangement.sections[1]).toEqual({ ...TRACK.sections[1], seconds: 312.5 });
    expect(arrangement.sections[0]).toBe(TRACK.sections[0]);
    expect(arrangement.transitions).toBe(TRACK.transitions);
    expect(removed).toEqual([]);
  });

  test("reads the section, its neighbors and their joins, with the owner's words", () => {
    const lines = set.reading({ ...context, names: sectionNames(TRACK, () => false) });
    const text = lines.join("\n");
    expect(text).toContain("The track plays 570 s, in 3 sections.");
    expect(text).toContain('The track\'s arc, as a JSON string: "a slow rise"');
    expect(text).toContain(
      'Section 2, the one being changed: sketch 2, from 190 s to 390 s of the track, 200 s long; the owner\'s words for it: "part 2"',
    );
    expect(text).toContain("Section 1: sketch 1");
    expect(text).toContain("Section 3: sketch 3");
    expect(text).toContain(
      'Section 2 into section 3: a morph of 20 s along the early curve; the owner\'s words for it: "melt"',
    );
  });
});

describe("the transition set", () => {
  const set = WORDS_SETS.transition;
  const context = { arrangement: TRACK, target: 0 };

  test("has the transition's kind and seconds", () => {
    expect(set.target).toBe(TRACK_TARGET.transition);
    const fields = set.fields();
    expect(Object.keys(fields)).toEqual(["kind", "seconds"]);
    expect(fields.kind).toMatchObject({ kind: "enum", values: ["crossfade", "morph", "weave"] });
    expect(fields.seconds).toBe(TRANSITION_SECONDS);
    expect(set.current(context)).toEqual({ kind: "crossfade", seconds: 10 });
  });

  test("a crossfade made a morph takes the new morph's curve; a morph made a weave keeps its own; one made a crossfade drops it", () => {
    const morph = set.apply(context, { kind: "morph", seconds: 16 }).arrangement;
    expect(morph.transitions[0]).toEqual({
      kind: "morph",
      seconds: 16,
      curve: MORPH_CURVE,
      text: "fade",
    });
    const weave = set.apply({ arrangement: TRACK, target: 1 }, { kind: "weave" }).arrangement;
    expect(weave.transitions[1]).toEqual({
      kind: "weave",
      seconds: 20,
      curve: "early",
      text: "melt",
    });
    const fade = set.apply({ arrangement: TRACK, target: 1 }, { kind: "crossfade" }).arrangement;
    expect(fade.transitions[1]).toEqual({ kind: "crossfade", seconds: 20, text: "melt" });
    expect(fade.sections).toBe(TRACK.sections);
  });

  test("reads the two sections it joins and the join", () => {
    const text = set.reading({ ...context, names: sectionNames(TRACK, () => false) }).join("\n");
    expect(text).toContain("Section 1: sketch 1, from 0 s to 200 s");
    expect(text).toContain("Section 2: sketch 2, from 190 s to 390 s");
    expect(text).toContain(
      'Section 1 into section 2, the join being changed: a crossfade of 10 s; the owner\'s words for it: "fade"',
    );
    expect(text).not.toContain("Section 3:");
  });
});

describe("the lane set", () => {
  const set = WORDS_SETS.lane;

  test("the grid is every 30 s of the track and its end", () => {
    expect(laneGrid(90)).toEqual([0, 30, 60, 90]);
    expect(laneGrid(100.5)).toEqual([0, 30, 60, 90, 100.5]);
    expect(LANE_GRID_SECONDS).toBe(30);
  });

  test("has a field per grid time with the lane's offset there now, 0 with no lane", () => {
    const context = { arrangement: TRACK, target: "brightness" };
    const fields = set.fields(context);
    const grid = laneGrid(arrangementLength(TRACK));
    expect(Object.keys(fields)).toEqual(grid.map(laneField));
    expect(fields[laneField(30)]).toMatchObject({ min: LANE_OFFSET.min, max: LANE_OFFSET.max });
    expect(Object.values(set.current(context)).every((value) => value === 0)).toBe(true);
    const laned = {
      ...TRACK,
      lanes: [
        {
          macro: /** @type {const} */ ("brightness"),
          points: /** @type {any} */ ([
            [0, 0],
            [60, 0.3, "linear"],
          ]),
        },
      ],
    };
    const now = set.current({ arrangement: laned, target: "brightness" });
    expect(now[laneField(30)]).toBe(0.15);
    expect(now[laneField(60)]).toBe(0.3);
    expect(now[laneField(570)]).toBe(0.3);
  });

  test("the given times become points, moving evenly between them, held by the grid time on either side", () => {
    const context = { arrangement: TRACK, target: "brightness" };
    const { arrangement, removed } = set.apply(context, {
      [laneField(450)]: 0,
      [laneField(570)]: -0.3,
    });
    expect(arrangement.lanes).toEqual([
      {
        macro: "brightness",
        points: [
          [420, 0],
          [450, 0, "linear"],
          [570, -0.3, "linear"],
        ],
      },
    ]);
    expect(removed).toEqual([]);
    expect(validateArrangement(arrangement, anySketch).ok).toBe(true);
  });

  test("the owner's points between the held grid times are replaced and named; those outside keep their curves", () => {
    const laned = {
      ...TRACK,
      lanes: [
        {
          macro: /** @type {const} */ ("density"),
          points: /** @type {any} */ ([
            [10, 0.1],
            [100, 0.2, "smooth"],
            [130, 0.4, "early"],
            [400, 0, "late"],
          ]),
        },
      ],
    };
    const context = { arrangement: laned, target: "density" };
    const before = set.current(context);
    const { arrangement, removed } = set.apply(context, { [laneField(120)]: -0.2 });
    expect(removed).toEqual([
      [100, 0.2, "smooth"],
      [130, 0.4, "early"],
    ]);
    expect(arrangement.lanes[0]?.points).toEqual([
      [10, 0.1],
      [90, before[laneField(90)], "linear"],
      [120, -0.2, "linear"],
      [150, before[laneField(150)], "linear"],
      [400, 0, "late"],
    ]);
  });

  test("an answer that changes nothing leaves the arrangement as it was", () => {
    const context = { arrangement: TRACK, target: "motion" };
    expect(set.apply(context, { [laneField(60)]: 0 }).arrangement).toBe(TRACK);
    expect(set.apply(context, {}).arrangement).toBe(TRACK);
  });

  test("a change at the track's start and end needs no held grid time there", () => {
    const context = { arrangement: TRACK, target: "space" };
    const { arrangement } = set.apply(context, { [laneField(0)]: 0.2, [laneField(570)]: 0.4 });
    expect(arrangement.lanes[0]?.points).toEqual([
      [0, 0.2],
      [570, 0.4, "linear"],
    ]);
  });

  test("reads the macro's ends and every section, narrowing to their places and then to the track", () => {
    const names = sectionNames(TRACK, () => false);
    const context = { arrangement: TRACK, target: "brightness", names };
    const full = set.reading(context).join("\n");
    expect(full).toContain("The lane is the brightness macro's");
    expect(full).toContain('the owner\'s words for it: "part 3"');
    const times = set.narrower(context);
    expect(set.reading(/** @type {any} */ (times)).join("\n")).not.toContain("part 3");
    expect(set.reading(/** @type {any} */ (times)).join("\n")).toContain("Section 3: sketch 3");
    const none = set.narrower(/** @type {any} */ (times));
    expect(set.reading(/** @type {any} */ (none)).join("\n")).not.toContain("Section 3");
    expect(set.narrower(/** @type {any} */ (none))).toBeNull();
  });
});

test("the targets are the sections, the transitions and the macros", () => {
  expect(trackTargets(TRACK_TARGET.section, TRACK)).toEqual([0, 1, 2]);
  expect(trackTargets(TRACK_TARGET.transition, TRACK)).toEqual([0, 1]);
  expect(trackTargets(TRACK_TARGET.macro, TRACK)).toEqual(Object.keys(MACROS));
});

test("a section is named by its sketch, and as developed or a bridge", () => {
  const developed = {
    ...TRACK,
    sections: TRACK.sections.map((section, i) => ({
      ...section,
      developmentId: i === 0 ? null : i,
    })),
  };
  expect(sectionNames(developed, (id) => id === 2)).toEqual([
    "sketch 1",
    "sketch 2, developed",
    "sketch 3, a bridge",
  ]);
});

/** Every sketch and development lives and lasts the longest a timeline may. */
const anySketch = {
  vibeId: 1,
  trackId: 1,
  sketch: () => ({ vibeId: 1, removedReason: null, duration: MAX_DURATION }),
  development: (/** @type {number} */ id) => ({
    trackId: 1,
    sketchId: id - 1000,
    removedReason: null,
    duration: MAX_DURATION,
  }),
};

/**
 * The longest track with the most sections a track may hold, every text at its limit: 10 s
 * sections, each playing a development, joined by 1 s crossfades up to 20 minutes. A morph or a
 * weave would read a few characters longer, but needs more seconds than these sections give.
 * @returns {Arrangement}
 */
function longestTrack() {
  const count = Math.floor((MAX_TRACK_SECONDS - 1) / 9);
  return {
    ...emptyArrangement(),
    arc: "a".repeat(MAX_ARC_CHARS),
    sections: Array.from({ length: count }, (_, i) => ({
      sketchId: 1000 + i,
      offset: 0,
      seconds: 10,
      text: "s".repeat(MAX_TEXT_CHARS),
      developmentId: 2000 + i,
    })),
    transitions: Array.from({ length: count - 1 }, () => ({
      kind: "crossfade",
      seconds: 1,
      text: "t".repeat(MAX_TEXT_CHARS),
    })),
  };
}

test("each track set's largest first prompt fits half the context budget, the lane narrowed to fit", () => {
  const arrangement = longestTrack();
  expect(validateArrangement(arrangement, anySketch).ok).toBe(true);
  const names = sectionNames(arrangement, () => true);
  expect(Object.keys(WORDS_SETS.lane.fields({ arrangement, target: "brightness" }))).toHaveLength(
    Math.ceil(arrangementLength(arrangement) / LANE_GRID_SECONDS) + 1,
  );
  const middle = Math.floor(arrangement.sections.length / 2);
  /** @type {Record<string, number>} */
  const sizes = {};
  for (const [name, target] of /** @type {const} */ ([
    ["length", middle],
    ["transition", middle],
    ["lane", "brightness"],
  ])) {
    const set = WORDS_SETS[name];
    const context = { arrangement, target, names };
    const { messages } = fitWordsPrompt(
      {
        words: "w".repeat(WORDS_CHARS),
        brief: "b".repeat(MAX_CHARS.brief),
        reading: [],
        set,
        context,
        current: set.current(context),
      },
      BUDGET,
    );
    sizes[name] = estimateTokens(promptText(messages));
    expect(sizes[name], name).toBeLessThanOrEqual(BUDGET);
  }
});

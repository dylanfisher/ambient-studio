// A bridge's end rules (decision 0081): where it starts, the outgoing section's voices, settings
// and join globals at its end; where it ends, the incoming one's at its start; across two halves
// in different keys, only voices with no pitch; and both joins holding as weaves, so the track
// plays them as weaves (`sectionMorph` ok on both sides).
/** @import { BridgeEnds } from "../../src/domain/check-bridge.js" */
import { describe, expect, test } from "vitest";
import { MORPH_CURVE } from "../../src/domain/arrangement-schema.js";
import { BRIDGE_PART, bridgedArrangement, bridgePlan } from "../../src/domain/bridge-plan.js";
import { BRIDGE_RULE, checkBridge, sharedGlobals } from "../../src/domain/check-bridge.js";
import { checkDevelopment } from "../../src/domain/check-development.js";
import { buildDevelopPrompt } from "../../src/domain/develop-prompt.js";
import { BRIDGE_STATE_TOKENS, MEETING_EDGE, meetingState } from "../../src/domain/meeting-state.js";
import { developmentKey, sectionMorph } from "../../src/domain/section-genome.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";

const [drone] = droneGenome.voices;
const base = { ...droneGenome, fadeIn: 0, fadeOut: 0 };

/** The outgoing sketch: the drone for 120 s. */
const OUT = requireGenome({ ...base, duration: 120, voices: [drone] }, "out");
/** The incoming sketch: a pad and the drone with another root, in the same key. */
const INTO = requireGenome(
  {
    ...base,
    duration: 120,
    voices: [
      { id: "pad", type: "pad", level: -16 },
      { ...drone, root: 49 },
    ],
  },
  "into",
);

/** A 60 s bridge: the drone from 0 to its end, the pad from 20 s, the drone kept at its root. */
const BRIDGE = {
  ...base,
  duration: 60,
  voices: [
    { ...drone, start: 0, end: 60 },
    { id: "pad", type: "pad", level: -16, start: 20 },
  ],
};

/**
 * Two 100 s sections, the first from 20 s of OUT, and the bridge's ends at 16 s weaves.
 * @param {object} [into]
 * @returns {BridgeEnds}
 */
const ends = (into = INTO) => ({
  start: {
    genome: OUT,
    at: 120,
    name: "section 1",
    globals: true,
    through: 16,
    weave: { seconds: 16, curve: MORPH_CURVE },
  },
  end: {
    genome: requireGenome(into, "into"),
    at: 0,
    name: "section 3",
    globals: true,
    through: 16,
    weave: { seconds: 16, curve: MORPH_CURVE },
  },
  keyless: null,
  held: sharedGlobals(OUT, requireGenome(into, "into")),
});

/** @param {Record<string, unknown>} genome */
const check = (genome, given = ends()) => checkBridge(requireGenome(genome, "bridge"), given);

test("a bridge in both ends' states passes, and both joins play as weaves", () => {
  expect(check(BRIDGE)).toEqual([]);
  const genomes = new Map(
    /** @type {[number | string, unknown][]} */ ([
      [1, OUT],
      [2, INTO],
      [developmentKey(7), requireGenome(BRIDGE, "bridge")],
    ]),
  );
  const arrangement = {
    length: null,
    arc: null,
    sections: [
      { sketchId: 1, offset: 20, seconds: 100, text: "", developmentId: null },
      { sketchId: 2, offset: 0, seconds: 100, text: "", developmentId: null },
    ],
    transitions: [{ kind: "crossfade", seconds: 8, text: "into the pad" }],
    lanes: [],
    proposal: null,
  };
  const plan = bridgePlan(arrangement, 0, 60, genomes);
  if (!plan.ok) throw new Error(plan.reason);
  expect(plan).toMatchObject({ into: 16, out: 16, middle: null, differs: [] });
  const bridged = bridgedArrangement(arrangement, 0, plan, [7], "into the pad");
  expect(bridged.transitions.map(({ kind, seconds }) => [kind, seconds])).toEqual([
    ["weave", 16],
    ["weave", 16],
  ]);
  for (const i of [0, 1]) expect(sectionMorph(bridged, i, genomes)?.ok).toBe(true);
});

describe("findings the repair quotes, each at its path", () => {
  const pad = { id: "pad", type: "pad", level: -16, start: 20 };
  /** @type {[string, Record<string, unknown>, string, string, RegExp][]} */
  const found = [
    [
      "a voice the outgoing section ends with is missing",
      { ...BRIDGE, voices: [pad] },
      "$.voices",
      BRIDGE_RULE.start,
      /must hold voice drone, a drone, from 0 s, as it sounds where section 1 ends/,
    ],
    [
      "its root differs from the outgoing one's",
      { ...BRIDGE, voices: [{ ...drone, root: 40 }, pad] },
      "$.voices[0].root",
      BRIDGE_RULE.start,
      /must be 37, as voice drone has it where section 1 ends/,
    ],
    [
      "it starts late",
      { ...BRIDGE, voices: [{ ...drone, start: 5 }, pad] },
      "$.voices[0].start",
      BRIDGE_RULE.start,
      /must be 0/,
    ],
    [
      "it ends inside the weave",
      { ...BRIDGE, voices: [{ ...drone, end: 10 }, pad] },
      "$.voices[0].end",
      BRIDGE_RULE.start,
      /at least 16, so voice drone plays through the 16 s join/,
    ],
    [
      "a voice the outgoing section doesn't hold sounds from 0 s",
      { ...BRIDGE, voices: [drone, { ...pad, start: 0 }] },
      "$.voices[1].start",
      BRIDGE_RULE.start,
      /start it at 16 s or later/,
    ],
    [
      "a voice the incoming section starts with is missing",
      { ...BRIDGE, voices: [drone] },
      "$.voices",
      BRIDGE_RULE.end,
      /must hold voice pad, a pad, up to 60 s, as it sounds where section 3 starts/,
    ],
    [
      "the pad's chord differs from the incoming one's",
      { ...BRIDGE, voices: [drone, { ...pad, notes: 3 }] },
      "$.voices[1].notes",
      BRIDGE_RULE.end,
      /must be 5, as voice pad has it where section 3 starts/,
    ],
    [
      "the pad comes in too late to play through the weave",
      { ...BRIDGE, voices: [drone, { ...pad, start: 50 }] },
      "$.voices[1].start",
      BRIDGE_RULE.end,
      /must be at most 44/,
    ],
    [
      "another key",
      { ...BRIDGE, key: 4 },
      "$.key",
      BRIDGE_RULE.start,
      /must be 2, as where section 1 ends: a weave can't move key/,
    ],
    [
      "a reverb both neighbors share changed",
      { ...BRIDGE, reverbDecay: 6 },
      "$.reverbDecay",
      BRIDGE_RULE.start,
      /must be 2, as both sections on either side of the bridge have it/,
    ],
  ];
  test.each(found)("%s", (_, genome, path, rule, message) => {
    const findings = check(genome);
    expect(findings).toContainEqual({ path, rule, message: expect.stringMatching(message) });
  });

  test("the drone both ends name with different roots is held at the start and splits at the end", () => {
    // The incoming drone's root is 49, the outgoing one's 37: the bridge keeps 37 and the end
    // asks nothing of it, since one voice can't hold both.
    expect(check(BRIDGE).filter(({ path }) => path.startsWith("$.voices[0]"))).toEqual([]);
  });

  test("a join that would still fall back says why", () => {
    // Every end rule holds, and the weave in can't: a voice id ending in "--in".
    const odd = { ...drone, id: "low--in" };
    const out = requireGenome({ ...OUT, voices: [odd] }, "out");
    const start = /** @type {import("../../src/domain/check-bridge.js").BridgeEdge} */ (
      ends().start
    );
    const given = { ...ends(), start: { ...start, genome: out }, end: null };
    const findings = check({ ...BRIDGE, voices: [{ ...odd, start: 0, end: 60 }, pad] }, given);
    expect(findings).toEqual([
      {
        path: "$",
        rule: BRIDGE_RULE.join,
        message: expect.stringMatching(
          /^the weave from section 1 into the bridge would play as a crossfade: voice low--in's id/,
        ),
      },
    ]);
  });

  test("the development check quotes the end rules with its own findings", () => {
    const verdict = checkDevelopment(
      { ...BRIDGE, voices: [drone] },
      { seconds: 60, constraints: {}, recordings: new Set(), ends: ends() },
    );
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.errors.map(({ rule }) => rule)).toContain(BRIDGE_RULE.end);
  });
});

describe("a bridge between two keys", () => {
  const noise = { id: "air", type: "noise", level: -20 };
  const other = { ...INTO, key: 5 };
  const arrangement = {
    length: null,
    arc: null,
    sections: [
      { sketchId: 1, offset: 20, seconds: 100, text: "", developmentId: null },
      { sketchId: 2, offset: 0, seconds: 100, text: "", developmentId: null },
    ],
    transitions: [{ kind: "crossfade", seconds: 8, text: "" }],
    lanes: [],
    proposal: null,
  };

  test("is two halves, crossfading where only voices with no pitch sound", () => {
    const genomes = new Map(
      /** @type {[number | string, unknown][]} */ ([
        [1, OUT],
        [2, other],
      ]),
    );
    expect(bridgePlan(arrangement, 0, 100, genomes)).toEqual({
      ok: false,
      reason: expect.stringContaining("two halves of at least 60 s each: from 120 to 900 s"),
    });
    const plan = bridgePlan(arrangement, 0, 120, genomes);
    expect(plan).toMatchObject({
      ok: true,
      parts: [
        { sketchId: 1, seconds: 60 },
        { sketchId: 2, seconds: 60 },
      ],
      middle: 8,
      differs: ["key"],
      keyless: true,
    });
    if (!plan.ok) return;

    // The first half: the drone thins out and ends by 52 s, the noise from 30 s to its end.
    const first = {
      ...base,
      duration: 60,
      voices: [
        { ...drone, end: 50 },
        { ...noise, start: 30 },
      ],
    };
    const firstEnds = { ...ends(other), end: null, keyless: { from: 52, to: 60 } };
    expect(check(first, firstEnds)).toEqual([]);
    expect(check({ ...first, voices: [drone, { ...noise, start: 30 }] }, firstEnds)).toEqual([
      {
        path: "$.voices[0].end",
        rule: BRIDGE_RULE.middle,
        message: expect.stringMatching(/carries pitch.*end it at 52 s or earlier/),
      },
    ]);

    // The second half, in key 5: the noise from 0 s, the pad from 12 s and the drone at the
    // incoming root.
    const second = {
      ...base,
      key: 5,
      duration: 60,
      voices: [
        { ...noise, start: 0, end: 40 },
        { id: "pad", type: "pad", level: -16, start: 12 },
        { ...drone, root: 49, start: 20 },
      ],
    };
    const secondEnds = {
      ...ends(other),
      start: {
        genome: requireGenome(first, "first"),
        at: 60,
        name: "section 2",
        globals: false,
        through: 8,
        weave: null,
      },
      keyless: { from: 0, to: 8 },
    };
    expect(check(second, secondEnds)).toEqual([]);
    expect(
      check(
        {
          ...second,
          voices: [{ ...noise, start: 0, end: 40, color: "white" }, ...second.voices.slice(1)],
        },
        secondEnds,
      ),
    ).toContainEqual({
      path: "$.voices[0].color",
      rule: BRIDGE_RULE.start,
      message: expect.stringMatching(/as voice air has it where section 2 ends/),
    });

    // Placed on the timeline, both outer joins weave, and the middle crossfades.
    genomes.set(developmentKey(7), requireGenome(first, "first"));
    genomes.set(developmentKey(8), requireGenome(second, "second"));
    const bridged = bridgedArrangement(arrangement, 0, plan, [7, 8], "");
    expect(bridged.transitions.map(({ kind }) => kind)).toEqual(["weave", "crossfade", "weave"]);
    expect(sectionMorph(bridged, 0, genomes)?.ok).toBe(true);
    expect(sectionMorph(bridged, 1, genomes)).toBeNull();
    expect(sectionMorph(bridged, 2, genomes)?.ok).toBe(true);
  });
});

test("a plan refuses a neighbor too short to weave into, and a track that would run too long", () => {
  const genomes = new Map(
    /** @type {[number | string, unknown][]} */ ([
      [1, OUT],
      [2, INTO],
    ]),
  );
  /**
   * Sketch 1 for `first` s, then sketch 2 for `second` s.
   * @param {number} first
   * @param {number} second
   */
  const two = (first, second) => ({
    length: null,
    arc: null,
    sections: [
      { sketchId: 1, offset: 0, seconds: first, text: "", developmentId: null },
      { sketchId: 2, offset: 0, seconds: second, text: "", developmentId: null },
    ],
    transitions: [{ kind: "crossfade", seconds: 4, text: "" }],
    lanes: [],
    proposal: null,
  });
  expect(bridgePlan(two(12, 100), 0, 60, genomes)).toEqual({
    ok: false,
    reason: expect.stringContaining("section 1 plays 12 s; a weave into a bridge is at least 8 s"),
  });
  expect(bridgePlan(two(600, 600), 0, 60, genomes)).toEqual({
    ok: false,
    reason: expect.stringContaining("a track is at most 1200 s"),
  });
  // A weave beside a 24 s section is half of it.
  expect(bridgePlan(two(24, 100), 0, 60, genomes)).toMatchObject({ ok: true, into: 12, out: 16 });
});

test("a bridge copying the prompt's digits for its settings and shared globals passes the first time", () => {
  // Values with more digits than the readings' three: the check compares them exactly.
  const out = requireGenome(
    { ...OUT, reverbDecay: 2.345, voices: [{ ...drone, detune: 4.567 }] },
    "out",
  );
  const into = requireGenome({ ...INTO, reverbDecay: 2.345 }, "into");
  const start = /** @type {import("../../src/domain/check-bridge.js").BridgeEdge} */ (ends().start);
  const held = sharedGlobals(out, into);
  const given = { ...ends(into), start: { ...start, genome: out }, held };
  const { messages } = buildDevelopPrompt({
    revision: { name: "dusk", brief: "a slow join", constraints: {}, ranges: {} },
    arc: null,
    index: 1,
    count: 3,
    section: { offset: 0, seconds: 60, text: "" },
    sketch: { id: 1, genome: out, reading: [], lineage: [] },
    before: meetingState(out, 120, MEETING_EDGE.end, BRIDGE_STATE_TOKENS, { fixed: true }),
    after: meetingState(into, 0, MEETING_EDGE.start, BRIDGE_STATE_TOKENS, { fixed: true }),
    bridge: {
      part: BRIDGE_PART.whole,
      from: 1,
      to: 3,
      into: 16,
      out: 16,
      middle: null,
      differs: [],
      keyless: false,
      held,
    },
    budgetTokens: Number.MAX_SAFE_INTEGER,
  });
  const user = /** @type {{ content: string }} */ (messages[1]).content;
  /** @param {RegExp} pattern */
  const copied = (pattern) => Number(user.match(pattern)?.[1]);
  const detune = copied(/Where section 1 ends[\s\S]*?drone \(drone\)[^\n]*detune ([\d.]+) cents/);
  const reverbDecay = copied(/- Keep [^\n]*reverbDecay ([\d.]+) s/);
  expect({ detune, reverbDecay }).toEqual({ detune: 4.567, reverbDecay: 2.345 });
  const answer = {
    ...BRIDGE,
    reverbDecay,
    voices: [{ ...drone, detune, start: 0, end: 60 }, BRIDGE.voices[1]],
  };
  expect(check(answer, given)).toEqual([]);
  // The three digits a reading writes would not pass.
  expect(check({ ...answer, reverbDecay: 2.35 }, given)).toContainEqual(
    expect.objectContaining({
      path: "$.reverbDecay",
      message: expect.stringMatching(/must be 2.345/),
    }),
  );
});

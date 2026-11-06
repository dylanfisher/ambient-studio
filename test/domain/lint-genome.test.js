import { describe, expect, test } from "vitest";
import { CONSTRAINT_KINDS } from "../../src/domain/constraint-schema.js";
import { EXCERPT_SECONDS } from "../../src/domain/excerpt-seconds.js";
import { lintGenome } from "../../src/domain/lint-genome.js";
import { cost } from "../../src/engine/cost.js";
import { excerptOffset } from "../../src/engine/excerpt-offset.js";
import { draw } from "../../src/engine/prng.js";
import { requireGenome } from "../../src/engine/validate-genome.js";

const voices = [
  { id: "drone", type: "drone" },
  { id: "pad", type: "pad" },
  { id: "bell", type: "bell" },
  { id: "cloud", type: "granular" },
];

/**
 * The base genome with `changes` laid over its globals.
 * @param {Record<string, unknown>} changes
 */
const genome = (changes = {}) => requireGenome({ voices, ...changes }, "fixture genome");

/**
 * The base genome with one voice's parameters changed.
 * @param {number} index
 * @param {Record<string, unknown>} changes
 */
const withVoice = (index, changes) =>
  genome({ voices: voices.map((v, i) => (i === index ? { ...v, ...changes } : v)) });

const baseCost = cost(genome());

/**
 * Every constraint kind: the constraint set, a genome that meets it, one that breaks it, and
 * the path the finding names. Acceptance check 2 of phase 2 is this table's coverage.
 * @type {[string, Record<string, unknown>, () => import("../../src/engine/genome-schema.js").Genome, () => import("../../src/engine/genome-schema.js").Genome, string][]}
 */
const kinds = [
  [
    "tuning",
    { tuning: "12-tet" },
    () => genome(),
    () => genome({ tuning: "19-edo", scale: "all" }),
    "$.tuning",
  ],
  ["scale", { scale: "dorian" }, () => genome({ scale: "dorian" }), () => genome(), "$.scale"],
  ["key", { key: 2 }, () => genome({ key: 2 }), () => genome(), "$.key"],
  ["pulse", { pulse: "beat" }, () => genome({ pulse: "beat" }), () => genome(), "$.pulse"],
  [
    "bpm",
    { bpm: { min: 60, max: 90 } },
    () => genome({ pulse: "beat", bpm: 90 }),
    () => genome({ pulse: "beat", bpm: 120 }),
    "$.bpm",
  ],
  [
    "duration",
    { duration: { min: 120, max: 240 } },
    () => genome({ duration: 240 }),
    () => genome(),
    "$.duration",
  ],
  ["loudness", { loudness: -16 }, () => genome(), () => genome({ loudness: -14 }), "$.loudness"],
  [
    "allowedVoices",
    { allowedVoices: ["drone", "pad", "bell", "granular"] },
    () => genome(),
    () => genome({ voices: [...voices, { id: "wind", type: "noise" }] }),
    "$.voices[4].type",
  ],
  [
    "bannedVoices",
    { bannedVoices: ["noise"] },
    () => genome(),
    () => genome({ voices: [...voices, { id: "wind", type: "noise" }] }),
    "$.voices[4].type",
  ],
  [
    "bellNotes",
    { bellNotes: 4 },
    () => withVoice(2, { density: 4 }),
    () => genome(),
    "$.voices[2].density",
  ],
  [
    "grains",
    { grains: 10 },
    () => genome(),
    () => withVoice(3, { density: 20 }),
    "$.voices[3].density",
  ],
  [
    "padChords",
    { padChords: 1.5 },
    () => withVoice(1, { hold: 40 }),
    () => genome(),
    "$.voices[1].hold",
  ],
  [
    "brightness",
    { brightness: { min: 0.3, max: 0.7 } },
    () =>
      genome({
        macros: {
          brightness: {
            points: [
              [0, 0.3],
              [200, 0.7],
            ],
          },
        },
      }),
    () =>
      genome({
        macros: {
          brightness: {
            points: [
              [0, 0.5],
              [100, 0.9],
            ],
          },
        },
      }),
    "$.macros.brightness",
  ],
  [
    "cost",
    { cost: baseCost },
    () => genome(),
    () => genome({ voices: [...voices, { id: "wind", type: "noise" }] }),
    "$",
  ],
];

describe("lintGenome", () => {
  test("the table has a row for every constraint kind", () => {
    expect(kinds.map(([kind]) => kind).sort()).toEqual(Object.keys(CONSTRAINT_KINDS).sort());
  });

  test.each(kinds)("%s: a genome that meets it passes", (_kind, constraints, passing) => {
    expect(lintGenome(passing(), constraints)).toEqual({ ok: true, findings: [] });
  });

  test.each(kinds)(
    "%s: a genome that breaks it fails at its path",
    (kind, constraints, _passing, failing, path) => {
      const result = lintGenome(failing(), constraints);
      expect(result.ok).toBe(false);
      expect(result.findings).toEqual([{ path, rule: kind, message: expect.any(String) }]);
    },
  );

  test("a genome with no constraints passes", () => {
    expect(lintGenome(genome(), {}).ok).toBe(true);
  });

  test("every violation is reported, not only the first", () => {
    const result = lintGenome(genome({ loudness: -14 }), { loudness: -16, scale: "dorian" });
    expect(result.findings.map((f) => f.rule)).toEqual(["scale", "loudness"]);
  });

  test("a message quotes the value found and the value the vibe allows", () => {
    const [finding] = lintGenome(genome({ loudness: -14 }), { loudness: -16 }).findings;
    expect(finding?.message).toMatch(/-14 LUFS/);
    expect(finding?.message).toMatch(/-16 LUFS/);
  });

  test("a density ceiling counts the macros' offsets", () => {
    // Raw 3.5 notes a minute is under 4, but the density macro at 1 triples it.
    const dense = withVoice(2, { density: 3.5 });
    expect(lintGenome(dense, { bellNotes: 4 }).ok).toBe(true);
    const pushed = requireGenome({ ...dense, macros: { ...dense.macros, density: 1 } }, "pushed");
    expect(lintGenome(pushed, { bellNotes: 4 }).findings[0]?.path).toBe("$.voices[2].density");
  });

  test("brightness is read up to the duration, where a ramp past it stops", () => {
    // Linear from 0.5 at 0 s to 0.9 at 400 s reaches 0.8 at 300 s, the duration.
    const ramp = {
      brightness: {
        points: [
          [0, 0.5],
          [400, 0.9, "linear"],
        ],
      },
    };
    expect(lintGenome(genome({ macros: ramp }), { brightness: { min: 0, max: 0.75 } }).ok).toBe(
      false,
    );
    expect(lintGenome(genome({ macros: ramp }), { brightness: { min: 0, max: 0.85 } }).ok).toBe(
      true,
    );
  });

  test("a key constraint fails a genome whose tuning has no key", () => {
    const colundi = genome({ tuning: "colundi", scale: "all" });
    expect(lintGenome(colundi, { key: 2 }).findings[0]?.path).toBe("$.key");
  });

  test("a genome with no beat passes a tempo range, which only the pulse constraint fixes", () => {
    expect(lintGenome(genome(), { bpm: { min: 60, max: 90 } }).ok).toBe(true);
  });

  test("the linter leaves the genome unchanged", () => {
    const input = genome({ loudness: -14 });
    const snapshot = structuredClone(input);
    lintGenome(input, { loudness: -16, duration: { min: 60, max: 120 } });
    expect(input).toEqual(snapshot);
  });
});

describe("floors", () => {
  /**
   * @param {ReturnType<typeof genome>} g
   * @param {string} rule
   */
  const findingsFor = (g, rule) => lintGenome(g, {}).findings.filter((f) => f.rule === rule);

  test("a genome whose every voice stays at or under -50 dB is near-silent", () => {
    const quiet = genome({ voices: voices.map((v) => ({ ...v, level: -50 })) });
    expect(findingsFor(quiet, "nearSilent")).toEqual([
      { path: "$.voices", rule: "nearSilent", message: expect.stringMatching(/-50 dB/) },
    ]);
  });

  test("one voice above -50 dB is enough", () => {
    const one = genome({ voices: voices.map((v, i) => ({ ...v, level: i === 0 ? -49 : -60 })) });
    expect(findingsFor(one, "nearSilent")).toEqual([]);
  });

  test("a level trajectory counts where it rises inside the voice's span", () => {
    const swell = {
      points: [
        [0, -60],
        [100, -20, "linear"],
        [200, -60, "linear"],
      ],
    };
    const rising = genome({ voices: [{ id: "pad", type: "pad", level: swell }] });
    expect(findingsFor(rising, "nearSilent")).toEqual([]);
    // The swell's peak falls before the voice enters, so what it plays stays quiet.
    const late = genome({ voices: [{ id: "pad", type: "pad", level: swell, start: 199 }] });
    expect(findingsFor(late, "nearSilent")).toHaveLength(1);
  });

  test("a voice that enters after the duration plays nothing", () => {
    const after = genome({ duration: 120, voices: [{ id: "pad", type: "pad", start: 150 }] });
    expect(findingsFor(after, "nearSilent")).toHaveLength(1);
  });

  test("a genome with no voices is near-silent", () => {
    expect(findingsFor(genome({ voices: [] }), "nearSilent")).toHaveLength(1);
  });

  test("a lone drone with no sweep and no trajectory is static", () => {
    const lone = genome({ voices: [{ id: "drone", type: "drone", sweep: 0 }] });
    expect(findingsFor(lone, "loneStaticDrone")).toEqual([
      { path: "$.voices[0]", rule: "loneStaticDrone", message: expect.any(String) },
    ]);
  });

  test.each([
    ["its filter sweeps", { voices: [{ id: "drone", type: "drone" }] }],
    [
      "the motion macro adds a sweep",
      { voices: [{ id: "drone", type: "drone", sweep: 0 }], macros: { motion: 0.8 } },
    ],
    [
      "a parameter has a trajectory",
      {
        voices: [
          {
            id: "drone",
            type: "drone",
            sweep: 0,
            cutoff: {
              points: [
                [0, 200],
                [120, 600],
              ],
            },
          },
        ],
      },
    ],
    [
      "a macro has a trajectory",
      {
        voices: [{ id: "drone", type: "drone", sweep: 0 }],
        macros: {
          warmth: {
            points: [
              [0, 0.2],
              [120, 0.8],
            ],
          },
        },
      },
    ],
    [
      "another voice plays",
      {
        voices: [
          { id: "drone", type: "drone", sweep: 0 },
          { id: "pad", type: "pad" },
        ],
      },
    ],
  ])("a lone drone isn't static when %s", (_name, changes) => {
    expect(findingsFor(genome(changes), "loneStaticDrone")).toEqual([]);
  });

  test(`the time between the fades must hold a ${EXCERPT_SECONDS} s excerpt`, () => {
    const fades = { fadeIn: 20, fadeOut: 20 };
    const short = genome({ ...fades, duration: 40 + EXCERPT_SECONDS - 1 });
    expect(findingsFor(short, "excerptLength")).toEqual([
      { path: "$.duration", rule: "excerptLength", message: expect.stringMatching(/excerpt/) },
    ]);
    const exact = genome({ ...fades, duration: 40 + EXCERPT_SECONDS });
    expect(findingsFor(exact, "excerptLength")).toEqual([]);
  });

  /** @param {() => unknown} fn */
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return true;
    }
  };

  test("passes the excerpt floor exactly when excerptOffset takes the excerpt", () => {
    // 122.8 - 8.1 - 89.7 is 25 in one order of subtraction and 25 - 7.1e-15 in the other.
    const edge = genome({ duration: 122.8, fadeIn: 8.1, fadeOut: 89.7 });
    expect(throws(() => excerptOffset(edge, 1, EXCERPT_SECONDS))).toBe(
      findingsFor(edge, "excerptLength").length > 0,
    );
    let tight = 0;
    for (let i = 0; i < 4000; i++) {
      // Whole tenths, with the duration put at, one step under or one step over the floor.
      const fadeIn = Math.floor(draw(1, "", i, 0) * 601) / 10;
      const fadeOut = Math.floor(draw(1, "", i, 1) * 901) / 10;
      const step = Math.floor(draw(1, "", i, 2) * 3) - 1;
      const exact = Math.round((fadeIn + fadeOut + EXCERPT_SECONDS) * 10) / 10;
      const duration = Math.min(Math.max(Math.round(exact * 10 + step) / 10, 60), 900);
      const g = genome({ duration, fadeIn, fadeOut });
      const fails = findingsFor(g, "excerptLength").length > 0;
      expect(fails, JSON.stringify({ duration, fadeIn, fadeOut })).toBe(
        throws(() => excerptOffset(g, 1, EXCERPT_SECONDS)),
      );
      if (step === 0) tight++;
    }
    expect(tight).toBeGreaterThan(1000);
  });

  test("the base fixture passes every floor", () => {
    expect(lintGenome(genome(), {})).toEqual({ ok: true, findings: [] });
  });
});

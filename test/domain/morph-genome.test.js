// A morph between two sections (decision 0064, acceptance 6): every numeric parameter both
// genomes hold moves along its encoded scale by the curve; a voice that differs plays as two
// instances, one falling and one rising; the morph's render before it starts is the outgoing
// section's; and a morph that can't hold falls back to a crossfade with its reason.
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { Trajectory } from "../../src/engine/trajectory.js" */
import { describe, expect, test } from "vitest";
import { lintGenome } from "../../src/domain/lint-genome.js";
import { morphGenome } from "../../src/domain/morph-genome.js";
import { allowsTrajectory, encode } from "../../src/engine/descriptor.js";
import { drone as droneType } from "../../src/engine/drone.js";
import {
  GLOBAL_PARAMS,
  MACROS,
  MAX_VOICES,
  VOICE_ID,
  VOICE_PARAMS,
} from "../../src/engine/genome-schema.js";
import { isObject } from "../../src/engine/is-object.js";
import { MORPH_HANDOVER, MORPH_SUFFIX, voiceOfInstance } from "../../src/engine/morph.js";
import { CURVES, MAX_POINTS, valueAt } from "../../src/engine/trajectory.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { voiceParams } from "../../src/engine/voice-registry.js";
import { renderOffline } from "../../src/server/render-offline.js";
import { difference, EXCERPT_BELOW_DB, EXCERPT_PEAK } from "../support/compare-renders.js";

const FLOOR = VOICE_PARAMS.level.min;

/** Globals both sketches share; a section genome plays no master fade (0062). */
const SHARED = {
  duration: 60,
  tuning: "12-tet",
  scale: "dorian",
  key: 2,
  fadeIn: 0,
  fadeOut: 0,
};

/**
 * The outgoing sketch: a drone, a pad and a bell. Its drone's cutoff is a trajectory whose last
 * point is before the morph.
 */
const OUT = requireGenome(
  {
    ...SHARED,
    width: -3,
    reverbDecay: 2,
    reverbLevel: -12,
    delayTime: 0.4,
    delayFeedback: 0.3,
    delayLevel: -24,
    macros: { brightness: 0.7 },
    voices: [
      {
        id: "drone",
        type: "drone",
        level: -10,
        root: 37,
        cutoff: {
          points: [
            [0, 250],
            [3, 900, "smooth"],
          ],
        },
        sweep: 1,
        period: 30,
      },
      { id: "pad", type: "pad", level: -14, hold: 20, attack: 2, release: 4, tone: 10 },
      { id: "bell", type: "bell", level: -12, model: "additive", density: 20, decay: 3 },
    ],
  },
  "outgoing",
);

/**
 * The incoming sketch: the same drone with other values, a drone where the outgoing one has its
 * pad, a bell of another model, and a granular cloud only it has.
 */
const IN = requireGenome(
  {
    ...SHARED,
    width: -6,
    reverbDecay: 6,
    reverbLevel: -20,
    delayTime: 0.9,
    delayFeedback: 0.55,
    delayLevel: -30,
    macros: { brightness: 0.3, warmth: 0.8, motion: 0.2 },
    voices: [
      {
        id: "drone",
        type: "drone",
        level: {
          points: [
            [0, -20],
            [20, -6, "linear"],
          ],
        },
        root: 37,
        cutoff: 1400,
        sweep: 2,
        period: 30,
      },
      { id: "pad", type: "drone", level: -9, root: 44 },
      { id: "bell", type: "bell", level: -15, model: "fm", density: 12, decay: 3 },
      { id: "cloud", type: "granular", level: -18 },
    ],
  },
  "incoming",
);

/** The transition starts 20 s into the outgoing section's timeline and 5 s into the incoming's. */
const OUT_AT = 20;
const IN_AT = 5;
const SECONDS = 12;
const CURVE = "smooth";
const MOVES = SECONDS - MORPH_HANDOVER;

/**
 * @param {Genome} outgoing
 * @param {Genome} incoming
 * @param {import("../../src/engine/trajectory.js").Curve} [curve]
 */
const morph = (outgoing, incoming, curve = CURVE) =>
  morphGenome({ genome: outgoing, at: OUT_AT }, { genome: incoming, at: IN_AT }, SECONDS, curve);

/** @param {ReturnType<typeof morphGenome>} result */
function held(result) {
  if (!result.ok) throw new Error(`expected a morph, got a fallback: ${result.reason}`);
  return result;
}

/** @param {ReturnType<typeof morphGenome>} result */
function reason(result) {
  if (result.ok) throw new Error("expected a fallback, got a morph");
  return result.reason;
}

/**
 * A parameter's raw value at a time, as the engine evaluates it before macros.
 * @param {import("../../src/engine/descriptor.js").NumberDescriptor} descriptor
 * @param {unknown} value
 * @param {number} time
 */
const rawAt = (descriptor, value, time) =>
  isObject(value)
    ? valueAt(/** @type {Trajectory} */ (value), time, descriptor.scale)
    : /** @type {number} */ (value);

/** @param {Genome} genome @param {string} id */
const voiceOf = (genome, id) => {
  const voice = genome.voices.find((v) => v.id === id);
  if (!voice) throw new Error(`no voice ${id}`);
  return voice;
};

describe("morphGenome", () => {
  const result = held(morph(OUT, IN));
  const { genome } = result;
  const start = OUT_AT;
  const end = OUT_AT + MOVES;

  // Every curve, and a quarter of the way as well as the middle, since `smooth` and `linear`
  // agree at 0, 0.5 and 1.
  test.each(/** @type {import("../../src/engine/trajectory.js").Curve[]} */ (Object.keys(CURVES)))(
    "every numeric parameter both hold moves along its encoded scale by the %s curve",
    (curve) => {
      const { genome } = held(morph(OUT, IN, curve));
      /** @type {[string, import("../../src/engine/descriptor.js").DescriptorTable, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>][]} */
      const tables = [
        ["globals", GLOBAL_PARAMS, OUT, IN, genome],
        ["macros", MACROS, OUT.macros, IN.macros, genome.macros],
        [
          "voices.drone",
          voiceParams("drone"),
          voiceOf(OUT, "drone"),
          voiceOf(IN, "drone"),
          voiceOf(genome, "drone"),
        ],
      ];
      let checked = 0;
      for (const [where, table, out, into, morphed] of tables) {
        for (const [name, descriptor] of Object.entries(table)) {
          if (!allowsTrajectory(descriptor) || out[name] === undefined) continue;
          const d = /** @type {import("../../src/engine/descriptor.js").NumberDescriptor} */ (
            descriptor
          );
          const from = encode(d, rawAt(d, out[name], start));
          const to = encode(d, rawAt(d, into[name], IN_AT + MOVES));
          for (const x of [0, 0.25, 0.5, 1]) {
            const at = encode(d, rawAt(d, morphed[name], start + x * MOVES));
            expect(at, `${where}.${name} at ${x}`).toBeCloseTo(
              from + (to - from) * CURVES[curve](x),
              12,
            );
          }
          checked += 1;
        }
      }
      // reverbLevel, delayFeedback and delayLevel; six macros; the drone's level, cutoff and sweep.
      expect(checked).toBe(12);
    },
  );

  test("reverbDecay, delayTime and the other fixed globals stay at the outgoing values", () => {
    expect(genome.reverbDecay).toBe(OUT.reverbDecay);
    expect(genome.delayTime).toBe(OUT.delayTime);
    expect(genome.width).toBe(OUT.width);
    expect(genome.duration).toBe(OUT.duration);
  });

  test("a voice whose type, choices or flags differ plays as two instances crossfaded", () => {
    expect(genome.voices.map((v) => v.id).sort()).toEqual(
      ["bell", "bell--in", "cloud", "drone", "pad", "pad--in"].sort(),
    );
    for (const [id, renamed] of [
      ["pad", "pad--in"],
      ["bell", "bell--in"],
    ]) {
      const falling = voiceOf(genome, /** @type {string} */ (id));
      const rising = voiceOf(genome, /** @type {string} */ (renamed));
      const level = VOICE_PARAMS.level;
      expect(falling.type).toBe(voiceOf(OUT, /** @type {string} */ (id)).type);
      expect(rising.type).toBe(voiceOf(IN, /** @type {string} */ (id)).type);
      expect(rawAt(level, falling.level, start)).toBe(
        voiceOf(OUT, /** @type {string} */ (id)).level,
      );
      expect(rawAt(level, falling.level, end)).toBe(FLOOR);
      expect(falling.end).toBe(end);
      expect(rawAt(level, rising.level, start)).toBe(FLOOR);
      expect(rawAt(level, rising.level, end)).toBe(voiceOf(IN, /** @type {string} */ (id)).level);
      expect(rising.start).toBe(start);
      expect(voiceOfInstance(/** @type {string} */ (renamed))).toBe(id);
    }
    expect(voiceOf(genome, "bell--in").model).toBe("fm");
    // A voice only the incoming side has keeps its id, and rises the same way.
    const cloud = voiceOf(genome, "cloud");
    expect(rawAt(VOICE_PARAMS.level, cloud.level, start)).toBe(FLOOR);
    expect(rawAt(VOICE_PARAMS.level, cloud.level, end)).toBe(-18);
    expect(result.instances.sort()).toEqual(["bell--in", "pad--in"]);
  });

  test("the render before the morph starts equals the outgoing section's", async () => {
    const window = { seed: 7, offset: start - 6, duration: 6 };
    const morphed = await renderOffline(genome, window);
    const outgoing = await renderOffline(OUT, window);
    const { peak, belowDb } = difference(morphed, outgoing);
    expect(peak).toBeLessThan(EXCERPT_PEAK);
    expect(belowDb).toBeGreaterThan(EXCERPT_BELOW_DB);
  });

  test("the morph genome validates and lints under the vibe", () => {
    expect(requireGenome(genome, "morph")).toEqual(genome);
    const constraints = {
      tuning: "12-tet",
      scale: "dorian",
      key: 2,
      allowedVoices: ["drone", "pad", "bell", "granular"],
      brightness: { min: 0.2, max: 0.8 },
      bellNotes: 30,
    };
    expect(lintGenome(OUT, constraints).ok).toBe(true);
    expect(lintGenome(IN, constraints).ok).toBe(true);
    expect(lintGenome(genome, constraints)).toEqual({ ok: true, findings: [] });
  });
});

describe("a parameter already a trajectory", () => {
  /** @param {Trajectory} cutoff */
  const outgoing = (cutoff) =>
    requireGenome({ ...OUT, voices: [{ ...voiceOf(OUT, "drone"), cutoff }] }, "outgoing");
  const incoming = requireGenome({ ...IN, voices: [voiceOf(IN, "drone")] }, "incoming");
  const { scale } = droneType.params.cutoff;

  test("keeps its points before the morph, and its value there", () => {
    /** @type {Trajectory} */
    const cutoff = {
      points: [
        [0, 250],
        [10, 900, "smooth"],
        [26, 300, "linear"],
        [50, 800, "late"],
      ],
    };
    const { genome } = held(morph(outgoing(cutoff), incoming));
    const moved = /** @type {Trajectory} */ (voiceOf(genome, "drone").cutoff);
    expect(moved.points.slice(0, 2)).toEqual(cutoff.points.slice(0, 2));
    for (const time of [0, 5, 10, 15, 19.9, OUT_AT]) {
      expect(valueAt(moved, time, scale)).toBeCloseTo(valueAt(cutoff, time, scale), 9);
    }
    expect(valueAt(moved, OUT_AT + MOVES, scale)).toBe(1400);
  });

  test("a curved segment the morph starts inside is kept whole, and the morph follows it", () => {
    /** @type {Trajectory} */
    const cutoff = {
      points: [
        [0, 250],
        [24, 900, "smooth"],
      ],
    };
    const { genome } = held(morph(outgoing(cutoff), incoming));
    const moved = /** @type {Trajectory} */ (voiceOf(genome, "drone").cutoff);
    expect(moved.points).toEqual([
      [0, 250],
      [24, 900, "smooth"],
      [OUT_AT + MOVES, 1400, CURVE],
    ]);
  });

  test("a curved segment that runs past the morph's end keeps it from moving, a stated exception", () => {
    /** @type {Trajectory} */
    const cutoff = {
      points: [
        [0, 250],
        [40, 900, "early"],
        [50, 300, "linear"],
      ],
    };
    const { genome } = held(morph(outgoing(cutoff), incoming));
    const moved = /** @type {Trajectory} */ (voiceOf(genome, "drone").cutoff);
    // Kept to the end of the segment the morph starts inside, then held: no move to 1400.
    expect(moved.points).toEqual([
      [0, 250],
      [40, 900, "early"],
    ]);
    for (const time of [5, OUT_AT, OUT_AT + MOVES]) {
      expect(valueAt(moved, time, scale)).toBe(valueAt(cutoff, time, scale));
    }
  });
});

describe("instance ids", () => {
  /** @param {string} id the outgoing drone's, which the incoming sketch plays as a pad */
  const renamed = (id) =>
    morph(
      requireGenome({ ...OUT, voices: [{ ...voiceOf(OUT, "drone"), id }] }, "outgoing"),
      requireGenome({ ...IN, voices: [{ ...voiceOf(OUT, "pad"), id }] }, "incoming"),
    );

  test("a renamed instance keeps the 16-character limit, and its id names its voice", () => {
    const { genome } = held(renamed("abcdefghijkl"));
    expect(genome.voices.map(({ id }) => id).sort()).toEqual(["abcdefghijkl", "abcdefghijkl--in"]);
    for (const { id } of genome.voices) {
      expect(id).toMatch(VOICE_ID);
      expect(voiceOfInstance(id)).toBe("abcdefghijkl");
    }
  });

  test("an id too long to rename, or one that already ends in the suffix, falls back", () => {
    expect(reason(renamed("abcdefghijklm"))).toMatch(/too long to rename as abcdefghijklm--in/);
    expect(reason(renamed(`pad${MORPH_SUFFIX}`))).toMatch(/ends in "--in"/);
  });
});

describe("a morph that can't hold falls back to a crossfade", () => {
  const drone = voiceOf(OUT, "drone");
  /** @type {[string, Genome, Genome, RegExp][]} */
  const cases = [
    ["tuning", OUT, requireGenome({ ...IN, tuning: "19-edo", scale: "all" }, "19-edo"), /tunings/],
    [
      "scale",
      OUT,
      requireGenome({ ...IN, scale: "aeolian" }, "aeolian"),
      /scales \(dorian, aeolian\)/,
    ],
    ["key", OUT, requireGenome({ ...IN, key: 9 }, "key 9"), /keys \(2, 9\)/],
    ["pulse", OUT, requireGenome({ ...IN, pulse: "beat" }, "beat"), /pulses \(none, beat\)/],
    [
      "tempo",
      requireGenome({ ...OUT, pulse: "beat", bpm: 60 }, "60"),
      requireGenome({ ...IN, pulse: "beat", bpm: 72 }, "72"),
      /tempos \(60, 72 bpm\)/,
    ],
    [
      "voices",
      requireGenome(
        { ...OUT, voices: Array.from({ length: 10 }, (_, i) => ({ ...drone, id: `o${i}` })) },
        "ten",
      ),
      requireGenome(
        { ...IN, voices: Array.from({ length: 7 }, (_, i) => ({ ...drone, id: `i${i}` })) },
        "seven",
      ),
      new RegExp(`17 voices, more than ${MAX_VOICES}`),
    ],
    [
      "points",
      requireGenome(
        {
          ...OUT,
          voices: [
            {
              ...drone,
              level: {
                points: Array.from({ length: MAX_POINTS - 1 }, (_, i) =>
                  i === 0 ? [0, -10] : [i * 0.25, i % 2 ? -11 : -10, "linear"],
                ),
              },
            },
          ],
        },
        "dense",
      ),
      IN,
      new RegExp(`voices.drone.level ${MAX_POINTS + 1} points, more than ${MAX_POINTS}`),
    ],
  ];
  test.each(cases)("%s", (_name, outgoing, incoming, why) => {
    expect(reason(morph(outgoing, incoming))).toMatch(why);
  });
});

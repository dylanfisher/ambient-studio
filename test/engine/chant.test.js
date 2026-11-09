// Most checks read the voice's JS source directly, which is cheap; renders are short (3–9 s) to
// keep the gate light on a machine that also serves omlx.
/** @import { Breath, Singer } from "../../src/engine/chant.js" */
/** @import { Genome, Voice } from "../../src/engine/genome-schema.js" */
import { describe, expect, test } from "vitest";
import { spectralCentroid } from "../../src/domain/spectral-centroid.js";
import { chant, chantChunk, chantTrack, wanderAt } from "../../src/engine/chant.js";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import { GLOBAL_PARAMS } from "../../src/engine/genome-schema.js";
import chantGenome from "../../src/engine/genomes/chant.json" with { type: "json" };
import breathGenome from "../../src/engine/genomes/chant-breath.json" with { type: "json" };
import ensembleGenome from "../../src/engine/genomes/chant-ensemble.json" with { type: "json" };
import flutterGenome from "../../src/engine/genomes/chant-flutter.json" with { type: "json" };
import growlGenome from "../../src/engine/genomes/chant-growl.json" with { type: "json" };
import { requireGenome, validateGenome } from "../../src/engine/validate-genome.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";
import { renderOffline } from "../../src/server/render-offline.js";
import {
  difference,
  EXCERPT_BELOW_DB,
  EXCERPT_PEAK,
  renderUpFront,
} from "../support/compare-renders.js";
import { recordSources } from "../support/record-sources.js";

const RATE = 48000;
const SEED = 1;
const golden = requireGenome(chantGenome, "the chant golden genome");
const ensemble = requireGenome(ensembleGenome, "the six-singer chant golden genome");
const growling = requireGenome(growlGenome, "the growling chant golden genome");
const unsteady = requireGenome(flutterGenome, "the fluttering chant golden genome");
const breathing = requireGenome(breathGenome, "the breathing chant golden genome");
/** C2, the A-minor scale note nearest the 65 Hz default root. */
const C2 = 65.40639;
/** Growl at 0 until 1.5 s, up to 0.8, back to 0 at 4 s, and up again: it crosses 0 twice. */
const GROWL_IN_AND_OUT = {
  points: [
    [0, 0],
    [1.5, 0],
    [3, 0.8],
    [4, 0],
    [5, 0.5],
  ],
};

/**
 * A genome with one chant voice, A minor, the shortest and quietest reverb.
 * @param {Record<string, unknown>} [change]
 */
const oneChant = (change = {}) =>
  requireGenome(
    {
      fadeIn: 0,
      reverbDecay: GLOBAL_PARAMS.reverbDecay.min,
      reverbLevel: GLOBAL_PARAMS.reverbLevel.min,
      delayLevel: GLOBAL_PARAMS.delayLevel.min,
      voices: [{ id: "chant", type: "chant", ...change }],
    },
    "one chant voice",
  );

/**
 * The voice's source for timeline frames `[first, first + frames)`, mixed to mono.
 * @param {Genome} genome
 * @param {number} first
 * @param {number} frames
 */
const mono = (genome, first, frames) => {
  const track = chantTrack(genome, /** @type {Voice} */ (genome.voices[0]), RATE, SEED);
  const [left, right] = chantChunk(track, first, frames);
  return Float64Array.from(/** @type {Float32Array} */ (left), (v, i) => v + (right?.[i] ?? 0));
};

/**
 * The level of each 50 ms frame of a stereo source in dB, from the power of both channels.
 * @param {Float32Array[]} channels
 */
function frameLevels([left, right]) {
  const frame = RATE / 20;
  const l = /** @type {Float32Array} */ (left);
  const r = /** @type {Float32Array} */ (right);
  return Array.from({ length: Math.floor(l.length / frame) }, (_, f) => {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++)
      sum += /** @type {number} */ (l[i]) ** 2 + /** @type {number} */ (r[i]) ** 2;
    return 10 * Math.log10(sum / frame);
  });
}

/** @param {number[]} values */
const median = (values) =>
  /** @type {number} */ ([...values].sort((a, b) => a - b)[values.length >> 1]);

/**
 * A genome's chant track at seed 1, and its source for timeline frames `[0, seconds × RATE)`.
 * @param {Genome} genome
 * @param {number} seconds
 */
function source(genome, seconds) {
  const track = chantTrack(genome, /** @type {Voice} */ (genome.voices[0]), RATE, SEED);
  return { track, channels: chantChunk(track, 0, seconds * RATE) };
}

/**
 * The amplitude of `data` at `hz`, under a Hann window, by a single-bin DFT.
 * @param {ArrayLike<number>} data
 * @param {number} hz
 * @param {number} rate samples a second
 */
function amplitudeAt(data, hz, rate) {
  let re = 0;
  let im = 0;
  const n = data.length;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    const angle = (2 * Math.PI * hz * i) / rate;
    const x = w * /** @type {number} */ (data[i]);
    re += x * Math.cos(angle);
    im -= x * Math.sin(angle);
  }
  return Math.hypot(re, im);
}

/**
 * The levels of harmonics 1 to `count` of `f0` in dB under the strongest, and which is strongest.
 * @param {ArrayLike<number>} data
 * @param {number} f0
 * @param {number} count
 */
function harmonics(data, f0, count) {
  const levels = Array.from({ length: count }, (_, i) => amplitudeAt(data, (i + 1) * f0, RATE));
  const top = Math.max(...levels);
  return {
    strongest: levels.indexOf(top) + 1,
    db: levels.map((level) => 20 * Math.log10(level / top)),
  };
}

/**
 * The frequency from `lo` to `hi` Hz where `data` is strongest, to within `step`: scanned in
 * steps 20 times coarser, then in `step` around the coarse peak.
 * @param {ArrayLike<number>} data
 * @param {number} rate
 * @param {{ lo: number; hi: number; step: number }} scan
 */
function peakFrequency(data, rate, { lo, hi, step }) {
  /** @param {number} from @param {number} to @param {number} by */
  const scan = (from, to, by) => {
    let best = from;
    let bestLevel = -1;
    for (let hz = from; hz <= to; hz += by) {
      const level = amplitudeAt(data, hz, rate);
      if (level > bestLevel) [best, bestLevel] = [hz, level];
    }
    return best;
  };
  const coarse = scan(lo, hi, 20 * step);
  return scan(coarse - 20 * step, coarse + 20 * step, step);
}

describe("the chant voice", () => {
  test("is registered", () => {
    expect(voiceTypeIds()).toContain(chant.type);
  });

  test("the golden genome uses trajectories and a non-neutral macro", () => {
    expect(golden.voices.map((v) => v.type)).toEqual([chant.type]);
    expect(golden.voices[0]?.vowel).toHaveProperty("points");
    expect(golden.voices[0]?.bend).toHaveProperty("points");
    expect(golden.macros.brightness).not.toBe(0.5);
    // Brightness is mapped onto the vowel, so the macro above neutral opens it.
    const neutral = { ...golden, macros: { ...golden.macros, brightness: 0.5 } };
    const vowel = (/** @type {Genome} */ g) =>
      /** @type {number} */ (effectiveParams(g, 30).voices[0]?.vowel);
    expect(vowel(golden)).toBeGreaterThan(vowel(neutral));
  });

  test("one singer at a 65 Hz root sings a weak fundamental under a partial from 4 to 8, centroid under 700 Hz", async () => {
    const { channels } = await renderOffline(oneChant({ root: 65 }), { seed: 1, duration: 3 });
    const left = /** @type {Float32Array} */ (channels[0]).subarray(RATE, 3 * RATE);
    const { strongest, db } = harmonics(left, C2, 12);
    expect(strongest).toBeGreaterThanOrEqual(4);
    expect(strongest).toBeLessThanOrEqual(8);
    expect(db[0]).toBeLessThanOrEqual(-12);
    const { mean } = spectralCentroid(
      channels.map((c) => c.subarray(RATE)),
      RATE,
    );
    expect(mean).toBeLessThan(700);
  });

  test("moving the vowel from one end to the other moves the strongest partial by two or more", () => {
    const strongest = (/** @type {number} */ vowel) =>
      harmonics(mono(oneChant({ root: 65, vowel, depth: 0 }), 0, RATE), C2, 20).strongest;
    expect(Math.abs(strongest(1) - strongest(0))).toBeGreaterThanOrEqual(2);
  });

  test("focus raises the partial nearest the upper resonance above its neighbors", () => {
    const levels = (/** @type {number} */ focus) =>
      harmonics(mono(oneChant({ root: 65, vowel: 1, focus, depth: 0 }), 0, RATE), C2, 30).db;
    const flat = levels(0);
    const focused = levels(18);
    const gains = focused.map((d, i) => d - /** @type {number} */ (flat[i]));
    const most = gains.indexOf(Math.max(...gains));
    // The upper resonance at vowel 1 sits near 1 kHz, harmonic 15 of C2.
    expect(most + 1).toBeGreaterThanOrEqual(14);
    expect(most + 1).toBeLessThanOrEqual(16);
    expect(/** @type {number} */ (focused[most])).toBeGreaterThan(
      Math.max(
        /** @type {number} */ (focused[most - 1]),
        /** @type {number} */ (focused[most + 1]),
      ),
    );
  });

  test.each([0.38, 1])(
    "the level envelope's modulation spectrum peaks at a %s Hz pulse",
    (pulse) => {
      const seconds = 40;
      const data = mono(oneChant({ pulse }), 0, seconds * RATE);
      // RMS in 50 ms frames, its mean removed.
      const frame = RATE / 20;
      const envelope = Array.from({ length: seconds * 20 }, (_, f) => {
        let sum = 0;
        for (let i = f * frame; i < (f + 1) * frame; i++)
          sum += /** @type {number} */ (data[i]) ** 2;
        return Math.sqrt(sum / frame);
      });
      const mean = envelope.reduce((a, v) => a + v, 0) / envelope.length;
      const peak = peakFrequency(
        envelope.map((v) => v - mean),
        20,
        { lo: 0.05, hi: 3, step: 0.001 },
      );
      expect(Math.abs(peak - pulse) / pulse).toBeLessThan(0.1);
    },
  );

  test("a bend from 0 to 100 cents over 120 s raises the fundamental a semitone, within 2%", () => {
    const genome = oneChant({
      root: 65,
      depth: 0,
      bend: {
        points: [
          [0, 0],
          [120, 100],
        ],
      },
    });
    // Harmonic 5, the strongest, measured to 0.05 Hz (0.26 cents) over 2 s.
    const fundamental = (/** @type {number} */ second) =>
      peakFrequency(mono(genome, second * RATE, 2 * RATE), RATE, {
        lo: 5 * C2 * 0.97,
        hi: 5 * C2 * 1.1,
        step: 0.05,
      }) / 5;
    const cents = 1200 * Math.log2(fundamental(121) / fundamental(0));
    expect(Math.abs(cents - 100)).toBeLessThan(2);
  });

  test("one singer falls at least 20 dB in every breath, and between breaths sings the samples it sings without them", () => {
    const seconds = 60;
    const steady = source(oneChant({ phrase: 5 }), seconds).channels;
    const { track, channels } = source(oneChant({ phrase: 5, breath: 0.6 }), seconds);
    const breaths = track.breaths(0, seconds);
    const whole = breaths.filter((b) => b.end < seconds);
    expect(whole.length).toBeGreaterThanOrEqual(6);
    const levels = frameLevels(channels);
    const middle = median(frameLevels(steady));
    for (const { start, end } of whole) {
      const frame = Math.floor(((start + end) / 2) * 20);
      expect(/** @type {number} */ (levels[frame]), `breath at ${start} s`).toBeLessThan(
        middle - 20,
      );
    }
    // Outside its breaths the singer is bit for bit the singer without breaths; inside, the
    // difference moves no faster than the voice itself, so a breath fades and doesn't click.
    const inBreath = (/** @type {number} */ i) =>
      breaths.some(({ start, end }) => i >= start * RATE && i <= end * RATE);
    for (const c of [0, 1]) {
      const plain = /** @type {Float32Array} */ (steady[c]);
      const breathing = /** @type {Float32Array} */ (channels[c]);
      let voiceStep = 0;
      let gapStep = 0;
      let outside = 0;
      for (let i = 1; i < plain.length; i++) {
        const p = /** @type {number} */ (plain[i]);
        const b = /** @type {number} */ (breathing[i]);
        const before = /** @type {number} */ (plain[i - 1]);
        voiceStep = Math.max(voiceStep, Math.abs(p - before));
        gapStep = Math.max(
          gapStep,
          Math.abs(p - b - (before - /** @type {number} */ (breathing[i - 1]))),
        );
        if (!inBreath(i) && p !== b) outside++;
      }
      expect(outside).toBe(0);
      expect(gapStep).toBeLessThanOrEqual(voiceStep);
    }
  });

  test.each([6, 12])(
    "%s singers never fall 12 dB under their median in a 60 s render",
    (singers) => {
      const seconds = 60;
      const { track, channels } = source(
        oneChant({ singers, spread: 15, phrase: 8, breath: 0.6 }),
        seconds,
      );
      const breaths = Array.from({ length: singers }, (_, s) => track.breaths(s, seconds).length);
      expect(breaths.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(singers * 4);
      const levels = frameLevels(channels);
      expect(Math.min(...levels)).toBeGreaterThan(median(levels) - 12);
    },
  );

  test("six singers spread in pitch within `spread` cents sound wide: side/mid 0.5 or more", async () => {
    const spread = 20;
    const genome = requireGenome(
      {
        ...oneChant(),
        width: 0,
        voices: [{ id: "chant", type: "chant", singers: 6, spread }],
      },
      "six singers",
    );
    const { singers } = chantTrack(genome, /** @type {Voice} */ (genome.voices[0]), RATE, SEED);
    expect(singers.length).toBe(6);
    expect(new Set(singers.map((s) => s.cents)).size).toBe(6);
    for (const { cents } of singers) expect(Math.abs(cents)).toBeLessThanOrEqual(spread);
    const { channels } = await renderOffline(genome, { seed: SEED, duration: 4 });
    const [left, right] = channels.map((c) => c.subarray(RATE));
    let side = 0;
    let mid = 0;
    for (let i = 0; i < /** @type {Float32Array} */ (left).length; i++) {
      const l = /** @type {number} */ (left?.[i]);
      const r = /** @type {number} */ (right?.[i]);
      side += (l - r) ** 2;
      mid += (l + r) ** 2;
    }
    expect(Math.sqrt(side / mid)).toBeGreaterThanOrEqual(0.5);
  });

  test.each([
    ["", {}],
    [", with flutter and shimmer on,", { flutter: 1, shimmer: 1 }],
  ])("adding singers%s keeps the first ones' pitch, place, breaths and wander", (_, change) => {
    const at = (/** @type {number} */ singers) =>
      source(oneChant({ singers, breath: 0.6, ...change }), 0).track;
    const four = at(4);
    const nine = at(9);
    expect(nine.singers.slice(0, 4)).toEqual(four.singers);
    for (let s = 0; s < 4; s++) expect(nine.breaths(s, 120)).toEqual(four.breaths(s, 120));
  });

  test.each([
    ["one singer", golden],
    ["six singers", ensemble],
    ["twelve singers", oneChant({ singers: 12, spread: 30, phrase: 3, breath: 1 })],
    ["one singer, growl moving in and out of 0", oneChant({ growl: GROWL_IN_AND_OUT })],
    [
      "six singers, growl moving in and out of 0",
      oneChant({ singers: 6, growl: GROWL_IN_AND_OUT }),
    ],
    ["six singers growling, rough", growling],
    ["one singer, flutter and shimmer", oneChant({ flutter: 1, shimmer: 1 })],
    [
      "six singers breathing, flutter and shimmer",
      oneChant({ singers: 6, breath: 0.6, phrase: 3, flutter: 1, shimmer: 1 }),
    ],
    ["five singers growling, rough, flutter and shimmer", unsteady],
    [
      "one singer breathing, aspiration and breathiness",
      oneChant({ phrase: 3, breath: 0.8, aspiration: 0.7, breathiness: 1 }),
    ],
    ["four singers breathing, aspiration moving, breathiness, growl and flutter", breathing],
  ])(
    "%s: its source is the same whichever window computes it, and from a track started anywhere",
    (_, genome) => {
      const voice = /** @type {Voice} */ (genome.voices[0]);
      const whole = chantChunk(chantTrack(genome, voice, RATE, SEED), 0, 5 * RATE);
      // Splits off the control grid and off the window boundaries, as an excerpt's first window.
      const track = chantTrack(genome, voice, RATE, SEED);
      const parts = [
        chantChunk(track, 0, RATE + 333),
        chantChunk(track, RATE + 333, 2 * RATE),
        chantChunk(track, 3 * RATE + 333, 2 * RATE - 333),
      ];
      for (const c of [0, 1]) {
        const joined = new Float32Array(5 * RATE);
        let at = 0;
        for (const part of parts) {
          joined.set(/** @type {Float32Array} */ (part[c]), at);
          at += /** @type {Float32Array} */ (part[c]).length;
        }
        expect(joined).toEqual(whole[c]);
      }
      // A fresh track asked first for a late frame gives the samples one that ran from 0 gives.
      const late = 40 * RATE + 777;
      const ran = chantTrack(genome, voice, RATE, SEED);
      chantChunk(ran, 0, late);
      expect(chantChunk(chantTrack(genome, voice, RATE, SEED), late, RATE)).toEqual(
        chantChunk(ran, late, RATE),
      );
    },
  );

  test.each([
    ["one singer", golden],
    ["six singers", ensemble],
    ["four singers, growl a trajectory, rough", growling],
    ["five singers, flutter and shimmer", unsteady],
    ["four singers, aspiration and breathiness", breathing],
  ])(
    "%s: excerpts at several offsets match their window of a full render (0007's tolerance)",
    async (_, genome) => {
      const full = 9;
      const whole = await renderOffline(genome, { seed: 1, duration: full });
      for (const offset of [0.7, 3.35, 6.1]) {
        const length = 2.5;
        const excerpt = await renderOffline(genome, { seed: 1, duration: length, offset });
        const from = Math.round(offset * RATE);
        const window = {
          ...whole,
          channels: whole.channels.map((c) => c.slice(from, from + Math.round(length * RATE))),
        };
        const { peak, belowDb } = difference(excerpt, window);
        expect(peak, `offset ${offset}`).toBeLessThan(EXCERPT_PEAK);
        expect(belowDb, `offset ${offset}`).toBeGreaterThan(EXCERPT_BELOW_DB);
        expect(excerpt.channels[0]?.some((v) => Math.abs(v) > 1e-3)).toBe(true);
      }
    },
  );

  test("plays a buffer a window, each starting where the last ends, the same as up front", async () => {
    /** @type {import("../support/record-sources.js").StartedSource[]} */
    let started = [];
    const windowed = await renderOffline(golden, { seed: 1, duration: 5 }, (ctx) => {
      started = recordSources(ctx);
    });
    expect(started).toEqual([
      { frame: 0, frames: 2 * RATE },
      { frame: 2 * RATE, frames: 2 * RATE },
      { frame: 4 * RATE, frames: RATE },
    ]);
    expect((await renderUpFront(golden, { seed: 1, duration: 5 })).channels).toEqual(
      windowed.channels,
    );
  });

  test("validates every parameter's range, and which may be trajectories", () => {
    /** @param {Record<string, unknown>} change */
    const errors = (change) => {
      const result = validateGenome({ voices: [{ id: "chant", type: "chant", ...change }] });
      return result.ok ? [] : result.errors.map((e) => e.path);
    };
    expect(errors({})).toEqual([]);
    for (const [name, descriptor] of Object.entries(chant.params)) {
      const path = `$.voices[0].${name}`;
      expect(errors({ [name]: descriptor.min - 1 }), `${name} below`).toEqual([path]);
      expect(errors({ [name]: descriptor.max + 1 }), `${name} above`).toEqual([path]);
      const trajectory = {
        points: [
          [0, descriptor.default],
          [10, descriptor.default],
        ],
      };
      expect(errors({ [name]: trajectory }).length, `${name} as a trajectory`).toBe(
        descriptor.trajectory ? 0 : 1,
      );
    }
    expect(Object.keys(chant.params).sort()).toEqual(
      [
        "aspiration",
        "bend",
        "breath",
        "breathiness",
        "depth",
        "flutter",
        "focus",
        "growl",
        "pan",
        "phrase",
        "pulse",
        "root",
        "rough",
        "shimmer",
        "singers",
        "spread",
        "tilt",
        "vowel",
      ].sort(),
    );
    expect(errors({ singers: 12 })).toEqual([]);
    expect(errors({ singers: 2.5 })).toEqual(["$.voices[0].singers"]);
    // Growl may move over the track; rough is fixed for it.
    expect(errors({ growl: GROWL_IN_AND_OUT, rough: 1 })).toEqual([]);
    expect(errors({ rough: { points: [[0, 0]] } })).toEqual(["$.voices[0].rough"]);
    expect(errors({ growl: 1.5, rough: -0.5 })).toEqual(["$.voices[0].growl", "$.voices[0].rough"]);
    // Flutter and shimmer are fixed for the track.
    expect(errors({ flutter: 1, shimmer: 1 })).toEqual([]);
    expect(errors({ flutter: { points: [[0, 1]] } })).toEqual(["$.voices[0].flutter"]);
    expect(errors({ shimmer: { points: [[0, 1]] } })).toEqual(["$.voices[0].shimmer"]);
    // Aspiration may move over the track; breathiness is fixed for it.
    expect(
      errors({
        aspiration: {
          points: [
            [0, 0],
            [5, 1],
          ],
        },
        breathiness: 1,
      }),
    ).toEqual([]);
    expect(errors({ breathiness: { points: [[0, 1]] } })).toEqual(["$.voices[0].breathiness"]);
    expect(errors({ aspiration: 1.5, breathiness: -0.5 })).toEqual([
      "$.voices[0].aspiration",
      "$.voices[0].breathiness",
    ]);
  });

  test("the golden ensemble has six singers who breathe, spread in pitch and place", () => {
    const voice = /** @type {Voice} */ (ensemble.voices[0]);
    expect(voice.singers).toBe(6);
    expect(voice.breath).toBeGreaterThan(0);
    expect(voice.spread).toBeGreaterThan(0);
    expect(voice.pan).toBeGreaterThan(0);
    // Some singer breathes inside the excerpts' 9 s.
    const { track } = source(ensemble, 0);
    expect(track.breaths(0, 9).length + track.breaths(1, 9).length).toBeGreaterThan(0);
  });

  test("its cost grows with its singers, and twelve at the default root fit beside a 12 s reverb", () => {
    const at = (/** @type {number} */ singers) =>
      chant.cost(/** @type {Voice} */ (oneChant({ singers }).voices[0]), oneChant({ singers }));
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(12)).toBeGreaterThan(at(6));
    const genome = requireGenome(
      { reverbDecay: 12, voices: [{ id: "c", type: "chant", singers: 12 }] },
      "twelve singers with a 12 s reverb",
    );
    expect(cost(genome)).toBeLessThanOrEqual(COST_BUDGET);
  });

  // The densest chant with the longest reverb (20 s) is over the budget, as the densest cloud
  // is, and `randomGenome` redraws such genomes (decision 0069).
  test("its cost grows with its partials, and the lowest root fits beside a 16 s reverb", () => {
    const at = (/** @type {number} */ root) =>
      chant.cost(/** @type {Voice} */ (oneChant({ root }).voices[0]), oneChant({ root }));
    expect(at(33)).toBeGreaterThan(at(65));
    expect(at(65)).toBeGreaterThan(at(135));
    const genome = requireGenome(
      { reverbDecay: 16, voices: [{ id: "c", type: "chant", root: 33 }] },
      "a low chant with a long reverb",
    );
    expect(cost(genome)).toBeLessThanOrEqual(COST_BUDGET);
  });
});

/**
 * The strongest integer and the strongest half-integer partial of C2 from 200 to 800 Hz, in dB.
 * @param {ArrayLike<number>} data
 */
function bandPartials(data) {
  /** @type {number[]} */
  const integers = [];
  /** @type {number[]} */
  const halves = [];
  for (let n = 0.5; n * C2 <= 800; n += 0.5) {
    if (n * C2 < 200) continue;
    const db = 20 * Math.log10(amplitudeAt(data, n * C2, RATE));
    (Number.isInteger(n) ? integers : halves).push(db);
  }
  return { integer: Math.max(...integers), half: Math.max(...halves) };
}

/**
 * The peak level in dB of each of a one-singer chant's first `count` cycles, at a steady pitch.
 * Each runs from half a cycle before the fundamental's phase is whole to half a cycle after, so
 * it holds one whole pulse of the harmonics, which all rise through 0 together.
 * @param {Genome} genome
 * @param {number} count
 */
function cyclePeaks(genome, count) {
  const track = chantTrack(genome, /** @type {Voice} */ (genome.voices[0]), RATE, SEED);
  const hz = track.control(0).hz;
  const [left] = chantChunk(track, 0, Math.ceil(((count + 1.5) * RATE) / hz));
  const data = /** @type {Float32Array} */ (left);
  return Array.from({ length: count }, (_, c) => {
    let peak = 0;
    const to = Math.ceil(((c + 1.5) * RATE) / hz);
    for (let i = Math.ceil(((c + 0.5) * RATE) / hz); i < to; i++)
      peak = Math.max(peak, Math.abs(/** @type {number} */ (data[i])));
    return 20 * Math.log10(peak);
  });
}

/**
 * How far each cycle's peak level is from the next one's, in dB.
 * @param {number[]} peaks
 */
const peakSteps = (peaks) =>
  peaks.slice(1).map((p, c) => Math.abs(p - /** @type {number} */ (peaks[c])));

/**
 * A genome's chant source for timeline frames `[0, frames)`, from a fresh track.
 * @param {Genome} genome
 * @param {number} frames
 */
const sourceOf = (genome, frames) =>
  chantChunk(chantTrack(genome, /** @type {Voice} */ (genome.voices[0]), RATE, SEED), 0, frames);

describe("the chant's growl and rough", () => {
  test.each([0, 0.2, 1])(
    "at vowel %s, growl 1 sets the strongest half-integer partial in 200–800 Hz within 6 dB of the strongest integer one",
    (vowel) => {
      const partials = (/** @type {number} */ growl) =>
        bandPartials(mono(oneChant({ root: 65, vowel, depth: 0, growl }), 0, RATE));
      const on = partials(1);
      expect(Math.abs(on.half - on.integer)).toBeLessThanOrEqual(6);
      const off = partials(0);
      expect(off.half).toBeLessThan(off.integer - 60);
    },
  );

  test.each([0, 1])(
    "at growl %s, rough 1 sets neighboring cycles' peaks 2 dB or more apart",
    (growl) => {
      const steps = peakSteps(cyclePeaks(oneChant({ root: 65, depth: 0, growl, rough: 1 }), 100));
      expect(Math.min(...steps)).toBeGreaterThanOrEqual(2);
    },
  );

  test.each([0, 1])(
    "at growl %s, rough 0 keeps neighboring cycles' peaks under 0.1 dB apart",
    (growl) => {
      const steps = peakSteps(cyclePeaks(oneChant({ root: 65, depth: 0, growl, rough: 0 }), 100));
      expect(Math.max(...steps)).toBeLessThan(0.1);
    },
  );

  test.each([
    ["one singer", golden],
    ["six singers", ensemble],
  ])("%s: growl 0 and rough 0 sing the samples the chant sings without them", (_, genome) => {
    const zeros = requireGenome(
      { ...genome, voices: genome.voices.map((v) => ({ ...v, growl: 0, rough: 0 })) },
      "growl and rough at 0",
    );
    expect(sourceOf(zeros, 3 * RATE)).toEqual(sourceOf(genome, 3 * RATE));
  });

  test("six singers sing the samples they sing without growl until it leaves 0, and others after", () => {
    const plain = sourceOf(oneChant({ singers: 6 }), 3 * RATE);
    const moving = sourceOf(oneChant({ singers: 6, growl: GROWL_IN_AND_OUT }), 3 * RATE);
    const until = 1.5 * RATE;
    for (const c of [0, 1]) {
      const a = /** @type {Float32Array} */ (plain[c]);
      const b = /** @type {Float32Array} */ (moving[c]);
      expect(b.subarray(0, until)).toEqual(a.subarray(0, until));
      expect(b.subarray(2 * RATE)).not.toEqual(a.subarray(2 * RATE));
    }
  });

  test("the growling golden has growl as a trajectory, rough, a chorus and a non-neutral macro", () => {
    const voice = /** @type {Voice} */ (growling.voices[0]);
    expect(voice.growl).toHaveProperty("points");
    expect(voice.rough).toBeGreaterThan(0);
    expect(voice.singers).toBeGreaterThan(1);
    expect(growling.macros.brightness).not.toBe(0.5);
  });

  test("growl prices its partials wherever it rises above 0, and twelve singers with growl and rough at 1 fit beside a 12 s reverb", () => {
    /** @param {Record<string, unknown>} change */
    const at = (change) => {
      const genome = oneChant(change);
      return chant.cost(/** @type {Voice} */ (genome.voices[0]), genome);
    };
    const plain = at({});
    expect(at({ growl: 0, rough: 0 })).toBe(plain);
    expect(at({ growl: 1 })).toBeGreaterThan(plain);
    expect(at({ growl: GROWL_IN_AND_OUT })).toBe(at({ growl: 1 }));
    expect(at({ rough: 1 })).toBeGreaterThan(plain);
    expect(at({ growl: 1, rough: 1 })).toBeGreaterThanOrEqual(at({ growl: 1 }));
    const genome = requireGenome(
      { reverbDecay: 12, voices: [{ id: "c", type: "chant", singers: 12, growl: 1, rough: 1 }] },
      "twelve singers growling with a 12 s reverb",
    );
    expect(cost(genome)).toBeLessThanOrEqual(COST_BUDGET);
  });
});

/**
 * Centered moving means of `data` over `2h + 1` points, edges averaged over what they hold.
 * @param {Float64Array} data
 * @param {number} h
 */
function movingMean(data, h) {
  const sums = new Float64Array(data.length + 1);
  for (let i = 0; i < data.length; i++)
    sums[i + 1] = /** @type {number} */ (sums[i]) + /** @type {number} */ (data[i]);
  return Float64Array.from(data, (_, i) => {
    const lo = Math.max(0, i - h);
    const hi = Math.min(data.length, i + h + 1);
    const upper = /** @type {number} */ (sums[hi]);
    const lower = /** @type {number} */ (sums[lo]);
    return (upper - lower) / (hi - lo);
  });
}

/** Points a second the measured wanders are sampled at. */
const TRACE_RATE = 100;

/**
 * The pitch of harmonic `n` of `f0` in `data`, in cents from `n × f0`, at `TRACE_RATE`: the
 * harmonic is shifted to 0 Hz and smoothed twice over one cycle of f0, which nulls every other
 * harmonic, and its phase is differenced over each 1/TRACE_RATE s. The k-th value is the mean
 * pitch from `k / TRACE_RATE` s to the next.
 * @param {ArrayLike<number>} data
 * @param {number} f0
 * @param {number} n
 */
function pitchTrace(data, f0, n) {
  const hz = n * f0;
  const h = Math.round(RATE / f0 / 2);
  const re = new Float64Array(data.length);
  const im = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const angle = (2 * Math.PI * hz * i) / RATE;
    re[i] = /** @type {number} */ (data[i]) * Math.cos(angle);
    im[i] = -(/** @type {number} */ (data[i])) * Math.sin(angle);
  }
  const x = movingMean(movingMean(re, h), h);
  const y = movingMean(movingMean(im, h), h);
  const hop = RATE / TRACE_RATE;
  /** @type {number[]} */
  const cents = [];
  for (let i = 0; i + hop < data.length; i += hop) {
    const a = Math.atan2(/** @type {number} */ (y[i]), /** @type {number} */ (x[i]));
    const b = Math.atan2(/** @type {number} */ (y[i + hop]), /** @type {number} */ (x[i + hop]));
    let turn = (b - a) / (2 * Math.PI);
    turn -= Math.round(turn);
    cents.push(1200 * Math.log2(1 + (turn * TRACE_RATE) / hz));
  }
  return cents;
}

/**
 * The level of `data` in dB over each cycle of f0, at the cycle's middle time.
 * @param {ArrayLike<number>} data
 * @param {number} f0
 */
function cycleLevels(data, f0) {
  const n = Math.round(RATE / f0);
  /** @type {{ t: number; db: number }[]} */
  const levels = [];
  for (let at = 0; at + n <= data.length; at += n) {
    let sum = 0;
    for (let i = at; i < at + n; i++) sum += /** @type {number} */ (data[i]) ** 2;
    levels.push({ t: (at + n / 2) / RATE, db: 10 * Math.log10(sum / n) });
  }
  return levels;
}

/** @param {number[]} values */
const withoutMean = (values) => {
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  return values.map((v) => v - mean);
};

/** @param {number[]} values */
const rms = (values) => {
  const centered = withoutMean(values);
  return Math.sqrt(centered.reduce((a, v) => a + v * v, 0) / centered.length);
};

/**
 * Pearson's correlation of two equally long series.
 * @param {number[]} a
 * @param {number[]} b
 */
function correlation(a, b) {
  const x = withoutMean(a);
  const y = withoutMean(b);
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < x.length; i++) {
    const p = /** @type {number} */ (x[i]);
    const q = /** @type {number} */ (y[i]);
    xy += p * q;
    xx += p * p;
    yy += q * q;
  }
  return xy / Math.sqrt(xx * yy);
}

/**
 * The share of a series' power, its mean removed, from `lo` to `hi` Hz, by a DFT at its own
 * resolution.
 * @param {number[]} values sampled at `rate`
 * @param {number} rate
 * @param {number} lo
 * @param {number} hi
 */
function bandShare(values, rate, lo, hi) {
  const x = withoutMean(values);
  const n = x.length;
  const total = x.reduce((a, v) => a + v * v, 0) / n;
  let band = 0;
  for (let k = Math.ceil((lo * n) / rate); k <= Math.floor((hi * n) / rate); k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * k * i) / n;
      re += /** @type {number} */ (x[i]) * Math.cos(angle);
      im -= /** @type {number} */ (x[i]) * Math.sin(angle);
    }
    band += (2 * (re * re + im * im)) / (n * n);
  }
  return band / total;
}

/**
 * A wander function sampled at `TRACE_RATE` from 0 for `seconds`, each value the mean over its
 * step, as `pitchTrace` measures.
 * @param {(t: number) => number} wander
 * @param {number} seconds
 */
const sampled = (wander, seconds) =>
  Array.from({ length: seconds * TRACE_RATE }, (_, k) => {
    let sum = 0;
    for (let j = 0; j < 10; j++) sum += wander((k + (j + 0.5) / 10) / TRACE_RATE);
    return sum / 10;
  });

/**
 * A genome's singer `s` at seed 1.
 * @param {Genome} genome
 * @param {number} s
 */
const singerOf = (genome, s) => /** @type {Singer} */ (source(genome, 0).track.singers[s]);

/**
 * The left and right channels of a source, summed.
 * @param {Float32Array[]} channels
 */
const summed = ([left, right]) =>
  Float64Array.from(
    /** @type {Float32Array} */ (left),
    (v, i) => v + /** @type {number} */ (right?.[i]),
  );

describe("the chant's flutter and shimmer", () => {
  const seconds = 20;
  // A trace's first and last tenth of a second hold the smoothing's edges.
  const inner = (/** @type {number[]} */ values) => values.slice(10, -10);

  test("flutter 1 gives one singer a pitch wander of 2–8 cents RMS, 70% or more of its power in 1–8 Hz, measured on its sound", () => {
    const genome = oneChant({ root: 65, depth: 0, flutter: 1 });
    const { track, channels } = source(genome, seconds);
    // Harmonic 5 is the strongest at the default vowel.
    const measured = inner(pitchTrace(summed(channels), track.control(0).hz, 5));
    const lead = /** @type {Singer} */ (track.singers[0]);
    const expected = inner(sampled((t) => wanderAt(lead.flutter, t), seconds)).slice(0, -1);
    expect(rms(measured)).toBeGreaterThanOrEqual(2);
    expect(rms(measured)).toBeLessThanOrEqual(8);
    expect(bandShare(measured, TRACE_RATE, 1, 8)).toBeGreaterThanOrEqual(0.7);
    // The sound follows the voice's own pitch wander, so the phase integrates it at its scale.
    expect(rms(measured) / rms(expected)).toBeGreaterThan(0.95);
    expect(rms(measured) / rms(expected)).toBeLessThan(1.05);
    expect(correlation(measured, expected)).toBeGreaterThan(0.98);
  });

  test("a chorus singer reads the shared table at its own wandering pitch", () => {
    const change = { root: 65, depth: 0, spread: 0, flutter: 1 };
    const pair = oneChant({ ...change, singers: 2 });
    const two = summed(sourceOf(pair, seconds * RATE));
    const one = summed(sourceOf(oneChant(change), seconds * RATE));
    // The lead sings the same samples at 1/√2 of its level, so what's left is singer 1 alone.
    const data = two.map((v, i) => v - /** @type {number} */ (one[i]) / Math.SQRT2);
    const { track } = source(pair, 0);
    const singer = /** @type {Singer} */ (track.singers[1]);
    const measured = inner(pitchTrace(data, track.control(0).hz, 5));
    const expected = inner(sampled((t) => wanderAt(singer.flutter, t), seconds)).slice(0, -1);
    const lead = inner(
      sampled((t) => wanderAt(/** @type {Singer} */ (track.singers[0]).flutter, t), seconds),
    ).slice(0, -1);
    expect(rms(measured)).toBeGreaterThanOrEqual(2);
    expect(rms(measured) / rms(expected)).toBeGreaterThan(0.95);
    expect(rms(measured) / rms(expected)).toBeLessThan(1.05);
    expect(correlation(measured, expected)).toBeGreaterThan(0.98);
    expect(Math.abs(correlation(measured, lead))).toBeLessThan(0.2);
  });

  test("shimmer 1 gives one singer a level wander of 0.3–1.5 dB RMS, measured on its sound", () => {
    const genome = oneChant({ root: 65, depth: 0, shimmer: 1 });
    const { track, channels } = source(genome, seconds);
    const levels = cycleLevels(summed(channels), track.control(0).hz);
    const measured = levels.map((l) => l.db);
    const lead = /** @type {Singer} */ (track.singers[0]);
    const expected = levels.map((l) => wanderAt(lead.shimmer, l.t));
    expect(rms(measured)).toBeGreaterThanOrEqual(0.3);
    expect(rms(measured)).toBeLessThanOrEqual(1.5);
    expect(rms(measured) / rms(expected)).toBeGreaterThan(0.95);
    expect(rms(measured) / rms(expected)).toBeLessThan(1.05);
    expect(correlation(measured, expected)).toBeGreaterThan(0.98);
  });

  test("a chorus singer's level follows its own shimmer, measured on its sound", () => {
    const change = { root: 65, depth: 0, spread: 0, shimmer: 1 };
    const pair = oneChant({ ...change, singers: 2 });
    const two = summed(sourceOf(pair, seconds * RATE));
    const one = summed(sourceOf(oneChant(change), seconds * RATE));
    // The lead sings the same samples at 1/√2 of its level, so what's left is singer 1 alone.
    const data = two.map((v, i) => v - /** @type {number} */ (one[i]) / Math.SQRT2);
    const { track } = source(pair, 0);
    const levels = cycleLevels(data, track.control(0).hz);
    const measured = levels.map((l) => l.db);
    const singer = /** @type {Singer} */ (track.singers[1]);
    const lead = /** @type {Singer} */ (track.singers[0]);
    const expected = levels.map((l) => wanderAt(singer.shimmer, l.t));
    expect(rms(measured)).toBeGreaterThanOrEqual(0.3);
    expect(rms(measured) / rms(expected)).toBeGreaterThan(0.95);
    expect(rms(measured) / rms(expected)).toBeLessThan(1.05);
    expect(correlation(measured, expected)).toBeGreaterThan(0.98);
    const leads = levels.map((l) => wanderAt(lead.shimmer, l.t));
    expect(Math.abs(correlation(measured, leads))).toBeLessThan(0.2);
  });

  test("each of twelve singers wanders within the ranges at 1, and no two singers' wanders correlate 0.2 or more", () => {
    for (const seed of [1, 2, 3]) {
      const genome = oneChant({ singers: 12, flutter: 1, shimmer: 1 });
      const { singers } = chantTrack(genome, /** @type {Voice} */ (genome.voices[0]), RATE, seed);
      const pitch = singers.map((s) => sampled((t) => wanderAt(s.flutter, t), 30));
      const level = singers.map((s) => sampled((t) => wanderAt(s.shimmer, t), 30));
      for (let a = 0; a < singers.length; a++) {
        const p = /** @type {number[]} */ (pitch[a]);
        const l = /** @type {number[]} */ (level[a]);
        const who = `seed ${seed}, singer ${a}`;
        expect(rms(p), who).toBeGreaterThanOrEqual(2);
        expect(rms(p), who).toBeLessThanOrEqual(8);
        expect(bandShare(p, TRACE_RATE, 1, 8), who).toBeGreaterThanOrEqual(0.7);
        expect(rms(l), who).toBeGreaterThanOrEqual(0.3);
        expect(rms(l), who).toBeLessThanOrEqual(1.5);
        for (let b = a + 1; b < singers.length; b++) {
          const pair = `seed ${seed}, singers ${a} and ${b}`;
          const q = /** @type {number[]} */ (pitch[b]);
          const m = /** @type {number[]} */ (level[b]);
          expect(Math.abs(correlation(p, q)), pair).toBeLessThan(0.2);
          expect(Math.abs(correlation(l, m)), pair).toBeLessThan(0.2);
        }
      }
    }
  });

  test("flutter and shimmer scale the wander, and at 0 there is none", () => {
    const full = singerOf(oneChant({ flutter: 1, shimmer: 1 }), 0);
    const half = singerOf(oneChant({ flutter: 0.5, shimmer: 0.5 }), 0);
    expect(rms(sampled((t) => wanderAt(full.flutter, t), 5))).toBeGreaterThan(1);
    for (const t of [0.3, 1.7, 12.25]) {
      expect(wanderAt(half.flutter, t)).toBeCloseTo(wanderAt(full.flutter, t) / 2, 12);
      expect(wanderAt(half.shimmer, t)).toBeCloseTo(wanderAt(full.shimmer, t) / 2, 12);
    }
    const off = singerOf(oneChant({ flutter: 0, shimmer: 0 }), 0);
    expect(off.flutter).toEqual([]);
    expect(off.shimmer).toEqual([]);
  });

  test.each([
    ["one singer", golden],
    ["six singers", ensemble],
    ["four singers growling, rough", growling],
  ])("%s: flutter 0 and shimmer 0 sing the samples the chant sings without them", (_, genome) => {
    const zeros = requireGenome(
      { ...genome, voices: genome.voices.map((v) => ({ ...v, flutter: 0, shimmer: 0 })) },
      "flutter and shimmer at 0",
    );
    expect(sourceOf(zeros, 3 * RATE)).toEqual(sourceOf(genome, 3 * RATE));
  });

  test("turning flutter and shimmer on moves none of the singers' other draws", () => {
    const at = (/** @type {Record<string, unknown>} */ change) =>
      source(oneChant({ singers: 6, breath: 0.6, ...change }), 0).track;
    const plain = at({});
    const wandering = at({ flutter: 1, shimmer: 1 });
    const placed = (/** @type {readonly Singer[]} */ singers) =>
      singers.map(({ cents, pan, phase }) => ({ cents, pan, phase }));
    expect(placed(wandering.singers)).toEqual(placed(plain.singers));
    for (let s = 0; s < 6; s++) expect(wandering.breaths(s, 120)).toEqual(plain.breaths(s, 120));
  });

  test("the fluttering golden has flutter, shimmer, growl, a chorus that breathes and a non-neutral macro", () => {
    const voice = /** @type {Voice} */ (unsteady.voices[0]);
    expect(voice.flutter).toBeGreaterThan(0);
    expect(voice.shimmer).toBeGreaterThan(0);
    expect(voice.growl).toBeGreaterThan(0);
    expect(voice.singers).toBeGreaterThan(1);
    expect(voice.breath).toBeGreaterThan(0);
    expect(unsteady.macros.motion).not.toBe(0.5);
  });

  test("flutter and shimmer price each singer's wander, and twelve singers with growl, rough, flutter and shimmer at 1 fit beside a 12 s reverb", () => {
    /** @param {Record<string, unknown>} change */
    const at = (change) => {
      const genome = oneChant(change);
      return chant.cost(/** @type {Voice} */ (genome.voices[0]), genome);
    };
    const plain = at({ singers: 12 });
    expect(at({ singers: 12, flutter: 0, shimmer: 0 })).toBe(plain);
    expect(at({ singers: 12, flutter: 1 })).toBeGreaterThan(plain);
    expect(at({ singers: 12, shimmer: 1 })).toBeGreaterThan(plain);
    expect(at({ singers: 12, flutter: 0.1 })).toBe(at({ singers: 12, flutter: 1 }));
    const chorus = (/** @type {Record<string, unknown>} */ change) =>
      at({ singers: 12, ...change }) - at({ singers: 1, ...change });
    expect(chorus({ flutter: 1, shimmer: 1 })).toBeGreaterThan(chorus({}));
    const genome = requireGenome(
      {
        reverbDecay: 12,
        voices: [
          { id: "c", type: "chant", singers: 12, growl: 1, rough: 1, flutter: 1, shimmer: 1 },
        ],
      },
      "twelve unsteady singers growling with a 12 s reverb",
    );
    expect(cost(genome)).toBeLessThanOrEqual(COST_BUDGET);
  });
});

/**
 * The power of `data` between the harmonics of `f0` from 200 to 800 Hz: at each midpoint between
 * two harmonics, by `amplitudeAt`.
 * @param {ArrayLike<number>} data
 * @param {number} f0
 */
function betweenHarmonics(data, f0) {
  let power = 0;
  for (let n = 1.5; n * f0 <= 800; n++)
    if (n * f0 >= 200) power += amplitudeAt(data, n * f0, RATE) ** 2;
  return power;
}

/** @param {ArrayLike<number>} data */
const rmsOf = (data) => {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += /** @type {number} */ (data[i]) ** 2;
  return Math.sqrt(sum / data.length);
};

/** @param {number} ratio */
const db = (ratio) => 20 * Math.log10(ratio);

/**
 * A source's noise alone: the source with aspiration on, less the one without, whose partials
 * aspiration a scales by √(1 − 0.1 a²) to make room for its noise.
 * @param {Float64Array} on
 * @param {Float64Array} off
 * @param {number} aspiration
 */
const noiseOf = (on, off, aspiration) =>
  on.map((v, i) => v - /** @type {number} */ (off[i]) * Math.sqrt(1 - 0.1 * aspiration ** 2));

/**
 * The frequency from 20 to 300 Hz where the envelope of `noise`, its square, is strongest.
 * @param {Float64Array} noise
 */
function modulationPeak(noise) {
  const envelope = noise.map((v) => v * v);
  const mean = envelope.reduce((a, v) => a + v, 0) / envelope.length;
  return peakFrequency(
    envelope.map((v) => v - mean),
    RATE,
    { lo: 20, hi: 300, step: 0.1 },
  );
}

/**
 * The share of `data`'s power from `lo` to `hi` Hz, from its amplitudes every 10 Hz to 4 kHz.
 * @param {ArrayLike<number>} data
 * @param {number} lo
 * @param {number} hi
 */
function spectrumShare(data, lo, hi) {
  let band = 0;
  let total = 0;
  for (let hz = 20; hz <= 4000; hz += 10) {
    const power = amplitudeAt(data, hz, RATE) ** 2;
    total += power;
    if (hz >= lo && hz <= hi) band += power;
  }
  return band / total;
}

/**
 * The breath schedule of four singers, phrase 5 s and breath 0.8 s, seed 1, up to 12 s, as the
 * commit before aspiration and breathiness computed it.
 */
const CV2_SCHEDULE = [
  [
    [1.1821828816237734, 2.04095210844305],
    [9.764936076732496, 10.68472018807582],
  ],
  [
    [0.2497959487145803, 0.9520244425168298],
    [7.572524356405284, 8.52958887576222],
  ],
  [
    [2.453556011399678, 3.2403271271534777],
    [9.941651046409515, 10.72303630210763],
  ],
  [
    [3.785236532376165, 4.737979641784931],
    [8.911815120998721, 9.907265413433265],
  ],
];

/**
 * The mean of `values`, sampled at `rate` from timeline 0, from `from` to `to` seconds.
 * @param {number[]} values
 * @param {number} rate
 * @param {number} from
 * @param {number} to
 */
const meanOver = (values, rate, from, to) => {
  const part = values.slice(Math.round(from * rate), Math.round(to * rate));
  return part.reduce((a, v) => a + v, 0) / part.length;
};

/**
 * The mean of the cycle levels from `from` to `to` seconds, in dB.
 * @param {{ t: number; db: number }[]} levels
 * @param {number} from
 * @param {number} to
 */
const levelOver = (levels, from, to) => {
  const part = levels.filter((l) => l.t >= from && l.t < to).map((l) => l.db);
  return part.reduce((a, v) => a + v, 0) / part.length;
};

describe("the chant's aspiration", () => {
  const plain = { root: 65, depth: 0 };

  test("aspiration 1 raises the energy between the harmonics in 200–800 Hz by 10 dB or more, with noise 10 dB under the voice", () => {
    const off = mono(oneChant(plain), 0, 2 * RATE);
    const on = mono(oneChant({ ...plain, aspiration: 1 }), 0, 2 * RATE);
    const f0 = source(oneChant(plain), 0).track.control(0).hz;
    const rise = 10 * Math.log10(betweenHarmonics(on, f0) / betweenHarmonics(off, f0));
    // Without aspiration nothing sits between the harmonics but the window's leakage.
    expect(rise).toBeGreaterThanOrEqual(10);
    expect(rise).toBeGreaterThan(60);
    // The noise takes 10% of the voice's power, and the voice's level stays where it was.
    const noise = noiseOf(on, off, 1);
    expect(Math.abs(db(rmsOf(noise) / rmsOf(on)) + 10)).toBeLessThan(0.4);
    expect(Math.abs(db(rmsOf(on) / rmsOf(off)))).toBeLessThan(0.15);
    // Half the aspiration is half the noise's level.
    const half = noiseOf(mono(oneChant({ ...plain, aspiration: 0.5 }), 0, 2 * RATE), off, 0.5);
    expect(Math.abs(db(rmsOf(half) / rmsOf(noise)) + 6.02)).toBeLessThan(0.4);
  });

  test("its noise's envelope pulses at f0: the modulation spectrum peaks within 0.3% of it", () => {
    for (const root of [50, 65, 100]) {
      const change = { root, depth: 0 };
      const off = mono(oneChant(change), 0, RATE);
      const on = mono(oneChant({ ...change, aspiration: 1 }), 0, RATE);
      const f0 = source(oneChant(change), 0).track.control(0).hz;
      const peak = modulationPeak(noiseOf(on, off, 1));
      expect(Math.abs(peak - f0) / f0, `root ${root}`).toBeLessThan(0.003);
    }
  });

  test("its noise is shaped by the vowel's resonances, and moves up with the vowel", () => {
    /** @param {number} vowel */
    const noise = (vowel) => {
      const change = { ...plain, vowel };
      return noiseOf(
        mono(oneChant({ ...change, aspiration: 1 }), 0, RATE),
        mono(oneChant(change), 0, RATE),
        1,
      );
    };
    const dark = noise(0);
    const open = noise(1);
    // An "oo" puts its noise around 300 and 650 Hz, an "ah" around 650 Hz and 1 kHz.
    expect(spectrumShare(dark, 200, 800)).toBeGreaterThan(0.8);
    expect(spectrumShare(open, 500, 1300)).toBeGreaterThan(0.8);
    expect(spectrumShare(open, 20, 450)).toBeLessThan(0.1);
  });

  test("a chorus's noise is 10 dB under the voice, which keeps its level, and differs in the two channels", () => {
    const change = { ...plain, singers: 6, spread: 15 };
    const off = sourceOf(oneChant(change), 2 * RATE);
    const on = sourceOf(oneChant({ ...change, aspiration: 1 }), 2 * RATE);
    const [left, right] = [0, 1].map((c) =>
      noiseOf(
        Float64Array.from(/** @type {Float32Array} */ (on[c])),
        Float64Array.from(/** @type {Float32Array} */ (off[c])),
        1,
      ),
    );
    const l = /** @type {Float64Array} */ (left);
    const r = /** @type {Float64Array} */ (right);
    const total = summed(on);
    const noise = l.map((v, i) => v + /** @type {number} */ (r[i]));
    expect(Math.abs(db(rmsOf(noise) / rmsOf(total)) + 10)).toBeLessThan(0.5);
    expect(Math.abs(db(rmsOf(total) / rmsOf(summed(off))))).toBeLessThan(0.1);
    // The lead's stream is in both channels, and the chorus's two streams one each.
    const shared = correlation(Array.from(l), Array.from(r));
    expect(shared).toBeGreaterThan(0.1);
    expect(shared).toBeLessThan(0.3);
  });

  test("aspiration at 0 for the first seconds sings those seconds as the chant without it", () => {
    const later = {
      points: [
        [0, 0],
        [1.5, 0],
        [3, 0.8],
      ],
    };
    const without = sourceOf(oneChant({ singers: 3 }), 3 * RATE);
    const moving = sourceOf(oneChant({ singers: 3, aspiration: later }), 3 * RATE);
    for (const c of [0, 1]) {
      const a = /** @type {Float32Array} */ (without[c]);
      const b = /** @type {Float32Array} */ (moving[c]);
      expect(b.subarray(0, 1.4 * RATE)).toEqual(a.subarray(0, 1.4 * RATE));
      expect(b.subarray(2 * RATE)).not.toEqual(a.subarray(2 * RATE));
    }
  });
});

describe("the chant's breathiness", () => {
  // One singer, phrases of about 5 s and breaths of about 0.8 s, no swell.
  const breathy = { root: 65, depth: 0, phrase: 5, breath: 0.8 };
  const seconds = 30;
  /** @param {number} breathiness */
  const breathingSource = (breathiness) => {
    const { track, channels } = source(oneChant({ ...breathy, breathiness }), seconds);
    const f0 = track.control(0).hz;
    const breaths = track.breaths(0, seconds).filter((b) => b.end < seconds - 1);
    return { data: summed(channels), channels, f0, breaths };
  };

  test("leaves every singer's breaths where they fall without it, and where the commit before it put them", () => {
    for (const breathiness of [0, 1]) {
      const { track } = source(
        oneChant({ singers: 4, phrase: 5, breath: 0.8, breathiness, aspiration: breathiness }),
        0,
      );
      const schedule = [0, 1, 2, 3].map((s) =>
        track.breaths(s, 12).map(({ start, end }) => [start, end]),
      );
      expect(schedule).toEqual(CV2_SCHEDULE);
    }
    const at = (/** @type {number} */ breathiness) =>
      source(oneChant({ singers: 12, phrase: 3, breath: 1, breathiness }), 0).track;
    const plainTrack = at(0);
    const breathingTrack = at(1);
    for (let s = 0; s < 12; s++)
      expect(breathingTrack.breaths(s, 120)).toEqual(plainTrack.breaths(s, 120));
  });

  test("breathiness 1 puts an inhale in each breath 26 dB under the phrase's level, 0.5 one 32 dB under", () => {
    const steady = rmsOf(
      summed(sourceOf(oneChant({ root: 65, depth: 0, phrase: 5 }), seconds * RATE)),
    );
    // Over a breath's middle 40%, where the singer is silent, the inhale's 16x²(1 − x)² has a
    // mean square of 0.82 of its peak's.
    let hump = 0;
    for (let x = 0.3; x < 0.7; x += 1e-4) hump += (4 * x * (1 - x)) ** 4;
    const middle = 10 * Math.log10(hump / 4000);
    for (const [breathiness, expected] of [
      [1, -26],
      [0.5, -32.02],
    ]) {
      const { data, breaths } = breathingSource(/** @type {number} */ (breathiness));
      expect(breaths.length).toBeGreaterThanOrEqual(4);
      const unders = breaths.map(({ start, end }) => {
        const span = end - start;
        const part = data.subarray(
          Math.round((start + 0.3 * span) * RATE),
          Math.round((start + 0.7 * span) * RATE),
        );
        return db(rmsOf(part) / steady) - middle;
      });
      const who = `breathiness ${breathiness}: ${unders.map((u) => u.toFixed(2)).join(", ")} dB`;
      const mean = unders.reduce((a, u) => a + u, 0) / unders.length;
      expect(Math.abs(mean - /** @type {number} */ (expected)), who).toBeLessThan(0.7);
      for (const under of unders)
        expect(Math.abs(under - /** @type {number} */ (expected)), who).toBeLessThan(1.5);
    }
  });

  test("toward each phrase's end the level sags 2.5 dB and the pitch 12 cents over its last second", () => {
    const { data, f0, breaths } = breathingSource(1);
    const pitch = pitchTrace(data, f0, 5);
    const levels = cycleLevels(data, f0);
    let checked = 0;
    for (let j = 1; j < breaths.length; j++) {
      const { start } = /** @type {Breath} */ (breaths[j]);
      const before = /** @type {Breath} */ (breaths[j - 1]);
      if (start - before.end < 2) continue;
      checked++;
      const who = `phrase ending at ${start} s`;
      // Over the last second the sag runs along x² to 2.5 dB and 12 cents. Over the last 50 ms,
      // where the level is measured, x² is about 0.95, so 2.36 dB; from 60 to 20 ms before the
      // breath, where the pitch is, about 0.92, so 11 cents.
      const drop =
        levelOver(levels, start - 1.15, start - 1.05) - levelOver(levels, start - 0.05, start);
      expect(drop, who).toBeGreaterThan(2.2);
      expect(drop, who).toBeLessThan(2.5);
      const sag =
        meanOver(pitch, TRACE_RATE, start - 1.15, start - 1.05) -
        meanOver(pitch, TRACE_RATE, start - 0.06, start - 0.02);
      expect(sag, who).toBeGreaterThan(10.5);
      expect(sag, who).toBeLessThan(11.6);
      // Halfway through the last second it has fallen a quarter of the way: x² at 0.5.
      const halfway =
        meanOver(pitch, TRACE_RATE, start - 1.15, start - 1.05) -
        meanOver(pitch, TRACE_RATE, start - 0.52, start - 0.48);
      expect(halfway, who).toBeGreaterThan(2.7);
      expect(halfway, who).toBeLessThan(3.3);
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  test("each phrase scoops up 50 cents into its note, reaching it within 150 ms, with a soft onset", () => {
    const { data, f0, breaths } = breathingSource(1);
    const pitch = pitchTrace(data, f0, 5);
    const levels = cycleLevels(data, f0);
    const plainLevels = cycleLevels(breathingSource(0).data, f0);
    const steady = median(levels.map((l) => l.db));
    expect(breaths.length).toBeGreaterThanOrEqual(4);
    for (const { end } of breaths) {
      const who = `phrase starting at ${end} s`;
      // The fade in starts 80 ms before the breath's end, and the scoop rises from there along
      // the smooth curve over 120 ms: 42 cents under at 30 ms, 25 at 60 ms, there at 120 ms. The
      // trace smooths over two cycles of f0, which pulls the first value up a little.
      const sigma = end - 0.08;
      const low = meanOver(pitch, TRACE_RATE, sigma + 0.02, sigma + 0.04);
      expect(low, who).toBeLessThan(-35);
      expect(low, who).toBeGreaterThan(-45);
      const midway = meanOver(pitch, TRACE_RATE, sigma + 0.05, sigma + 0.07);
      expect(midway, who).toBeGreaterThan(-28);
      expect(midway, who).toBeLessThan(-21);
      const reached = meanOver(pitch, TRACE_RATE, sigma + 0.15, sigma + 0.25);
      expect(Math.abs(reached), who).toBeLessThan(0.5);
      // The fade in lasts 180 ms, not 80: at the breath's end the voice is 7.7 dB under its
      // level, where without breathiness it is already there.
      const onset = levelOver(levels, end - 0.01, end + 0.01) - steady;
      expect(onset, who).toBeLessThan(-6.5);
      expect(onset, who).toBeGreaterThan(-8.7);
      expect(levelOver(plainLevels, end - 0.01, end + 0.01) - steady, who).toBeGreaterThan(-0.3);
      expect(levelOver(levels, end + 0.11, end + 0.13) - steady, who).toBeGreaterThan(-0.2);
    }
  });

  test("breathiness at 0, or with no breaths, and aspiration at 0 sing the samples the chant sings without them", () => {
    for (const genome of [golden, ensemble, growling, unsteady]) {
      const zeros = requireGenome(
        {
          ...genome,
          voices: genome.voices.map((v) => ({ ...v, aspiration: 0, breathiness: 0 })),
        },
        "aspiration and breathiness at 0",
      );
      expect(sourceOf(zeros, 3 * RATE)).toEqual(sourceOf(genome, 3 * RATE));
    }
    // Breathiness shapes breaths, so with none it does nothing.
    const still = { singers: 3, breath: 0 };
    expect(sourceOf(oneChant({ ...still, breathiness: 1 }), 3 * RATE)).toEqual(
      sourceOf(oneChant(still), 3 * RATE),
    );
  });

  test("six singers each breathing their own way: windows split across a breath match, at 800 s too", () => {
    const genome = requireGenome(
      {
        duration: 900,
        fadeIn: 0,
        voices: [
          {
            id: "chant",
            type: "chant",
            singers: 6,
            phrase: 3,
            breath: 0.6,
            aspiration: 0.8,
            breathiness: 1,
            flutter: 1,
            growl: 0.4,
          },
        ],
      },
      "six singers breathing late",
    );
    const voice = /** @type {Voice} */ (genome.voices[0]);
    for (const at of [3, 800]) {
      const from = at * RATE;
      const length = 4 * RATE;
      const whole = chantChunk(chantTrack(genome, voice, RATE, SEED), from, length);
      const track = chantTrack(genome, voice, RATE, SEED);
      const breaths = track
        .breaths(1, at + 4)
        .filter((b) => b.start > at + 0.5 && b.end < at + 3.5);
      expect(breaths.length, `breaths after ${at} s`).toBeGreaterThan(0);
      const breath = /** @type {Breath} */ (breaths[0]);
      // Splits in the sag, the breath's fade out, its middle, and the onset after it.
      const splits = [
        breath.start - 0.4,
        breath.start + 0.03,
        (breath.start + breath.end) / 2,
        breath.end + 0.05,
      ].map((t) => Math.round(t * RATE) + 17);
      const bounds = [from, ...splits, from + length];
      const parts = bounds.slice(1).map((to, p) => {
        const lo = /** @type {number} */ (bounds[p]);
        return { lo, chunk: chantChunk(track, lo, to - lo) };
      });
      for (const c of [0, 1]) {
        const joined = new Float32Array(length);
        for (const { lo, chunk } of parts)
          joined.set(/** @type {Float32Array} */ (chunk[c]), lo - from);
        expect(joined, `${at} s, channel ${c}`).toEqual(whole[c]);
      }
    }
    // A track that rendered other windows first, out of order, gives the same late samples.
    const visited = chantTrack(genome, voice, RATE, SEED);
    for (const t of [500, 0, 799.9, 250]) chantChunk(visited, t * RATE, RATE / 2);
    expect(chantChunk(visited, 800 * RATE + 333, RATE)).toEqual(
      chantChunk(chantTrack(genome, voice, RATE, SEED), 800 * RATE + 333, RATE),
    );
  });

  test("a window split where the noise changes period matches the whole", () => {
    const genome = oneChant({ singers: 3, aspiration: 1, breath: 0.6, phrase: 3, breathiness: 1 });
    const voice = /** @type {Voice} */ (genome.voices[0]);
    // The noise's period is 2^17 frames, and each period's first 512 frames fade from the last.
    const boundary = 2 ** 17;
    const whole = chantChunk(chantTrack(genome, voice, RATE, SEED), boundary - RATE, 2 * RATE);
    const track = chantTrack(genome, voice, RATE, SEED);
    const a = chantChunk(track, boundary - RATE, RATE + 200);
    const b = chantChunk(track, boundary + 200, RATE - 200);
    for (const c of [0, 1]) {
      const joined = new Float32Array(2 * RATE);
      joined.set(/** @type {Float32Array} */ (a[c]), 0);
      joined.set(/** @type {Float32Array} */ (b[c]), RATE + 200);
      expect(joined).toEqual(whole[c]);
    }
  });

  test("the breathing golden has aspiration as a trajectory, breathiness, a chorus that breathes and a non-neutral macro", () => {
    const voice = /** @type {Voice} */ (breathing.voices[0]);
    expect(voice.aspiration).toHaveProperty("points");
    expect(voice.breathiness).toBeGreaterThan(0);
    expect(voice.singers).toBeGreaterThan(1);
    expect(voice.breath).toBeGreaterThan(0);
    expect(breathing.macros.brightness).not.toBe(0.5);
    // Some singer breathes inside the golden's first 2 s.
    const { track } = source(breathing, 0);
    expect([0, 1, 2, 3].flatMap((s) => track.breaths(s, 2)).length).toBeGreaterThan(0);
  });

  test("aspiration and breathiness price their work, and twelve singers with every setting at 1 fit beside a 15 s reverb", () => {
    /** @param {Record<string, unknown>} change */
    const at = (change) => {
      const genome = oneChant({ singers: 12, phrase: 5, breath: 0.6, ...change });
      return chant.cost(/** @type {Voice} */ (genome.voices[0]), genome);
    };
    const plainCost = at({});
    expect(at({ aspiration: 0, breathiness: 0 })).toBe(plainCost);
    expect(at({ aspiration: 1 })).toBeGreaterThan(plainCost);
    expect(
      at({
        aspiration: {
          points: [
            [0, 0],
            [100, 0.1],
          ],
        },
      }),
    ).toBe(at({ aspiration: 1 }));
    expect(at({ breathiness: 1 })).toBeGreaterThan(plainCost);
    expect(at({ breathiness: 1, breath: 0 })).toBe(at({ breath: 0 }));
    // Longer breaths between shorter phrases spend more of the time in an inhale.
    expect(at({ breathiness: 1, breath: 2, phrase: 3 })).toBeGreaterThan(
      at({ breathiness: 1 }) - at({}) + at({ breath: 2, phrase: 3 }),
    );
    const every = { growl: 1, rough: 1, flutter: 1, shimmer: 1, aspiration: 1, breathiness: 1 };
    const bench = requireGenome(
      {
        reverbDecay: 15,
        voices: [{ id: "c", type: "chant", singers: 12, phrase: 5, breath: 0.6, ...every }],
      },
      "twelve singers with every setting, breathing as the bench's do, beside a 15 s reverb",
    );
    expect(cost(bench)).toBeLessThanOrEqual(COST_BUDGET);
  });
});

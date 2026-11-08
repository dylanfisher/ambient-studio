// Most checks read the voice's JS source directly, which is cheap; renders are short (3–9 s) to
// keep the gate light on a machine that also serves omlx.
/** @import { Genome, Voice } from "../../src/engine/genome-schema.js" */
import { describe, expect, test } from "vitest";
import { spectralCentroid } from "../../src/domain/spectral-centroid.js";
import { chant, chantChunk, chantTrack } from "../../src/engine/chant.js";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import { GLOBAL_PARAMS } from "../../src/engine/genome-schema.js";
import chantGenome from "../../src/engine/genomes/chant.json" with { type: "json" };
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
const golden = requireGenome(chantGenome, "the chant golden genome");
/** C2, the A-minor scale note nearest the 65 Hz default root. */
const C2 = 65.40639;

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
  const track = chantTrack(genome, /** @type {Voice} */ (genome.voices[0]), RATE);
  const [left, right] = chantChunk(track, first, frames);
  return Float64Array.from(/** @type {Float32Array} */ (left), (v, i) => v + (right?.[i] ?? 0));
};

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

  test("its source is the same whichever window computes it, and from a track started anywhere", () => {
    const genome = golden;
    const voice = /** @type {Voice} */ (genome.voices[0]);
    const whole = chantChunk(chantTrack(genome, voice, RATE), 0, 5 * RATE);
    // Splits off the control grid and off the window boundaries, as an excerpt's first window.
    const track = chantTrack(genome, voice, RATE);
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
    const ran = chantTrack(genome, voice, RATE);
    chantChunk(ran, 0, late);
    expect(chantChunk(chantTrack(genome, voice, RATE), late, RATE)).toEqual(
      chantChunk(ran, late, RATE),
    );
  });

  test("excerpts at several offsets match their window of a full render (0007's tolerance)", async () => {
    const full = 9;
    const whole = await renderOffline(golden, { seed: 1, duration: full });
    for (const offset of [0.7, 3.35, 6.1]) {
      const length = 2.5;
      const excerpt = await renderOffline(golden, { seed: 1, duration: length, offset });
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
  });

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
      ["bend", "depth", "focus", "pulse", "root", "tilt", "vowel"].sort(),
    );
    expect(errors({ singers: 3 })).toEqual(["$.voices[0].singers"]);
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

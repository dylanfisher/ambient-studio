// Renders are short (2–12 s) to keep the gate light on a machine that also serves omlx.
import { describe, expect, test } from "vitest";
import { integratedLoudness } from "../../src/domain/integrated-loudness.js";
import { NOISE_COLORS } from "../../src/engine/colored-noise.js";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import { GLOBAL_PARAMS } from "../../src/engine/genome-schema.js";
import bedGenome from "../../src/engine/genomes/noise-bed.json" with { type: "json" };
import { noiseBed, noiseChunk } from "../../src/engine/noise-bed.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { voiceTypeIds } from "../../src/engine/voice-registry.js";
import { expectExcerptMatches, renderUpFront } from "../support/compare-renders.js";
import { recordSources } from "../support/record-sources.js";
import { renderOffline } from "../support/render-offline.js";

const RATE = 48000;
const PRESETS = noiseBed.params.preset.values;
const golden = requireGenome(bedGenome, "the noise bed golden genome");
/** The drone's default level against the bed's, at the same `level` (step 1r). */
const UNDER_DRONE_LU = 30;

/** @param {Partial<Parameters<typeof noiseChunk>[0]>} where */
const chunk = (where) =>
  noiseChunk({
    seed: 1,
    voiceId: "bed",
    color: "pink",
    preset: "rain",
    first: 0,
    frames: RATE,
    sampleRate: RATE,
    ...where,
  });

describe("the noise bed", () => {
  test("is registered", () => {
    expect(voiceTypeIds()).toContain(noiseBed.type);
  });

  test("the golden genome uses a trajectory and a non-neutral macro", () => {
    expect(golden.voices.map((v) => v.type)).toEqual([noiseBed.type, noiseBed.type]);
    expect(golden.voices.some((v) => typeof v.tone === "object")).toBe(true);
    expect(golden.macros.brightness).not.toBe(0.5);
    // Brightness is mapped onto the filter's tone, so the macro below neutral lowers it.
    const neutral = { ...golden, macros: { ...golden.macros, brightness: 0.5 } };
    const tone = (/** @type {typeof golden} */ g) =>
      /** @type {number} */ (effectiveParams(g, 2).voices[0]?.tone);
    expect(tone(golden)).toBeLessThan(tone(neutral));
  });

  test.each(PRESETS)("the %s source is the same whichever window computes it", (preset) => {
    const whole = chunk({ preset, first: RATE, frames: 4 * RATE });
    // Windows that start and end inside rain drops, as an excerpt's first window does.
    const parts = [
      chunk({ preset, first: RATE, frames: RATE + 333 }),
      chunk({ preset, first: 2 * RATE + 333, frames: 3 * RATE - 333 }),
    ];
    parts.forEach((part, p) => {
      part.forEach((data, c) => {
        const offset = p === 0 ? 0 : RATE + 333;
        const same = /** @type {Float32Array} */ (whole[c]).subarray(offset, offset + data.length);
        const peak = data.reduce((max, v, i) => Math.max(max, Math.abs(v - (same[i] ?? 0))), 0);
        expect(peak).toBeLessThan(1e-7);
      });
    });
    expect(chunk({ preset })).not.toEqual(chunk({ preset, seed: 2 }));
  });

  test("rain adds drops to the noise, and the other presets don't", () => {
    const peakOverRms = (/** @type {Float32Array} */ x) => {
      const rms = Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
      return x.reduce((max, v) => Math.max(max, Math.abs(v)), 0) / rms;
    };
    const [rain] = chunk({ preset: "rain", color: "white", frames: 4 * RATE });
    const [wind] = chunk({ preset: "wind", color: "white", frames: 4 * RATE });
    expect(peakOverRms(/** @type {Float32Array} */ (wind))).toBeLessThan(1.8);
    expect(peakOverRms(/** @type {Float32Array} */ (rain))).toBeGreaterThan(2.5);
  });

  // A whole swell cycle and more, after the reverb has filled. The reverb is the shortest, to
  // keep the renders light: it adds about the same to both voices.
  /**
   * @param {Record<string, unknown>} bed
   * @param {string} id the voice to render alone
   */
  const loudness = async (bed, id) => {
    const genome = requireGenome(
      {
        fadeIn: 0,
        reverbDecay: GLOBAL_PARAMS.reverbDecay.min,
        voices: [
          { id: "drone", type: "drone" },
          { id: "bed", type: "noise", ...bed },
        ],
      },
      "a default drone and noise bed",
    );
    const { channels } = await renderOffline(genome, { seed: 1, duration: 12, voices: [id] });
    return integratedLoudness(
      channels.map((c) => c.subarray(2 * RATE)),
      RATE,
    );
  };
  /** @type {Promise<number> | undefined} */
  let droneLoudness;

  // Measured on mbp2021, seed 1, against a default drone at -15.6 LUFS: wind 38.8, 33.8 and
  // 41.0 dB under in white, pink and brown; rain 31.9, 36.5, 45.3; surf 44.0, 34.6, 36.1.
  test.each(PRESETS.flatMap((preset) => NOISE_COLORS.map((color) => ({ preset, color }))))(
    "at its defaults, $preset in $color plays at least 30 dB under the default drone",
    async ({ preset, color }) => {
      droneLoudness ??= loudness({}, "drone");
      const drone = await droneLoudness;
      const bed = await loudness({ preset, color }, "bed");
      expect(drone - bed, `drone ${drone} LUFS, bed ${bed} LUFS`).toBeGreaterThanOrEqual(
        UNDER_DRONE_LU,
      );
    },
    30_000,
  );

  test.each(PRESETS)("%s stays in the budget with the longest reverb", (preset) => {
    const genome = requireGenome(
      {
        reverbDecay: GLOBAL_PARAMS.reverbDecay.max,
        voices: [{ id: "bed", type: "noise", preset, color: "brown" }],
      },
      "a noise bed with the longest reverb",
    );
    expect(cost(genome)).toBeLessThanOrEqual(COST_BUDGET);
  });

  test("plays its noise from one buffer source a window, each starting where the last ends", async () => {
    /** @type {import("../support/record-sources.js").StartedSource[]} */
    let started = [];
    const solo = requireGenome({ ...bedGenome, voices: [bedGenome.voices[0]] }, "one noise bed");
    await renderOffline(solo, { seed: 1, duration: 5 }, (ctx) => {
      started = recordSources(ctx);
    });
    // Windows [0, 2), [2, 4) and [4, 5) tile the render with no gap or overlap.
    expect(started).toEqual([
      { frame: 0, frames: 2 * RATE },
      { frame: 2 * RATE, frames: 2 * RATE },
      { frame: 4 * RATE, frames: RATE },
    ]);
  });

  test("scheduling in suspend windows renders the same samples as scheduling up front", async () => {
    const windowed = await renderOffline(golden, { seed: 1, duration: 5 });
    expect((await renderUpFront(golden, { seed: 1, duration: 5 })).channels).toEqual(
      windowed.channels,
    );
  });

  test("plays only from its start to its end, and an excerpt across its end matches", async () => {
    const genome = requireGenome(
      {
        ...bedGenome,
        voices: bedGenome.voices.map((v) => ({ ...v, start: 2.3, end: 6.7 })),
      },
      "the golden with voices starting and ending inside the render",
    );
    /** @type {import("../support/record-sources.js").StartedSource[]} */
    let started = [];
    const whole = await renderOffline(genome, { seed: 1, duration: 9 }, (ctx) => {
      started = recordSources(ctx);
    });
    // No buffer for the window before the start or the one after the end.
    expect(started.length).toBeGreaterThan(0);
    for (const { frame } of started) {
      expect(frame).toBeGreaterThanOrEqual(2 * RATE);
      expect(frame).toBeLessThan(8 * RATE);
    }
    // Silent before the start, but for the library's gate ramp reaching up to a quantum early
    // (measured 3e-12 for the noise golden, 3e-10 for the drone's); sounding between start and
    // end.
    const left = /** @type {Float32Array} */ (whole.channels[0]);
    expect(left.subarray(0, Math.round(2.3 * RATE)).every((v) => Math.abs(v) < 1e-9)).toBe(true);
    expect(left.subarray(3 * RATE, 6 * RATE).some((v) => Math.abs(v) > 1e-4)).toBe(true);
    await expectExcerptMatches(genome, { seed: 1, full: 9, offset: 5.5, length: 2.5 });
  });

  test("an excerpt matches the same window of a longer render (0007's tolerance)", async () => {
    const { excerpt } = await expectExcerptMatches(golden, {
      seed: 1,
      full: 8,
      offset: 5.5,
      length: 2.5,
    });
    expect(excerpt.channels[0]?.some((v) => Math.abs(v) > 1e-3)).toBe(true);
  });
});

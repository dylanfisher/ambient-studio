// Renders are short (2–6 s) to keep the gate light on a machine that also serves omlx.
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { RenderResult } from "../../src/engine/render-plan.js" */
import { describe, expect, test } from "vitest";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { randomGenome } from "../../src/engine/random-genome.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { registerVoice, unregisterVoice } from "../../src/engine/voice-registry.js";
import { renderOffline } from "../support/render-offline.js";

const RATE = 48000;
// The stated tolerances, from renders measured on mbp2021: stems summed differ from the mix by
// float rounding only (decision 0010), and an excerpt from its window of a full render by at
// most a peak of 1e-3 with the difference at least 80 dB under the signal (decision 0007).
const STEM_PEAK = 1e-6;
const STEM_BELOW_DB = 120;
const EXCERPT_PEAK = 1e-3;
const EXCERPT_BELOW_DB = 80;
const golden = requireGenome(droneGenome, "the drone golden genome");

/** The golden drone plus a second drone higher up. */
const pair = requireGenome(
  {
    ...droneGenome,
    voices: [
      ...droneGenome.voices,
      { id: "high", type: "drone", root: 55, partials: 5, level: -14, detune: 7 },
    ],
  },
  "a two-drone genome",
);

/**
 * Largest absolute difference between two renders, and the difference's RMS in dB below the
 * reference's RMS.
 * @param {RenderResult} result
 * @param {RenderResult} reference
 */
function difference(result, reference) {
  let peak = 0;
  let diff = 0;
  let signal = 0;
  reference.channels.forEach((ref, c) => {
    const data = /** @type {Float32Array} */ (result.channels[c]);
    expect(data.length).toBe(ref.length);
    for (let i = 0; i < ref.length; i++) {
      const d = (data[i] ?? 0) - (ref[i] ?? 0);
      peak = Math.max(peak, Math.abs(d));
      diff += d * d;
      signal += (ref[i] ?? 0) ** 2;
    }
  });
  return { peak, belowDb: 10 * Math.log10(signal / diff) };
}

/** @param {RenderResult} result */
const rms = (result) =>
  Math.sqrt(
    result.channels.reduce((sum, c) => sum + c.reduce((s, x) => s + x * x, 0), 0) /
      result.channels.reduce((n, c) => n + c.length, 0),
  );

describe("render", () => {
  test("gives identical samples for the same inputs, with the engine version", async () => {
    const a = await renderOffline(golden, { seed: 1, duration: 3 });
    const b = await renderOffline(golden, { seed: 1, duration: 3 });
    expect(a.engineVersion).toBe(ENGINE_VERSION);
    expect(a.sampleRate).toBe(RATE);
    expect(rms(a)).toBeGreaterThan(0.01);
    expect(a.channels).toEqual(b.channels);
  });

  test("gives different samples for a different seed", async () => {
    const a = await renderOffline(golden, { seed: 1, duration: 2 });
    const b = await renderOffline(golden, { seed: 2, duration: 2 });
    expect(a.channels[0]).not.toEqual(b.channels[0]);
  });

  test("an excerpt has exactly the requested length", async () => {
    const result = await renderOffline(golden, { seed: 1, duration: 1.2345, offset: 7.77 });
    expect(result.channels.map((c) => c.length)).toEqual([59256, 59256]);
  });

  test("scheduling in suspend windows renders the same samples as scheduling up front", async () => {
    const windowed = await renderOffline(golden, { seed: 1, duration: 5 });
    // Without `suspend`, render() treats the context as live and creates every window now.
    const upFront = await renderOffline(golden, { seed: 1, duration: 5 }, (ctx) =>
      Object.defineProperty(ctx, "suspend", { value: undefined }),
    );
    expect(upFront.channels).toEqual(windowed.channels);
  });

  test("adding another voice doesn't change the drone's solo render", async () => {
    const alone = await renderOffline(golden, { seed: 4, duration: 2, voices: ["drone"] });
    const beside = await renderOffline(pair, { seed: 4, duration: 2, voices: ["drone"] });
    expect(beside.channels).toEqual(alone.channels);
  });

  test("the solo renders of a two-voice genome sum to the full render", async () => {
    const full = await renderOffline(pair, { seed: 5, duration: 3 });
    const stems = await Promise.all(
      ["drone", "high"].map((id) => renderOffline(pair, { seed: 5, duration: 3, voices: [id] })),
    );
    const sum = {
      ...full,
      channels: full.channels.map((_, c) =>
        Float32Array.from(
          { length: full.channels[c]?.length ?? 0 },
          (_, i) => (stems[0]?.channels[c]?.[i] ?? 0) + (stems[1]?.channels[c]?.[i] ?? 0),
        ),
      ),
    };
    const { peak, belowDb } = difference(sum, full);
    expect(peak).toBeLessThan(STEM_PEAK);
    expect(belowDb).toBeGreaterThan(STEM_BELOW_DB);
  });

  test("an excerpt matches the same window of a longer render (0007's tolerance)", async () => {
    const offset = 4.5;
    const full = await renderOffline(golden, { seed: 3, duration: 7 });
    const excerpt = await renderOffline(golden, { seed: 3, duration: 2.5, offset });
    const from = Math.round(offset * RATE);
    const window = {
      ...full,
      channels: full.channels.map((c) =>
        c.subarray(from, from + (excerpt.channels[0]?.length ?? 0)),
      ),
    };
    const { peak, belowDb } = difference(excerpt, window);
    expect(peak).toBeLessThan(EXCERPT_PEAK);
    expect(belowDb).toBeGreaterThan(EXCERPT_BELOW_DB);
  });

  test("fades from silence at timeline 0 and ends in digital silence", async () => {
    const start = await renderOffline(golden, { seed: 1, duration: 0.5 });
    expect(start.channels.every((c) => c[0] === 0)).toBe(true);
    const end = await renderOffline(golden, { seed: 1, duration: 3, offset: 57 });
    const last = end.channels.map((c) => c.subarray(c.length - 128));
    expect(last.every((c) => c.every((x) => x === 0))).toBe(true);
  });

  test("a window that throws rejects the render after it finishes, rather than hanging it", async () => {
    // A voice whose second window fails, as a voice bug would.
    registerVoice({
      type: "faulty",
      description: "x",
      params: {},
      macros: [],
      longestEvent: () => 0,
      build: () => (from) => {
        if (from >= 2) throw new Error("window at 2 s failed");
      },
    });
    try {
      const genome = requireGenome(
        { ...golden, voices: [...golden.voices, { id: "bad", type: "faulty" }] },
        "a genome with a faulty voice",
      );
      await expect(renderOffline(genome, { seed: 1, duration: 4 })).rejects.toThrow(
        /window at 2 s failed/,
      );
    } finally {
      unregisterVoice("faulty");
    }
  });

  test("throws on a voice id the genome doesn't have", async () => {
    await expect(renderOffline(golden, { seed: 1, duration: 1, voices: ["nope"] })).rejects.toThrow(
      /no voice "nope"/,
    );
  });

  test("20 random genomes render 2 s each with every sample finite", async () => {
    let sounding = 0;
    for (let seed = 0; seed < 20; seed++) {
      const drawn = randomGenome(seed);
      // Voices start at 0 so each one plays inside the 2 s rendered.
      /** @type {Genome} */
      const genome = { ...drawn, voices: drawn.voices.map((v) => ({ ...v, start: 0 })) };
      const result = await renderOffline(genome, { seed, duration: 2 });
      for (const channel of result.channels) {
        expect(channel.every(Number.isFinite), `seed ${seed}`).toBe(true);
      }
      if (rms(result) > 0) sounding++;
    }
    expect(sounding).toBe(20);
    // About 1.5 s alone; more when the suite runs at background priority beside other files.
  }, 30_000);
});

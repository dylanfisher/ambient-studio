// Renders are short (2–6 s) to keep the gate light on a machine that also serves omlx.
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { RenderResult } from "../../src/engine/render-plan.js" */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { randomGenome } from "../../src/engine/random-genome.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { registerVoice, unregisterVoice } from "../../src/engine/voice-registry.js";
import { PULSE_EVERY, pulseVoice } from "../support/pulse-voice.js";
import { renderOffline } from "../support/render-offline.js";

const RATE = 48000;
// The stated tolerances, from renders measured on mbp2021: stems summed differ from the mix by
// float rounding only (decision 0010), and an excerpt from its window of a full render by at
// most a peak of 1e-5 with the difference at least 100 dB under the signal (decision 0007).
const STEM_PEAK = 1e-6;
const STEM_BELOW_DB = 120;
const EXCERPT_PEAK = 1e-5;
const EXCERPT_BELOW_DB = 100;
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

/**
 * Renders `full` seconds from 0 and an excerpt of `length` seconds at `offset`, and checks the
 * excerpt against the same window of the full render within 0007's tolerance.
 * @param {Genome} genome
 * @param {{ seed: number; full: number; offset: number; length: number }} times
 */
async function expectExcerptMatches(genome, { seed, full, offset, length }) {
  const whole = await renderOffline(genome, { seed, duration: full });
  const excerpt = await renderOffline(genome, { seed, duration: length, offset });
  const from = Math.round(offset * RATE);
  const window = {
    ...whole,
    channels: whole.channels.map((c) => c.slice(from, from + Math.round(length * RATE))),
  };
  const { peak, belowDb } = difference(excerpt, window);
  expect(peak).toBeLessThan(EXCERPT_PEAK);
  expect(belowDb).toBeGreaterThan(EXCERPT_BELOW_DB);
  return { excerpt, window };
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
    await expectExcerptMatches(golden, { seed: 3, full: 8, offset: 5.5, length: 2.5 });
  });

  test("an excerpt matches where voices start and end inside the render", async () => {
    // From the excerpt's pre-roll start (about 0.7 s): "gone" ended before it, the golden drone
    // starts in the pre-roll, and "brief" opens and closes inside the excerpt.
    const genome = requireGenome(
      {
        ...droneGenome,
        voices: [
          { ...droneGenome.voices[0], start: 3.3 },
          { id: "gone", type: "drone", root: 80, end: 0.5 },
          { id: "brief", type: "drone", root: 120, start: 6.2, end: 7.1 },
        ],
      },
      "voices starting and ending inside the render",
    );
    await expectExcerptMatches(genome, { seed: 2, full: 8, offset: 5.5, length: 2.5 });
  });

  test("a Colundi drone plays snapped partials, and its excerpt matches", async () => {
    const { key: _, ...relative } = droneGenome;
    const genome = requireGenome(
      {
        ...relative,
        tuning: "colundi",
        scale: "all",
        voices: [{ ...droneGenome.voices[0], root: 55, partials: 12 }],
      },
      "a Colundi drone",
    );
    const { excerpt } = await expectExcerptMatches(genome, {
      seed: 1,
      full: 8,
      offset: 5.5,
      length: 2.5,
    });
    expect(rms(excerpt)).toBeGreaterThan(0.01);
  });

  test("a render's samples don't depend on where it ends", async () => {
    // Ending on a window boundary (4 s) while the fade-in still moves the master gain.
    const fading = requireGenome({ ...droneGenome, fadeIn: 10 }, "a slow fade-in");
    const short = await renderOffline(fading, { seed: 1, duration: 4 });
    const long = await renderOffline(fading, { seed: 1, duration: 5 });
    expect(long.channels.map((c) => c.slice(0, 4 * RATE))).toEqual(short.channels);
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
      cost: () => 0,
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

describe("render, with a voice that creates events window by window", () => {
  beforeAll(() => registerVoice(pulseVoice));
  afterAll(() => unregisterVoice(pulseVoice.type));

  // Nearly dry, so each burst stands out of the reverb and echo around it.
  const pulses = () =>
    requireGenome(
      {
        ...droneGenome,
        reverbLevel: -30,
        delayLevel: -40,
        voices: [...droneGenome.voices, { id: "pulse", type: "pulse", level: -6 }],
      },
      "a genome with the pulse voice",
    );

  test("plays an event at every half second, window boundaries included", async () => {
    const result = await renderOffline(pulses(), { seed: 1, duration: 7, voices: ["pulse"] });
    const left = /** @type {Float32Array} */ (result.channels[0]);
    /** @param {number} from @param {number} to */
    const peak = (from, to) =>
      left
        .subarray(Math.round(from * RATE), Math.round(to * RATE))
        .reduce((max, x) => Math.max(max, Math.abs(x)), 0);
    // After the 1 s fade-in, up to the last burst that fits.
    for (let k = 2; (k + 1) * PULSE_EVERY <= 7; k++) {
      const time = k * PULSE_EVERY;
      expect(peak(time, time + 0.1), `burst at ${time} s`).toBeGreaterThan(
        5 * peak(time + 0.2, time + PULSE_EVERY),
      );
    }
  });

  test("scheduling in suspend windows renders the same samples as scheduling up front", async () => {
    const windowed = await renderOffline(pulses(), { seed: 1, duration: 7 });
    const upFront = await renderOffline(pulses(), { seed: 1, duration: 7 }, (ctx) =>
      Object.defineProperty(ctx, "suspend", { value: undefined }),
    );
    expect(upFront.channels).toEqual(windowed.channels);
  });

  test("an excerpt matches the same window of a longer render (0007's tolerance)", async () => {
    await expectExcerptMatches(pulses(), { seed: 1, full: 8, offset: 5.5, length: 2.5 });
  });
});

// Renders are short (2–9 s) but the GC check, which renders 40 s twice, to keep the gate light.
// Recordings are the synthetic fixtures in test/fixtures/recordings/, decoded as the server
// decodes them.
/** @import { Genome } from "../../src/engine/genome-schema.js" */
/** @import { Recording, Samples } from "../../src/engine/render.js" */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import v8 from "node:v8";
import vm from "node:vm";
import { beforeAll, describe, expect, test } from "vitest";
import { canonicalGenome } from "../../src/engine/canonical-genome.js";
import { COST_BUDGET, cost } from "../../src/engine/cost.js";
import { effectiveParams } from "../../src/engine/effective-params.js";
import { fieldRecording, recordingChunk } from "../../src/engine/field-recording.js";
import { GLOBAL_PARAMS } from "../../src/engine/genome-schema.js";
import recordingGenome from "../../src/engine/genomes/field-recording.json" with { type: "json" };
import { randomGenome } from "../../src/engine/random-genome.js";
import { requireGenome, validateGenome } from "../../src/engine/validate-genome.js";
import { usesRecordings, voiceTypeIds } from "../../src/engine/voice-registry.js";
import { decodeRecording } from "../../src/server/load-samples.js";
import { renderOffline } from "../../src/server/render-offline.js";
import { expectExcerptMatches, renderUpFront, rms } from "../support/compare-renders.js";
import { FIXTURE_RECORDINGS } from "../support/golden.js";

const RATE = 48000;
/** The fixtures' SHA-256s, as `shasum -a 256` prints them. */
const HASH = Object.freeze({
  wav: "d5b8145b3639bd1c0891315ece68c9ec5fa0e23924e485d94467ac0fbed4faa5",
  flac: "810ab2357cb6dd62882afd92502fc013609b1bb326a5ff50873513b125fb0d3f",
  aiff: "75752458877736ebc7726d0274e5863106039b8780454d546f43dfb13d949ad3",
});
const FILE = Object.freeze({
  wav: "noise-tone.wav",
  flac: "brown-mono.flac",
  aiff: "tones.aiff",
});
const golden = requireGenome(recordingGenome, "the field-recording golden genome");

/** @type {Record<string, Recording>} */
const samples = {};
beforeAll(async () => {
  for (const [format, file] of Object.entries(FILE)) {
    const hash = /** @type {string} */ (HASH[/** @type {keyof typeof HASH} */ (format)]);
    samples[hash] = await decodeRecording(await readFile(join(FIXTURE_RECORDINGS, file)));
  }
});

/**
 * A genome of one recording voice, its reverb the shortest to keep renders light.
 * @param {Record<string, unknown>} voice
 * @returns {Genome}
 */
const oneVoice = (voice) =>
  requireGenome(
    {
      fadeIn: 0,
      reverbDecay: GLOBAL_PARAMS.reverbDecay.min,
      voices: [{ id: "field", type: "recording", level: -6, ...voice }],
    },
    "one recording voice",
  );

v8.setFlagsFromString("--expose-gc");
const collectGarbage = /** @type {() => void} */ (vm.runInNewContext("gc"));

describe("the field-recording voice", () => {
  test("is registered, and only it plays recordings", () => {
    expect(voiceTypeIds()).toContain(fieldRecording.type);
    expect(voiceTypeIds().filter(usesRecordings)).toEqual([fieldRecording.type]);
  });

  test("randomGenome never draws it, and every seed draws what it drew before the voice", () => {
    // SHA-256 of canonicalGenome(randomGenome(seed)) + "\n" for seeds 0–199, measured on main
    // before the voice was registered.
    const before = [
      { options: {}, sha256: "1608f7e895b214790d2e58b0a3bc46f656911bf60968ded6fb4a4da874bfbc9a" },
      {
        options: { costCap: Infinity },
        sha256: "c55970007a1c0b67ec0eb6516d4add022599973c3f69b216e61e0294b4d3eadd",
      },
    ];
    for (const { options, sha256 } of before) {
      const hash = createHash("sha256");
      for (let seed = 0; seed < 200; seed++) {
        const genome = randomGenome(seed, options);
        expect(genome.voices.some((v) => v.type === fieldRecording.type)).toBe(false);
        hash.update(`${canonicalGenome(genome)}\n`);
      }
      expect(hash.digest("hex"), JSON.stringify(options)).toBe(sha256);
    }
  });

  test("names its recording by SHA-256, with no default", () => {
    const check = (/** @type {Record<string, unknown>} */ voice) => {
      const result = validateGenome({ voices: [{ id: "f", type: "recording", ...voice }] });
      return result.ok ? [] : result.errors;
    };
    expect(check({})).toEqual([
      { path: "$.voices[0].recording", message: expect.stringMatching(/^missing; give/) },
    ]);
    expect(check({ recording: "rain.wav" })).toEqual([
      { path: "$.voices[0].recording", message: expect.stringMatching(/sha256.*"rain.wav"/) },
    ]);
    expect(check({ recording: HASH.wav.toUpperCase() })).toHaveLength(1);
    expect(check({ recording: HASH.wav, mode: "scatter", position: 0.5 })).toEqual([
      { path: "$.voices[0].position", message: expect.stringMatching(/only with mode "loop"/) },
    ]);
    expect(check({ recording: HASH.wav })).toEqual([]);
  });

  test("the golden genome uses a trajectory and a non-neutral macro, from a 44.1 kHz WAV and FLAC", () => {
    expect(golden.voices.map((v) => v.recording).sort()).toEqual([HASH.flac, HASH.wav].sort());
    expect(golden.voices.some((v) => typeof v.cutoff === "object")).toBe(true);
    expect(golden.macros.brightness).not.toBe(0.5);
    const neutral = { ...golden, macros: { ...golden.macros, brightness: 0.5 } };
    const cutoff = (/** @type {Genome} */ g) =>
      /** @type {number} */ (effectiveParams(g, 2).voices[0]?.cutoff);
    expect(cutoff(golden)).not.toBe(cutoff(neutral));
  });

  test.each(Object.keys(FILE))(
    "renders the same samples twice from the %s fixture",
    async (format) => {
      const hash = HASH[/** @type {keyof typeof HASH} */ (format)];
      const genome = oneVoice({ recording: hash, rate: 0.8, span: 1, fade: 0.4 });
      const a = await renderOffline(genome, { seed: 1, duration: 3, samples });
      const b = await renderOffline(genome, { seed: 1, duration: 3, samples });
      expect(rms(a)).toBeGreaterThan(0.01);
      expect(a.channels).toEqual(b.channels);
    },
  );

  test("fails naming the hash when samples lack its recording", async () => {
    const genome = oneVoice({ recording: HASH.wav });
    await expect(renderOffline(genome, { seed: 1, duration: 1 })).rejects.toThrow(
      new RegExp(`voice "field" plays recording ${HASH.wav}, which isn't in samples`),
    );
    const at44 = {
      [HASH.wav]: { .../** @type {Recording} */ (samples[HASH.wav]), sampleRate: 44100 },
    };
    await expect(renderOffline(genome, { seed: 1, duration: 1, samples: at44 })).rejects.toThrow(
      /at 44100 Hz; decode it at 48000 Hz/,
    );
  });

  /**
   * @param {Partial<Parameters<typeof recordingChunk>[0]["voice"]>} voice
   * @param {number} first
   * @param {number} frames
   * @param {number} [seed]
   */
  const chunk = (voice, first, frames, seed = 1) =>
    recordingChunk({
      recording: /** @type {Recording} */ (samples[HASH.wav]),
      voice: /** @type {any} */ ({
        ...requireGenome(
          { voices: [{ id: "field", type: "recording", recording: HASH.wav, ...voice }] },
          "a chunk's voice",
        ).voices[0],
      }),
      seed,
      first,
      frames,
      sampleRate: RATE,
    });

  test.each(["loop", "scatter"])("a %s pass is the same whichever window computes it", (mode) => {
    const voice = { mode, span: 1.2, fade: 0.3, rate: 0.7, start: 0.25 };
    const whole = chunk(voice, RATE, 4 * RATE);
    const parts = [chunk(voice, RATE, RATE + 333), chunk(voice, 2 * RATE + 333, 3 * RATE - 333)];
    for (const [c, data] of whole.entries()) {
      expect(Float32Array.from([...(parts[0]?.[c] ?? []), ...(parts[1]?.[c] ?? [])])).toEqual(data);
    }
  });

  test("loop replays one span, and scatter places its passes by the seed", () => {
    // At rate 1 a 1 s pass is 48,000 frames, 960 of them fading (2%), so passes start 47,040
    // frames apart; the middle of each pass is the file alone.
    const span = 1;
    const frames = span * RATE;
    const hop = frames - 0.02 * frames;
    const [loop] = chunk({ mode: "loop", span, fade: 0.02, position: 0.5 }, 0, 4 * frames);
    const pass = (/** @type {Float32Array | undefined} */ data, /** @type {number} */ k) =>
      data?.subarray(k * hop + 1000, k * hop + 40000);
    expect(pass(loop, 2)).toEqual(pass(loop, 1));
    const [scatter] = chunk({ mode: "scatter", span, fade: 0.02 }, 0, 4 * frames);
    expect(pass(scatter, 2)).not.toEqual(pass(scatter, 1));
    expect(chunk({ mode: "scatter", span }, 0, frames, 2)[0]).not.toEqual(
      chunk({ mode: "scatter", span }, 0, frames, 1)[0],
    );
  });

  test("a mono recording plays in both channels", () => {
    const [left, right] = recordingChunk({
      recording: /** @type {Recording} */ (samples[HASH.flac]),
      voice: /** @type {any} */ (oneVoice({ recording: HASH.flac }).voices[0]),
      seed: 1,
      first: 0,
      frames: RATE,
      sampleRate: RATE,
    });
    expect(left?.some((v) => Math.abs(v) > 0.01)).toBe(true);
    expect(left).toEqual(right);
  });

  test("stays in the budget with the longest reverb", () => {
    const genome = requireGenome(
      {
        reverbDecay: GLOBAL_PARAMS.reverbDecay.max,
        voices: [{ id: "field", type: "recording", recording: HASH.wav, fade: 0.5, rate: 2 }],
      },
      "a recording voice with the longest reverb",
    );
    expect(cost(genome)).toBeLessThanOrEqual(COST_BUDGET);
  });

  test("scheduling in suspend windows renders the same samples as scheduling up front", async () => {
    const windowed = await renderOffline(golden, { seed: 1, duration: 5, samples });
    const upFront = await renderUpFront(golden, { seed: 1, duration: 5, samples });
    expect(upFront.channels).toEqual(windowed.channels);
  });

  test("an excerpt matches the same window of a longer render (0007's tolerance)", async () => {
    const { excerpt } = await expectExcerptMatches(golden, {
      seed: 1,
      full: 9,
      offset: 5.5,
      length: 2.5,
      samples,
    });
    expect(excerpt.channels[0]?.some((v) => Math.abs(v) > 1e-3)).toBe(true);
  });

  test("a 40 s render gives the same samples when garbage is collected at every window", async () => {
    /** @type {Samples} */
    const given = samples;
    const genome = { ...golden, duration: 60 };
    const plain = await renderOffline(genome, { seed: 3, duration: 40, samples: given });
    const collected = await renderOffline(
      genome,
      { seed: 3, duration: 40, samples: given },
      (ctx) => {
        const suspend = ctx.suspend.bind(ctx);
        Object.defineProperty(ctx, "suspend", {
          value: (/** @type {number} */ time) =>
            suspend(time).then(async () => {
              collectGarbage();
              await setImmediate();
            }),
        });
      },
    );
    expect(rms(plain)).toBeGreaterThan(0.01);
    expect(collected.channels).toEqual(plain.channels);
  });
});

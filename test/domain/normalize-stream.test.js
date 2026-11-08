import { describe, expect, test } from "vitest";
import { createLimiter } from "../../src/domain/limiter.js";
import { normalize } from "../../src/domain/normalize.js";
import { normalizeStream } from "../../src/domain/normalize-stream.js";
import { firstDifference, inChunks } from "../support/streaming-inputs.js";
import { SAMPLE_RATE, stereo } from "../support/tech-3341.js";

const fs = SAMPLE_RATE;

/**
 * 30 s of a swelling bass tone with a full-scale 3 kHz burst every 0.7 s, so normalizing to a
 * loud target limits and takes more than one pass.
 */
function swellWithBursts() {
  const tone = new Float32Array(30 * fs);
  for (let n = 0; n < tone.length; n++) {
    const swell = 1 + 0.8 * Math.sin((2 * Math.PI * n) / (8 * fs));
    tone[n] =
      0.05 *
      swell *
      (0.8 * Math.sin((2 * Math.PI * 55 * n) / fs) + 0.3 * Math.sin((2 * Math.PI * 110 * n) / fs));
  }
  for (let start = fs / 4; start + 96 < tone.length; start += Math.round(0.7 * fs)) {
    for (let k = 0; k < 96; k++) {
      tone[start + k] =
        (tone[start + k] ?? 0) + Math.exp(-k / 24) * Math.sin((2 * Math.PI * 3000 * k) / fs);
    }
  }
  return stereo(tone);
}

/**
 * A source that counts how often it is read.
 * @param {Float32Array[]} channels
 * @param {number} size
 */
function countedSource(channels, size) {
  const source = () => {
    source.reads++;
    return inChunks(channels, size);
  };
  source.reads = 0;
  return source;
}

describe("normalizeStream", () => {
  test("gives normalize's gain, loudness and true peak for 30 s read in chunks", async () => {
    const input = swellWithBursts();
    const expected = normalize(input, fs, { target: -12 });
    const result = await normalizeStream(countedSource(input, 4096), fs, { target: -12 });
    expect(result.gainDb).toBe(expected.gainDb);
    expect(result.loudness).toBe(expected.loudness);
    expect(result.truePeak).toBe(expected.truePeak);
  });

  test("its gain and threshold rebuild a limiter that gives normalize's samples", async () => {
    const input = swellWithBursts();
    const expected = normalize(input, fs, { target: -12 });
    const { gainDb, threshold } = await normalizeStream(() => inChunks(input, 48000), fs, {
      target: -12,
    });
    const limiter = createLimiter(10 ** (gainDb / 20), threshold, fs);
    const output = input.map((channel) => new Float32Array(channel.length));
    const head = limiter.push(input, output);
    limiter.finish(output.map((channel) => channel.subarray(head[0]?.length ?? 0)));
    output.forEach((channel, c) => {
      expect(firstDifference(channel, expected.channels[c] ?? new Float32Array())).toBe(-1);
    });
  });

  test("reads an async source again from the start on every pass", async () => {
    const input = swellWithBursts();
    let reads = 0;
    async function* source() {
      reads++;
      yield* inChunks(input, 127 * 128);
    }
    const expected = normalize(input, fs, { target: -12 });
    const result = await normalizeStream(source, fs, { target: -12 });
    expect(result.gainDb).toBe(expected.gainDb);
    // One read to measure the input, then one a pass.
    expect(reads).toBeGreaterThan(2);
  });

  test("a missing target throws before the source is read", async () => {
    const source = countedSource(swellWithBursts(), 4096);
    // @ts-expect-error the target is required
    await expect(normalizeStream(source, fs, {})).rejects.toThrow(/target/);
    expect(source.reads).toBe(0);
  });

  test("a silent source throws as normalize does", async () => {
    const source = () => inChunks(stereo(new Float32Array(3 * fs)), 4096);
    await expect(normalizeStream(source, fs, { target: -16 })).rejects.toThrow(/-Infinity/);
  });
});

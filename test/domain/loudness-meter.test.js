import { describe, expect, test } from "vitest";
import { integratedLoudness } from "../../src/domain/integrated-loudness.js";
import { createLoudnessMeter } from "../../src/domain/loudness-meter.js";
import {
  CHUNK_SIZES,
  GOLDEN_NAMES,
  goldenExcerpts,
  inChunks,
  tech3341Signals,
} from "../support/streaming-inputs.js";
import { SAMPLE_RATE, stereo, toneSegments } from "../support/tech-3341.js";

/**
 * @param {Float32Array[]} channels
 * @param {number} size
 */
function streamed(channels, size) {
  const meter = createLoudnessMeter(SAMPLE_RATE);
  for (const chunk of inChunks(channels, size)) meter.push(chunk);
  return meter.integratedLoudness();
}

describe("createLoudnessMeter", () => {
  test.each(tech3341Signals())(
    "reads Tech 3341 $name as integratedLoudness does",
    ({ channels }) => {
      const whole = integratedLoudness(channels, SAMPLE_RATE);
      for (const size of CHUNK_SIZES) expect(streamed(channels, size)).toBe(whole);
    },
  );

  test.each(GOLDEN_NAMES)("reads %s's golden excerpts as integratedLoudness does", async (name) => {
    for (const channels of await goldenExcerpts(name)) {
      const whole = integratedLoudness(channels, SAMPLE_RATE);
      for (const size of CHUNK_SIZES) expect(streamed(channels, size)).toBe(whole);
    }
  });

  test("reads -Infinity before any block is complete", () => {
    const meter = createLoudnessMeter(SAMPLE_RATE);
    meter.push(stereo(toneSegments([{ seconds: 0.39, dbfs: -23 }])));
    expect(meter.integratedLoudness()).toBe(-Infinity);
  });

  test("a chunk with another channel count than the first throws", () => {
    const tone = toneSegments([{ seconds: 1, dbfs: -23 }]);
    const meter = createLoudnessMeter(SAMPLE_RATE);
    meter.push(stereo(tone));
    expect(() => meter.push([tone])).toThrow(/2 channels/);
  });

  test("a sample rate other than 48 kHz throws", () => {
    expect(() => createLoudnessMeter(44100)).toThrow(/48000/);
  });
});

import { describe, expect, test } from "vitest";
import { truePeak } from "../../src/domain/true-peak.js";
import { createTruePeakMeter } from "../../src/domain/true-peak-meter.js";
import {
  CHUNK_SIZES,
  GOLDEN_NAMES,
  goldenExcerpts,
  inChunks,
  tech3341Signals,
} from "../support/streaming-inputs.js";
import { SAMPLE_RATE } from "../support/tech-3341.js";

/**
 * @param {Float32Array[]} channels
 * @param {number} size
 */
function streamed(channels, size) {
  const meter = createTruePeakMeter(SAMPLE_RATE);
  for (const chunk of inChunks(channels, size)) meter.push(chunk);
  return meter.truePeak();
}

describe("createTruePeakMeter", () => {
  test.each(tech3341Signals())("reads Tech 3341 $name as truePeak does", ({ channels }) => {
    const whole = truePeak(channels, SAMPLE_RATE);
    for (const size of CHUNK_SIZES) expect(streamed(channels, size)).toBe(whole);
  });

  test.each(GOLDEN_NAMES)("reads %s's golden excerpts as truePeak does", async (name) => {
    for (const channels of await goldenExcerpts(name)) {
      const whole = truePeak(channels, SAMPLE_RATE);
      for (const size of CHUNK_SIZES) expect(streamed(channels, size)).toBe(whole);
    }
  });

  test("a peak that the filter spreads across a chunk edge reads as in one chunk", () => {
    const impulse = new Float32Array(200);
    impulse[99] = 1;
    const whole = truePeak([impulse], SAMPLE_RATE);
    for (const edge of [95, 99, 100, 105]) {
      const meter = createTruePeakMeter(SAMPLE_RATE);
      meter.push([impulse.subarray(0, edge)]);
      meter.push([impulse.subarray(edge)]);
      expect(meter.truePeak()).toBe(whole);
    }
  });

  test("a full-scale sample at the end of the last chunk is measured", () => {
    const meter = createTruePeakMeter(SAMPLE_RATE);
    meter.push([new Float32Array(100)]);
    meter.push([Float32Array.of(0, 0, 1)]);
    expect(meter.truePeak()).toBeGreaterThan(-1);
  });

  test("reads -Infinity before anything is pushed", () => {
    expect(createTruePeakMeter(SAMPLE_RATE).truePeak()).toBe(-Infinity);
  });

  test("a chunk with another channel count than the first throws", () => {
    const meter = createTruePeakMeter(SAMPLE_RATE);
    meter.push([new Float32Array(10), new Float32Array(10)]);
    expect(() => meter.push([new Float32Array(10)])).toThrow(/2 channels/);
  });

  test("a sample rate other than 48 kHz throws", () => {
    expect(() => createTruePeakMeter(44100)).toThrow(/48000/);
  });
});

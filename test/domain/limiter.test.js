import { describe, expect, test } from "vitest";
import { limitTruePeak } from "../../src/domain/limit-true-peak.js";
import { createLimiter } from "../../src/domain/limiter.js";
import { truePeak } from "../../src/domain/true-peak.js";
import {
  CHUNK_SIZES,
  firstDifference,
  GOLDEN_NAMES,
  goldenExcerpts,
  inChunks,
  tech3341Signals,
} from "../support/streaming-inputs.js";
import { dbToGain, SAMPLE_RATE } from "../support/tech-3341.js";

const THRESHOLD = dbToGain(-1.4);

/**
 * A gain that puts the sample peak 6 dB over the threshold, so the limiter works.
 * @param {Float32Array[]} channels
 */
function overGain(channels) {
  let peak = 0;
  for (const channel of channels) for (const x of channel) peak = Math.max(peak, Math.abs(x));
  return peak > 0 ? (2 * THRESHOLD) / peak : 1;
}

/**
 * @param {Float32Array[]} channels
 * @param {number} gain
 */
function whole(channels, gain) {
  const output = channels.map((channel) => new Float32Array(channel.length));
  limitTruePeak(channels, output, gain, THRESHOLD, SAMPLE_RATE);
  return output;
}

/**
 * The limiter fed `chunks`, its outputs joined.
 * @param {Iterable<Float32Array[]>} chunks
 * @param {number} channelCount
 * @param {number} gain
 */
function streamed(chunks, channelCount, gain) {
  const limiter = createLimiter(gain, THRESHOLD, SAMPLE_RATE);
  /** @type {Float32Array[][]} */
  const parts = [];
  for (const chunk of chunks) parts.push(limiter.push(chunk));
  parts.push(limiter.finish());
  return Array.from({ length: channelCount }, (_, c) => {
    const length = parts.reduce((sum, part) => sum + (part[c]?.length ?? 0), 0);
    const out = new Float32Array(length);
    let at = 0;
    for (const part of parts) {
      const piece = part[c] ?? new Float32Array();
      out.set(piece, at);
      at += piece.length;
    }
    return out;
  });
}

// One-frame chunks cost about 4 µs a frame in push overhead, so they run over the first 5 s
// only: the 80 and 100 s Tech 3341 cases took over 30 s each in full. Every carried state
// crosses thousands of edges in 5 s, and the larger chunk sizes cover the full signals.
const ONE_FRAME_SECONDS = 5;

/**
 * Expects the limiter in every chunk size to give limitTruePeak's bits.
 * @param {Float32Array[]} full
 */
function expectSameBits(full) {
  const gain = overGain(full);
  const head = full.map((channel) => channel.subarray(0, ONE_FRAME_SECONDS * SAMPLE_RATE));
  const wholeFull = whole(full, gain);
  const wholeHead = whole(head, gain);
  for (const size of CHUNK_SIZES) {
    const channels = size === 1 ? head : full;
    const expected = size === 1 ? wholeHead : wholeFull;
    const actual = streamed(inChunks(channels, size), channels.length, gain);
    actual.forEach((channel, c) => {
      expect(firstDifference(channel, expected[c] ?? new Float32Array())).toBe(-1);
    });
  }
}

describe("createLimiter", () => {
  test.each(tech3341Signals())("limits Tech 3341 $name as limitTruePeak does", ({ channels }) => {
    expectSameBits(channels);
  });

  test.each(GOLDEN_NAMES)("limits %s's golden excerpts as limitTruePeak does", async (name) => {
    for (const channels of await goldenExcerpts(name)) expectSameBits(channels);
  });

  test("a peak just after a chunk edge is reduced from before the edge", () => {
    const tone = new Float32Array(SAMPLE_RATE / 2);
    for (let n = 0; n < tone.length; n++) tone[n] = 0.1 * Math.sin((2 * Math.PI * 220 * n) / 48000);
    const edge = 12000;
    // A 1 ms burst starting 5 frames after the edge: the 5 ms look-ahead starts the gain
    // down about 245 frames before it.
    for (let k = 0; k < 48; k++) tone[edge + 5 + k] = Math.sin((2 * Math.PI * 3000 * k) / 48000);
    const channels = [tone];
    const gain = 1;
    const expected = whole(channels, gain);
    const [actual = new Float32Array()] = streamed(
      [[tone.subarray(0, edge)], [tone.subarray(edge)]],
      1,
      gain,
    );
    expect(firstDifference(actual, expected[0] ?? new Float32Array())).toBe(-1);
    expect(Math.abs((actual[edge - 1] ?? 0) / (tone[edge - 1] ?? 1))).toBeLessThan(0.99);
    expect(truePeak([actual], SAMPLE_RATE)).toBeLessThanOrEqual(-1.4 + 1e-6);
    expect(truePeak(channels, SAMPLE_RATE)).toBeGreaterThan(-1);
  });

  test("push returns only the frames whose look-ahead it has, and finish the rest", () => {
    const limiter = createLimiter(1, THRESHOLD, SAMPLE_RATE);
    const [first] = limiter.push([new Float32Array(100)]);
    const [second] = limiter.push([new Float32Array(1000)]);
    const [rest] = limiter.finish();
    expect(first?.length).toBe(0);
    expect((second?.length ?? 0) + (rest?.length ?? 0)).toBe(1100);
    expect(rest?.length).toBeGreaterThan(0);
  });

  test("writes into the output it is given", () => {
    const input = [new Float32Array(1000).fill(0.25)];
    const output = [new Float32Array(1000)];
    const limiter = createLimiter(2, THRESHOLD, SAMPLE_RATE);
    const [head] = limiter.push(input, output);
    const [tail] = limiter.finish([output[0]?.subarray(head?.length ?? 0) ?? new Float32Array()]);
    expect(head?.buffer).toBe(output[0]?.buffer);
    expect(tail?.buffer).toBe(output[0]?.buffer);
    expect(output[0]).toEqual(new Float32Array(1000).fill(0.5));
  });

  test("an output too short for the frames a push releases throws", () => {
    const limiter = createLimiter(1, THRESHOLD, SAMPLE_RATE);
    expect(() => limiter.push([new Float32Array(1000)], [new Float32Array(10)])).toThrow(
      /needs \d+ frames/,
    );
  });

  test("a push after finish throws", () => {
    const limiter = createLimiter(1, THRESHOLD, SAMPLE_RATE);
    limiter.finish();
    expect(() => limiter.push([new Float32Array(10)])).toThrow(/finished/);
  });

  test("a chunk with another channel count than the first throws", () => {
    const limiter = createLimiter(1, THRESHOLD, SAMPLE_RATE);
    limiter.push([new Float32Array(10), new Float32Array(10)]);
    expect(() => limiter.push([new Float32Array(10)])).toThrow(/2 channels/);
  });
});

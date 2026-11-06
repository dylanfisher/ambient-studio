import { describe, expect, test } from "vitest";
import { encodePcm24 } from "../../src/server/encode-pcm24.js";

/**
 * @param {number[]} samples
 * @returns {number[]} the bytes of one mono channel
 */
function encodeMono(samples) {
  return [...encodePcm24([new Float32Array(samples)])];
}

describe("encodePcm24", () => {
  test("encodes 0, +1.0 and -1.0 as little-endian 24-bit integers", () => {
    expect(encodeMono([0, 1, -1])).toEqual([0x00, 0x00, 0x00, 0xff, 0xff, 0x7f, 0x00, 0x00, 0x80]);
  });

  test("rounds to the nearest step", () => {
    const step = 2 ** -23;
    expect(encodeMono([step * 0.4, step * 0.6, -step * 0.6, 0.5])).toEqual([
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x40,
    ]);
  });

  test("clips out-of-range samples to the largest and smallest steps", () => {
    expect(encodeMono([1.5, -1.5, Infinity, -Infinity])).toEqual([
      0xff, 0xff, 0x7f, 0x00, 0x00, 0x80, 0xff, 0xff, 0x7f, 0x00, 0x00, 0x80,
    ]);
  });

  test("interleaves channels frame by frame", () => {
    const left = new Float32Array([0.5, 0]);
    const right = new Float32Array([-0.5, 1]);
    expect([...encodePcm24([left, right])]).toEqual([
      0x00, 0x00, 0x40, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0xff, 0xff, 0x7f,
    ]);
  });

  test("throws on NaN, naming the channel and frame", () => {
    expect(() => encodePcm24([new Float32Array(2), new Float32Array([0, Number.NaN])])).toThrow(
      /channel 1, frame 1/,
    );
  });

  test("throws when channels differ in length", () => {
    expect(() => encodePcm24([new Float32Array(2), new Float32Array(3)])).toThrow(/length/);
  });
});

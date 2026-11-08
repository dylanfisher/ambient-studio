import { describe, expect, test } from "vitest";
import { encodeFloat32 } from "../../src/server/encode-float32.js";

describe("encodeFloat32", () => {
  test("interleaves channels as little-endian 32-bit floats", () => {
    const bytes = encodeFloat32([Float32Array.of(1, -2.5), Float32Array.of(0.25, 3)]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(bytes.length).toBe(16);
    expect([0, 4, 8, 12].map((at) => view.getFloat32(at, true))).toEqual([1, 0.25, -2.5, 3]);
  });

  test("a NaN throws, naming the channel and frame", () => {
    expect(() => encodeFloat32([Float32Array.of(0, 0), Float32Array.of(0, NaN)])).toThrow(
      /channel 1, frame 1/,
    );
  });

  test("an infinite sample throws", () => {
    expect(() => encodeFloat32([Float32Array.of(Infinity)])).toThrow(/Infinity/);
  });

  test("channels of different lengths throw", () => {
    expect(() => encodeFloat32([new Float32Array(2), new Float32Array(3)])).toThrow(/length/);
  });
});

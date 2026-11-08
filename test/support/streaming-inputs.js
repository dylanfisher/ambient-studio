// Inputs for the tests that hold the streaming meters and limiter to the whole-array functions
// (decision 0060): the chunk sizes, the Tech 3341 signals, the golden excerpts, and a way to
// feed any of them in chunks.
import { goldenGenomes, goldenWindows, renderRaw } from "./golden.js";
import { SAMPLE_RATE, splicedBurst, stereo, taperedSine, toneSegments } from "./tech-3341.js";

/** One frame, a prime that no block or sub-block length divides, the meters' 4,096, 1 s. */
export const CHUNK_SIZES = [1, 127, 4096, 48000];

/**
 * `channels` as consecutive chunks of `size` frames, the last one shorter when `size` doesn't
 * divide the length. Each chunk is a view, not a copy.
 * @param {Float32Array[]} channels
 * @param {number} size
 * @returns {Generator<Float32Array[]>}
 */
export function* inChunks(channels, size) {
  const length = channels[0]?.length ?? 0;
  for (let start = 0; start < length; start += size) {
    yield channels.map((channel) => channel.subarray(start, start + size));
  }
}

/**
 * Index of the first element whose bits differ, or -1 when the arrays hold the same bits.
 * A length mismatch counts as a difference at the shorter length.
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
export function firstDifference(a, b) {
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.length);
  const length = Math.min(x.length, y.length);
  for (let i = 0; i < length; i++) if (x[i] !== y[i]) return i;
  return x.length === y.length ? -1 : length;
}

/**
 * The Tech 3341 Table 1 signals the meter tests synthesize: the integrated-loudness cases 1 to
 * 5 and the true-peak cases 15 to 23, each in stereo.
 * @returns {{ name: string, channels: Float32Array[] }[]}
 */
export function tech3341Signals() {
  const fs = SAMPLE_RATE;
  const loudness = [
    [{ seconds: 20, dbfs: -23 }],
    [{ seconds: 20, dbfs: -33 }],
    [
      { seconds: 10, dbfs: -36 },
      { seconds: 60, dbfs: -23 },
      { seconds: 10, dbfs: -36 },
    ],
    [
      { seconds: 10, dbfs: -72 },
      { seconds: 10, dbfs: -36 },
      { seconds: 60, dbfs: -23 },
      { seconds: 10, dbfs: -36 },
      { seconds: 10, dbfs: -72 },
    ],
    [
      { seconds: 20, dbfs: -26 },
      { seconds: 20.1, dbfs: -20 },
      { seconds: 20, dbfs: -26 },
    ],
  ].map((segments, i) => ({ name: `case ${i + 1}`, channels: stereo(toneSegments(segments)) }));
  const sines = [
    { frequency: fs / 4, amplitude: 0.5, degrees: 0 },
    { frequency: fs / 4, amplitude: 0.5, degrees: 45 },
    { frequency: fs / 6, amplitude: 0.5, degrees: 60 },
    { frequency: fs / 8, amplitude: 0.5, degrees: 67.5 },
    { frequency: fs / 4, amplitude: 1.41, degrees: 45 },
  ].map((tone, i) => ({
    name: `case ${15 + i}`,
    channels: stereo(taperedSine({ ...tone, seconds: 1 })),
  }));
  const bursts = [0, 1, 2, 3].map((offset) => ({
    name: `case ${20 + offset}`,
    channels: stereo(splicedBurst(offset)),
  }));
  return [...loudness, ...sines, ...bursts];
}

/** Every golden genome's name, for `test.each`. */
export const GOLDEN_NAMES = goldenGenomes().map(({ name }) => name);

/**
 * The raw golden windows of one golden genome, rendered as the golden test renders them.
 * @param {string} name
 * @returns {Promise<Float32Array[][]>}
 */
export async function goldenExcerpts(name) {
  const golden = goldenGenomes().find((g) => g.name === name);
  if (!golden) throw new Error(`no golden genome "${name}"`);
  const excerpts = [];
  for (const window of goldenWindows(golden.genome, "raw")) {
    excerpts.push(await renderRaw(golden.genome, window));
  }
  return excerpts;
}

// Decoding a reference region with ffmpeg (decision 0050): 48 kHz stereo floats, the frames the
// bounds name, the same samples every time, and a mono file in both channels.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { DECODE_RATE, decodeWithFfmpeg } from "../../src/server/decode-with-ffmpeg.js";
import { FIXTURE_FORMATS, makeReference } from "../support/reference-fixtures.js";

/** @type {string} */
let folder;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "decode-ffmpeg-"));
});
afterAll(() => rm(folder, { recursive: true }));

test.each(Object.keys(FIXTURE_FORMATS))(
  "a region of the %s fixture decodes to the frames its bounds name",
  async (format) => {
    const path = await makeReference(folder, /** @type {any} */ (format));
    const decoded = await decodeWithFfmpeg(path, 2.5, 5.75);
    expect(decoded.sampleRate).toBe(DECODE_RATE);
    expect(decoded.channels).toHaveLength(2);
    for (const channel of decoded.channels) expect(channel.length).toBe(3.25 * DECODE_RATE);
    const peak = decoded.channels[0]?.reduce((most, x) => Math.max(most, Math.abs(x)), 0) ?? 0;
    expect(peak).toBeGreaterThan(0.1);
  },
);

test("the same region decodes to the same samples twice", async () => {
  const path = await makeReference(folder, "flac", { seed: 3 });
  const first = await decodeWithFfmpeg(path, 1, 4);
  const second = await decodeWithFfmpeg(path, 1, 4);
  expect(second.channels).toEqual(first.channels);
  // A later start reads later samples: the seek happened.
  const later = await decodeWithFfmpeg(path, 2, 5);
  expect(later.channels[0]?.subarray(0, DECODE_RATE)).toEqual(
    first.channels[0]?.subarray(DECODE_RATE, 2 * DECODE_RATE),
  );
});

test("a mono file plays the same samples in both channels", async () => {
  const path = await makeReference(folder, "wav", { channels: 1 });
  const { channels } = await decodeWithFfmpeg(path, 0, 2);
  expect(channels).toHaveLength(2);
  expect(channels[1]).toEqual(channels[0]);
});

test("a region past the end of the file throws, naming the frames it got", async () => {
  const path = await makeReference(folder, "wav", { seconds: 12 });
  await expect(decodeWithFfmpeg(path, 10, 14)).rejects.toThrow(/frames/);
});

test("bounds that aren't a region are refused before ffmpeg runs", async () => {
  await expect(decodeWithFfmpeg(join(folder, "none.wav"), 3, 2)).rejects.toThrow(/start/);
  await expect(decodeWithFfmpeg(join(folder, "none.wav"), Number.NaN, 2)).rejects.toThrow(/start/);
});

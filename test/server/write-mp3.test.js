// Playback MP3s through the lame CLI (decision 0048): 320 kbps in every frame, the length that
// went in, and lame's stderr when it fails.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { encodePcm24 } from "../../src/server/encode-pcm24.js";
import { MP3_KBPS, writeMp3 } from "../../src/server/write-mp3.js";
import { decodeMp3, mp3Frames } from "../support/mp3.js";

const SAMPLE_RATE = 48000;

/** @type {string} */
let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "write-mp3-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true });
});

/**
 * Two seconds of a tone per channel at a quarter of full scale.
 * @param {number} count channels
 */
function tones(count) {
  return Array.from({ length: count }, (_, c) => {
    const channel = new Float32Array(2 * SAMPLE_RATE);
    for (let i = 0; i < channel.length; i++) {
      channel[i] = 0.25 * Math.sin((2 * Math.PI * (440 + 110 * c) * i) / SAMPLE_RATE);
    }
    return channel;
  });
}

test("writes constant 320 kbps at the input's rate, decoding to its length and level", async () => {
  const channels = tones(2);
  const path = join(dir, "out.mp3");
  await writeMp3(path, encodePcm24(channels), { channelCount: 2, sampleRate: SAMPLE_RATE });
  const frames = mp3Frames(await readFile(path));
  expect(MP3_KBPS).toBe(320);
  expect(new Set(frames.map(({ kbps }) => kbps))).toEqual(new Set([MP3_KBPS]));
  expect(frames.every((frame) => frame.sampleRate === SAMPLE_RATE && frame.channels === 2)).toBe(
    true,
  );
  const decoded = await decodeMp3(path);
  expect(decoded).toHaveLength(2);
  expect(decoded[0]?.length).toBe(channels[0]?.length);
  const peak = Math.max(...(decoded[1] ?? []).map(Math.abs));
  expect(peak).toBeCloseTo(0.25, 1);
});

test("writes mono as mono", async () => {
  const path = join(dir, "mono.mp3");
  await writeMp3(path, encodePcm24(tones(1)), { channelCount: 1, sampleRate: SAMPLE_RATE });
  expect(mp3Frames(await readFile(path)).every(({ channels }) => channels === 1)).toBe(true);
});

test("refuses more than two channels before starting lame", async () => {
  await expect(
    writeMp3(join(dir, "x.mp3"), encodePcm24(tones(3)), {
      channelCount: 3,
      sampleRate: SAMPLE_RATE,
    }),
  ).rejects.toThrow(/1 or 2 channels, not 3/);
});

test("throws with lame's stderr when lame fails", async () => {
  await expect(
    writeMp3(join(dir, "missing", "out.mp3"), encodePcm24(tones(2)), {
      channelCount: 2,
      sampleRate: SAMPLE_RATE,
    }),
  ).rejects.toThrow(/lame exited with code \d+ writing .*missing\/out\.mp3:\n\S/s);
});

test("takes the PCM as chunks, so a whole track is never held, with the same bytes", async () => {
  const pcm = encodePcm24(tones(2));
  const whole = join(dir, "whole.mp3");
  const streamed = join(dir, "streamed.mp3");
  await writeMp3(whole, pcm, { channelCount: 2, sampleRate: SAMPLE_RATE });
  async function* chunks() {
    for (let at = 0; at < pcm.length; at += 6000) yield pcm.subarray(at, at + 6000);
  }
  await writeMp3(streamed, chunks(), { channelCount: 2, sampleRate: SAMPLE_RATE });
  expect(await readFile(streamed)).toEqual(await readFile(whole));
});

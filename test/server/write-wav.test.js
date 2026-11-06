import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { writeWav } from "../../src/server/write-wav.js";

/** @type {string} */
let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "write-wav-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true });
});

describe("writeWav", () => {
  test("writes a PCM header with the rate, bit depth, channel count and data size", async () => {
    const path = join(dir, "out.wav");
    const pcm = new Uint8Array(6 * 5).map((_, i) => i);
    await writeWav(path, pcm, { channelCount: 2, sampleRate: 48000 });
    const file = await readFile(path);
    expect(file.toString("latin1", 0, 4)).toBe("RIFF");
    expect(file.readUInt32LE(4)).toBe(file.length - 8);
    expect(file.toString("latin1", 8, 16)).toBe("WAVEfmt ");
    expect(file.readUInt32LE(16)).toBe(16);
    expect(file.readUInt16LE(20)).toBe(1);
    expect(file.readUInt16LE(22)).toBe(2);
    expect(file.readUInt32LE(24)).toBe(48000);
    expect(file.readUInt32LE(28)).toBe(48000 * 6);
    expect(file.readUInt16LE(32)).toBe(6);
    expect(file.readUInt16LE(34)).toBe(24);
    expect(file.toString("latin1", 36, 40)).toBe("data");
    expect(file.readUInt32LE(40)).toBe(pcm.length);
    expect([...file.subarray(44)]).toEqual([...pcm]);
  });

  test("pads an odd-sized data chunk to an even length, as RIFF requires", async () => {
    const path = join(dir, "mono.wav");
    await writeWav(path, new Uint8Array(3), { channelCount: 1, sampleRate: 48000 });
    const file = await readFile(path);
    expect(file.readUInt32LE(40)).toBe(3);
    expect(file.length).toBe(44 + 4);
    expect(file.readUInt32LE(4)).toBe(file.length - 8);
  });

  test("throws when the PCM isn't a whole number of frames", async () => {
    await expect(
      writeWav(join(dir, "bad.wav"), new Uint8Array(4), { channelCount: 2, sampleRate: 48000 }),
    ).rejects.toThrow(/frames/);
  });
});

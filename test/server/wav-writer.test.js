import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { encodeFloat32 } from "../../src/server/encode-float32.js";
import { encodePcm24 } from "../../src/server/encode-pcm24.js";
import { createWavWriter, FLOAT32, PCM24 } from "../../src/server/wav-writer.js";
import { writeWav } from "../../src/server/write-wav.js";
import { firstDifference, inChunks } from "../support/streaming-inputs.js";

/** Set by a test to make a file handle's writes fail, as a full disk does. */
const disk = vi.hoisted(() => ({ full: false }));
vi.mock("node:fs/promises", async (original) => {
  const real = /** @type {typeof import("node:fs/promises")} */ (await original());
  return {
    ...real,
    /** @type {typeof real.open} */
    open: async (path, flags, mode) => {
      const handle = await real.open(path, flags, mode);
      const write = handle.write.bind(handle);
      // @ts-expect-error the stand-in takes the overload the writer calls
      handle.write = (...args) => {
        if (disk.full) return Promise.reject(new Error("ENOSPC: no space left on device"));
        // @ts-expect-error passed through as given
        return write(...args);
      };
      return handle;
    },
  };
});

/** @type {string} */
let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wav-writer-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true });
});

/** @param {number} frames */
function noise(frames) {
  let state = 1;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return (state / 2 ** 30 - 1) * 0.9;
  };
  return [Float32Array.from({ length: frames }, next), Float32Array.from({ length: frames }, next)];
}

describe("createWavWriter", () => {
  test.each([1, 127, 4096, 48000])(
    "24-bit PCM appended in chunks of %d frames gives writeWav's file",
    async (size) => {
      const channels = noise(10007);
      const format = { channelCount: 2, sampleRate: 48000 };
      await writeWav(join(dir, "whole.wav"), encodePcm24(channels), format);
      const writer = await createWavWriter(join(dir, "streamed.wav"), {
        ...format,
        frames: 10007,
        sampleFormat: PCM24,
      });
      for (const chunk of inChunks(channels, size)) await writer.append(encodePcm24(chunk));
      await writer.close();
      const streamed = await readFile(join(dir, "streamed.wav"));
      expect(streamed.equals(await readFile(join(dir, "whole.wav")))).toBe(true);
    },
  );

  test("an odd-sized mono file is padded as writeWav pads it", async () => {
    const channels = [Float32Array.of(0.5)];
    const format = { channelCount: 1, sampleRate: 48000 };
    await writeWav(join(dir, "whole.wav"), encodePcm24(channels), format);
    const writer = await createWavWriter(join(dir, "streamed.wav"), {
      ...format,
      frames: 1,
      sampleFormat: PCM24,
    });
    await writer.append(encodePcm24(channels));
    await writer.close();
    const streamed = await readFile(join(dir, "streamed.wav"));
    expect(streamed.equals(await readFile(join(dir, "whole.wav")))).toBe(true);
  });

  test("a total short of the stated frames throws and leaves no file", async () => {
    const path = join(dir, "short.wav");
    const writer = await createWavWriter(path, {
      channelCount: 2,
      sampleRate: 48000,
      frames: 100,
      sampleFormat: PCM24,
    });
    await writer.append(encodePcm24(noise(99)));
    await expect(writer.close()).rejects.toThrow(/99 of the 100 frames/);
    expect(existsSync(path)).toBe(false);
  });

  test("a chunk past the stated frames throws and leaves no file", async () => {
    const path = join(dir, "long.wav");
    const writer = await createWavWriter(path, {
      channelCount: 2,
      sampleRate: 48000,
      frames: 100,
      sampleFormat: PCM24,
    });
    await writer.append(encodePcm24(noise(60)));
    await expect(writer.append(encodePcm24(noise(60)))).rejects.toThrow(/120 frames.*100/);
    expect(existsSync(path)).toBe(false);
  });

  test("a chunk that isn't whole frames throws", async () => {
    const writer = await createWavWriter(join(dir, "bad.wav"), {
      channelCount: 2,
      sampleRate: 48000,
      frames: 100,
      sampleFormat: PCM24,
    });
    await expect(writer.append(new Uint8Array(4))).rejects.toThrow(/frames/);
  });

  test("a failed write closes and removes the file, and later appends throw", async () => {
    const path = join(dir, "full.wav");
    const writer = await createWavWriter(path, {
      channelCount: 2,
      sampleRate: 48000,
      frames: 100,
      sampleFormat: PCM24,
    });
    disk.full = true;
    try {
      await expect(writer.append(encodePcm24(noise(50)))).rejects.toThrow(/ENOSPC/);
    } finally {
      disk.full = false;
    }
    expect(existsSync(path)).toBe(false);
    await expect(writer.append(encodePcm24(noise(50)))).rejects.toThrow(/already closed/);
  });

  test("abort closes and removes the file, and later appends throw", async () => {
    const path = join(dir, "aborted.wav");
    const writer = await createWavWriter(path, {
      channelCount: 2,
      sampleRate: 48000,
      frames: 100,
      sampleFormat: PCM24,
    });
    await writer.append(encodePcm24(noise(50)));
    await writer.abort();
    expect(existsSync(path)).toBe(false);
    await expect(writer.append(encodePcm24(noise(50)))).rejects.toThrow(/already closed/);
    await expect(writer.close()).rejects.toThrow(/already closed/);
  });

  test("refuses to overwrite an existing file", async () => {
    const path = join(dir, "kept.wav");
    await writeFile(path, "kept");
    await expect(
      createWavWriter(path, {
        channelCount: 2,
        sampleRate: 48000,
        frames: 1,
        sampleFormat: PCM24,
      }),
    ).rejects.toThrow(/EEXIST/);
    expect(await readFile(path, "utf8")).toBe("kept");
  });

  test("32-bit float reads back exactly, values past full scale included", async () => {
    const left = Float32Array.of(0, -0, 1, -1, 1.75, -3.5, 1e-40, 0.1, -0.333);
    const right = left.map((x) => -x / 3);
    const path = join(dir, "stem.wav");
    const writer = await createWavWriter(path, {
      channelCount: 2,
      sampleRate: 48000,
      frames: left.length,
      sampleFormat: FLOAT32,
    });
    for (const chunk of inChunks([left, right], 4)) await writer.append(encodeFloat32(chunk));
    await writer.close();

    const file = await readFile(path);
    expect(file.toString("latin1", 0, 4)).toBe("RIFF");
    expect(file.readUInt32LE(4)).toBe(file.length - 8);
    expect(file.toString("latin1", 8, 16)).toBe("WAVEfmt ");
    expect(file.readUInt32LE(16)).toBe(18);
    expect(file.readUInt16LE(20)).toBe(3);
    expect(file.readUInt16LE(22)).toBe(2);
    expect(file.readUInt32LE(24)).toBe(48000);
    expect(file.readUInt32LE(28)).toBe(48000 * 8);
    expect(file.readUInt16LE(32)).toBe(8);
    expect(file.readUInt16LE(34)).toBe(32);
    expect(file.readUInt16LE(36)).toBe(0);
    expect(file.toString("latin1", 38, 42)).toBe("fact");
    expect(file.readUInt32LE(42)).toBe(4);
    expect(file.readUInt32LE(46)).toBe(left.length);
    expect(file.toString("latin1", 50, 54)).toBe("data");
    expect(file.readUInt32LE(54)).toBe(left.length * 8);
    const back = [new Float32Array(left.length), new Float32Array(left.length)];
    for (let i = 0; i < left.length; i++) {
      for (const [c, channel] of back.entries()) channel[i] = file.readFloatLE(58 + 8 * i + 4 * c);
    }
    expect(firstDifference(back[0] ?? new Float32Array(), left)).toBe(-1);
    expect(firstDifference(back[1] ?? new Float32Array(), right)).toBe(-1);
  });
});

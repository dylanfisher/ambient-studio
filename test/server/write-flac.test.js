import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { encodePcm24 } from "../../src/server/encode-pcm24.js";
import { writeFlac } from "../../src/server/write-flac.js";
import { writeWav } from "../../src/server/write-wav.js";

const run = promisify(execFile);
const SAMPLE_RATE = 48000;

/** @type {string} */
let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "write-flac-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true });
});

/**
 * The bytes of a WAV file's data chunk, found by walking the chunks, since `flac -d` may write
 * a different header from ours.
 * @param {Buffer} file
 */
function dataChunk(file) {
  for (let at = 12; at + 8 <= file.length; ) {
    const size = file.readUInt32LE(at + 4);
    if (file.toString("latin1", at, at + 4) === "data") return file.subarray(at + 8, at + 8 + size);
    at += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

/** Two seconds of a chirp and a noise-like channel, so every byte of a sample varies. */
function testSignal() {
  const frames = 2 * SAMPLE_RATE;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = 0.9 * Math.sin((i * i) / 2e6);
    right[i] = 0.5 * Math.sin(i * 12.9898);
  }
  return [left, right];
}

describe("writeFlac", () => {
  test("decodes with flac -d to the WAV's samples, bit for bit", async () => {
    const pcm = encodePcm24(testSignal());
    const wavPath = join(dir, "out.wav");
    const flacPath = join(dir, "out.flac");
    await writeWav(wavPath, pcm, { channelCount: 2, sampleRate: SAMPLE_RATE });
    await writeFlac(wavPath, flacPath);
    const decodedPath = join(dir, "decoded.wav");
    await run("flac", ["-d", "--silent", "-o", decodedPath, flacPath]);
    const decoded = await readFile(decodedPath);
    expect(decoded.readUInt16LE(22)).toBe(2);
    expect(decoded.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(decoded.readUInt16LE(34)).toBe(24);
    expect(Buffer.compare(dataChunk(decoded), Buffer.from(pcm))).toBe(0);
  });

  test("throws with flac's stderr when flac fails", async () => {
    const wavPath = join(dir, "out.wav");
    await writeWav(wavPath, new Uint8Array(6), { channelCount: 2, sampleRate: SAMPLE_RATE });
    await expect(writeFlac(wavPath, join(dir, "missing", "out.flac"))).rejects.toThrow(
      /flac exited with code 1 writing .*missing\/out\.flac:.*opening the output file/s,
    );
  });
});

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { encodePcm24 } from "../../src/server/encode-pcm24.js";
import { flacClosedFirst, writeFlac } from "../../src/server/write-flac.js";
import { writeWav } from "../../src/server/write-wav.js";

const run = promisify(execFile);
const SAMPLE_RATE = 48000;

/** @type {string} */
let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "write-flac-"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
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

  describe("with a flac that exits 0 without reading all its input", () => {
    /** Puts a `flac` on PATH that reads one byte of stdin and exits 0, leaving the rest unread. */
    async function stubEarlyFlac() {
      const bin = join(dir, "bin");
      await mkdir(bin);
      await writeFile(join(bin, "flac"), "#!/bin/sh\nhead -c 1 > /dev/null\nexit 0\n");
      await chmod(join(bin, "flac"), 0o755);
      vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    }

    test("resolves, since the pipe closing early is not a failure", async () => {
      await stubEarlyFlac();
      // Far more than a pipe holds, so the write is still pending when the stub exits.
      const wavPath = join(dir, "out.wav");
      await writeWav(wavPath, new Uint8Array(6 * 1_400_000), {
        channelCount: 2,
        sampleRate: SAMPLE_RATE,
      });
      await expect(writeFlac(wavPath, join(dir, "out.flac"))).resolves.toBeUndefined();
    });

    test("still throws a read error on the WAV", async () => {
      await stubEarlyFlac();
      await expect(writeFlac(join(dir, "missing.wav"), join(dir, "out.flac"))).rejects.toThrow(
        /ENOENT/,
      );
    });
  });

  test.each(["ERR_STREAM_PREMATURE_CLOSE", "EPIPE", "ENOTCONN"])(
    "treats %s on flac's stdin as flac having stopped reading",
    (code) => {
      expect(flacClosedFirst(Object.assign(new Error("write"), { code }))).toBe(true);
    },
  );

  test("a cancel kills flac and removes its partial file", async () => {
    const wavPath = join(dir, "out.wav");
    const flacPath = join(dir, "out.flac");
    await writeWav(wavPath, encodePcm24(testSignal()), {
      channelCount: 2,
      sampleRate: SAMPLE_RATE,
    });
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(writeFlac(wavPath, flacPath, controller.signal)).rejects.toThrow("cancelled");
    expect(existsSync(flacPath)).toBe(false);
  });

  test("does not treat a read error on the WAV as flac having stopped reading", () => {
    expect(flacClosedFirst(Object.assign(new Error("read"), { code: "EIO" }))).toBe(false);
  });
});

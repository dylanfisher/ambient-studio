// Decoding the synthetic fixtures through node-web-audio-api, and loading a genome's recordings
// from an index (decision 0029). The fixtures are 44.1 kHz, so every decode resamples to 48 kHz.
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import recordingGenome from "../../src/engine/genomes/field-recording.json" with { type: "json" };
import { requireGenome } from "../../src/engine/validate-genome.js";
import { decodeRecording, loadSamples } from "../../src/server/load-samples.js";
import { indexRecordings } from "../../src/server/recording-index.js";
import { sha256Hex } from "../../src/server/sha256-hex.js";
import { FIXTURE_RECORDINGS } from "../support/golden.js";

const RATE = 48000;
const golden = requireGenome(recordingGenome, "the field-recording golden genome");

/** @param {Float32Array[]} channels */
const hashChannels = (channels) =>
  sha256Hex(Buffer.concat(channels.map((c) => Buffer.from(c.buffer))));

describe("decodeRecording", () => {
  // Measured on mbp2021 with node-web-audio-api 2.2.0: 44,100 frames come back as 48,001, the
  // resampled length rounded up, and the last frame is the file's last sample.
  test.each([
    { file: "noise-tone.wav", channels: 2, frames: 96001 },
    { file: "brown-mono.flac", channels: 1, frames: 48001 },
    { file: "tones.aiff", channels: 2, frames: 48001 },
  ])(
    "reads $file at 48 kHz, the same samples on every decode",
    async ({ file, channels, frames }) => {
      const bytes = await readFile(join(FIXTURE_RECORDINGS, file));
      const a = await decodeRecording(bytes);
      const b = await decodeRecording(bytes);
      expect(a.sampleRate).toBe(RATE);
      expect(a.channels.map((c) => c.length)).toEqual(Array(channels).fill(frames));
      expect(a.channels.some((c) => c.some((v) => Math.abs(v) > 0.01))).toBe(true);
      expect(hashChannels([...b.channels])).toBe(hashChannels([...a.channels]));
    },
  );
});

describe("loadSamples", () => {
  /** @type {string} */
  let folder;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "load-samples-"));
    for (const file of ["noise-tone.wav", "brown-mono.flac"]) {
      await copyFile(join(FIXTURE_RECORDINGS, file), join(folder, file));
    }
  });
  afterEach(async () => {
    await rm(folder, { recursive: true });
  });

  test("decodes each recording the genome names, with its file", async () => {
    const { samples, files } = await loadSamples(golden, await indexRecordings(folder));
    const hashes = golden.voices.map((v) => /** @type {string} */ (v.recording));
    expect(Object.keys(samples).sort()).toEqual([...hashes].sort());
    expect(files).toEqual(
      Object.fromEntries(
        golden.voices.map((v) => [
          v.recording,
          v.id === "brook" ? "brown-mono.flac" : "noise-tone.wav",
        ]),
      ),
    );
    expect(samples[/** @type {string} */ (hashes[0])]?.sampleRate).toBe(RATE);
  });

  test("a file changed since it was indexed fails naming the file", async () => {
    const index = await indexRecordings(folder);
    await copyFile(join(FIXTURE_RECORDINGS, "tones.aiff"), join(folder, "brown-mono.flac"));
    await expect(loadSamples(golden, index)).rejects.toThrow(
      /brown-mono\.flac changed since it was indexed/,
    );
  });

  test("a hash no file has fails naming the file the sidecar gave", async () => {
    await rm(join(folder, "noise-tone.wav"));
    const index = await indexRecordings(folder);
    const field = /** @type {string} */ (golden.voices.find((v) => v.id === "field")?.recording);
    await expect(loadSamples(golden, index, { [field]: "walks/noise-tone.wav" })).rejects.toThrow(
      /recording walks\/noise-tone\.wav \(sha256 [0-9a-f]{64}\) is in no file of the recordings folder/,
    );
    await expect(loadSamples(golden, undefined)).rejects.toThrow(/no recordings folder was given/);
  });
});

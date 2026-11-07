// The header reader on the synthetic fixtures and on broken copies of them (decision 0029):
// every file it can't read fails with the file's name.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readAudioHeader } from "../../src/server/audio-header.js";
import { FIXTURE_RECORDINGS } from "../support/golden.js";

const NAME = "walks/broken take.wav";

/** @param {string} file */
const fixture = (file) => readFile(join(FIXTURE_RECORDINGS, file));

/**
 * A copy of `bytes` with `edit` applied.
 * @param {Buffer} bytes
 * @param {(copy: Buffer) => void} edit
 */
const edited = (bytes, edit) => {
  const copy = Buffer.from(bytes);
  edit(copy);
  return copy;
};

/** Offsets in the fixtures as ffmpeg wrote them: a 16-byte WAV `fmt ` chunk at 12. */
const WAV = Object.freeze({ fmtSize: 16, channels: 22 });
/** The AIFF's `COMM` chunk follows the 12-byte FORM header. */
const AIFF = Object.freeze({ commSize: 16, channels: 20 });
/** FLAC's STREAMINFO: the channel bits sit in byte 20 of the file. */
const FLAC_CHANNELS = 20;

describe("readAudioHeader", () => {
  test("reads each fixture's shape", async () => {
    expect(readAudioHeader(await fixture("noise-tone.wav"), NAME)).toEqual({
      format: "wav",
      channels: 2,
      sampleRate: 44100,
      frames: 88200,
    });
    expect(readAudioHeader(await fixture("tones.aiff"), NAME)).toEqual({
      format: "aiff",
      channels: 2,
      sampleRate: 44100,
      frames: 44100,
    });
    expect(readAudioHeader(await fixture("brown-mono.flac"), NAME)).toEqual({
      format: "flac",
      channels: 1,
      sampleRate: 44100,
      frames: 44100,
    });
  });

  test.each(["noise-tone.wav", "tones.aiff", "brown-mono.flac"])(
    "a truncated %s fails naming the file",
    async (file) => {
      const bytes = await fixture(file);
      // Cut inside the header; past it, a header alone can't tell the file is short.
      for (const length of [4, 12, 20, 25]) {
        expect(() => readAudioHeader(bytes.subarray(0, length), NAME)).toThrow(
          new RegExp(`^${NAME}: can't read|^${NAME} isn't`),
        );
      }
    },
  );

  test("a chunk size that runs past the file fails naming the file", async () => {
    const wav = edited(await fixture("noise-tone.wav"), (b) =>
      b.writeUInt32LE(0xfffffff0, WAV.fmtSize),
    );
    expect(() => readAudioHeader(wav, NAME)).toThrow(`${NAME}: can't read`);
    const aiff = edited(await fixture("tones.aiff"), (b) =>
      b.writeUInt32BE(0xfffffff0, AIFF.commSize),
    );
    expect(() => readAudioHeader(aiff, NAME)).toThrow(`${NAME}: can't read`);
  });

  test("zero channels fails naming the file", async () => {
    const wav = edited(await fixture("noise-tone.wav"), (b) => b.writeUInt16LE(0, WAV.channels));
    expect(() => readAudioHeader(wav, NAME)).toThrow(`${NAME}: can't read its channels`);
    const aiff = edited(await fixture("tones.aiff"), (b) => b.writeUInt16BE(0, AIFF.channels));
    expect(() => readAudioHeader(aiff, NAME)).toThrow(`${NAME}: can't read its channels`);
    // FLAC stores channels − 1, so a zero sample rate stands in: its 20 rate bits cleared.
    const flac = edited(await fixture("brown-mono.flac"), (b) => {
      b[18] = 0;
      b[19] = 0;
      b[FLAC_CHANNELS] = (b[FLAC_CHANNELS] ?? 0) & 0x0f;
    });
    expect(() => readAudioHeader(flac, NAME)).toThrow(`${NAME}: can't read its channels`);
  });
});

// The recordings index (decision 0029) over a temp folder holding copies of the synthetic
// fixtures, so the test can add, change and hide files.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { indexRecordings } from "../../src/server/recording-index.js";
import { sha256Hex } from "../../src/server/sha256-hex.js";
import { FIXTURE_RECORDINGS } from "../support/golden.js";

/** @type {string} */
let folder;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "recordings-"));
  await mkdir(join(folder, "walks"));
  await copyFile(join(FIXTURE_RECORDINGS, "noise-tone.wav"), join(folder, "walks/noise-tone.wav"));
  await copyFile(join(FIXTURE_RECORDINGS, "brown-mono.flac"), join(folder, "Brown.FLAC"));
  await copyFile(join(FIXTURE_RECORDINGS, "tones.aiff"), join(folder, "tones.aif"));
});
afterEach(async () => {
  await rm(folder, { recursive: true });
});

/** @param {string} name */
const hashOf = async (name) => sha256Hex(await readFile(join(FIXTURE_RECORDINGS, name)));

describe("indexRecordings", () => {
  test("lists every WAV, FLAC and AIFF file with its hash and its header's shape", async () => {
    await writeFile(join(folder, "notes.txt"), "not audio");
    await mkdir(join(folder, ".hidden"));
    await copyFile(join(FIXTURE_RECORDINGS, "tones.aiff"), join(folder, ".hidden/tones.aiff"));
    await copyFile(join(FIXTURE_RECORDINGS, "tones.aiff"), join(folder, "._tones.aiff"));
    const index = await indexRecordings(folder);
    expect(index.map(({ size, mtimeMs, ...rest }) => rest)).toEqual([
      {
        file: "Brown.FLAC",
        hash: await hashOf("brown-mono.flac"),
        duration: 1,
        channels: 1,
        sampleRate: 44100,
        path: join(folder, "Brown.FLAC"),
      },
      {
        file: "tones.aif",
        hash: await hashOf("tones.aiff"),
        duration: 1,
        channels: 2,
        sampleRate: 44100,
        path: join(folder, "tones.aif"),
      },
      {
        file: join("walks", "noise-tone.wav"),
        hash: await hashOf("noise-tone.wav"),
        duration: 2,
        channels: 2,
        sampleRate: 44100,
        path: join(folder, "walks/noise-tone.wav"),
      },
    ]);
  });

  test("keeps an unchanged file's entry without reading it, and reads a changed one", async () => {
    const first = await indexRecordings(folder);
    const brown = join(folder, "Brown.FLAC");
    // An entry with a made-up hash shows whether the file was read again.
    const marked = first.map((e) => (e.path === brown ? { ...e, hash: "0".repeat(64) } : e));
    expect((await indexRecordings(folder, marked)).find((e) => e.path === brown)?.hash).toBe(
      "0".repeat(64),
    );
    await copyFile(join(FIXTURE_RECORDINGS, "noise-tone.wav"), brown);
    const again = await indexRecordings(folder, marked);
    expect(again.find((e) => e.path === brown)).toMatchObject({
      hash: await hashOf("noise-tone.wav"),
      channels: 2,
      duration: 2,
    });
  });

  test("fails naming a file whose header it can't read", async () => {
    await writeFile(join(folder, "broken.wav"), "RIFF....WAVEjunk");
    await expect(indexRecordings(folder)).rejects.toThrow(/broken\.wav: can't read its channels/);
    await writeFile(join(folder, "broken.wav"), "plain text");
    await expect(indexRecordings(folder)).rejects.toThrow(/broken\.wav isn't a WAV, AIFF or FLAC/);
  });
});

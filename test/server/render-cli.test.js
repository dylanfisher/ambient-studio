// The render CLI (decision 0017): its argument parser, and runs on 3 s of the drone golden genome
// into temp folders.
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parseRenderArgs, renderCli } from "../../src/server/render-cli.js";
import { FIXTURE_RECORDINGS } from "../support/golden.js";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const genomePath = join(root, "src/engine/genomes/drone.json");
const recordingGenomePath = join(root, "src/engine/genomes/field-recording.json");

/** @type {string} */
let tmp;
beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "render-cli-"));
});
afterAll(async () => {
  await rm(tmp, { recursive: true });
});

describe("parseRenderArgs", () => {
  test("reads a genome render", () => {
    expect(
      parseRenderArgs(["g.json", "--seed", "7", "--duration", "30", "--out", "o", "--offset", "5"]),
    ).toEqual({
      genomePath: "g.json",
      seed: 7,
      duration: 30,
      offset: 5,
      flac: true,
      outDir: "o",
    });
    expect(parseRenderArgs(["g.json", "--seed=1", "--duration=3", "--out=o", "--no-flac"])).toEqual(
      { genomePath: "g.json", seed: 1, duration: 3, offset: 0, flac: false, outDir: "o" },
    );
  });

  test("reads a re-render", () => {
    expect(parseRenderArgs(["--from", "e.json", "--out", "o"])).toEqual({
      sidecarPath: "e.json",
      outDir: "o",
    });
  });

  test("reads the recordings folder in either form", () => {
    expect(parseRenderArgs(["--from", "e.json", "--out", "o", "--recordings", "r"])).toEqual({
      sidecarPath: "e.json",
      outDir: "o",
      recordingsDir: "r",
    });
    expect(
      parseRenderArgs(["g.json", "--seed=1", "--duration=3", "--out=o", "--recordings=r"]),
    ).toMatchObject({ genomePath: "g.json", recordingsDir: "r" });
  });

  test.each([
    [["g.json", "--seed", "1", "--duration", "3"], /--out is required/],
    [["--from", "e.json"], /--out is required/],
    [["g.json", "--seed", "abc", "--duration", "3", "--out", "o"], /--seed must be.*"abc"/],
    [["g.json", "--seed", "1.5", "--duration", "3", "--out", "o"], /--seed must be.*"1.5"/],
    [["g.json", "--seed", "", "--duration", "3", "--out", "o"], /--seed must be/],
    [
      ["g.json", "--seed", "1", "--duration", "3", "--out", "o", "--loud"],
      /unknown option '--loud'/i,
    ],
    [["g.json", "--seed", "1", "--duration", "x", "--out", "o"], /--duration must be.*"x"/],
    [["g.json", "--seed", "1", "--duration", "3", "--offset", "-1", "--out", "o"], /--offset/],
    [["g.json", "--duration", "3", "--out", "o"], /--seed is required/],
    [["g.json", "--seed", "1", "--out", "o"], /--duration is required/],
    [["--seed", "1", "--duration", "3", "--out", "o"], /one genome file/],
    [["a.json", "b.json", "--seed", "1", "--duration", "3", "--out", "o"], /one genome file/],
    [["--from", "e.json", "--seed", "1", "--out", "o"], /--from takes only --out/],
    [["g.json", "--from", "e.json", "--out", "o"], /--from takes only --out/],
  ])("rejects %j with a message", (argv, message) => {
    expect(() => parseRenderArgs(argv)).toThrow(message);
  });
});

describe("renderCli", () => {
  /** @type {string[]} */
  const printed = [];
  /** @type {Awaited<ReturnType<typeof renderCli>>} */
  let exported;
  const outDir = () => join(tmp, "first");

  beforeAll(async () => {
    exported = await renderCli(
      [genomePath, "--seed", "1", "--duration", "3", "--out", outDir()],
      (line) => printed.push(line),
    );
  });

  test("writes the WAV, the FLAC and the sidecar, and prints their paths and loudness", async () => {
    const { wav, flac, json } = exported.paths;
    expect((await readdir(outDir())).sort()).toEqual(
      [flac, json, wav].map((path) => path?.slice(outDir().length + 1)).sort(),
    );
    const text = printed.join("\n");
    for (const path of [wav, flac, json]) expect(text).toContain(path);
    expect(text).toMatch(/-?\d+\.\d\d LUFS/);
    expect(text).toMatch(/-?\d+\.\d\d dBTP/);
  });

  test("--from re-renders the export into another folder", async () => {
    const again = join(tmp, "again");
    const rerendered = await renderCli(["--from", exported.paths.json, "--out", again], () => {});
    expect(rerendered.sidecar.pcmSha256).toBe(exported.sidecar.pcmSha256);
    expect((await readdir(again)).length).toBe(3);
  });

  test("a genome that plays field recordings exports and re-renders through --from with --recordings", async () => {
    const dir = join(tmp, "recordings");
    const recordings = ["--recordings", FIXTURE_RECORDINGS];
    const made = await renderCli(
      [recordingGenomePath, "--seed", "2", "--duration", "3", "--out", dir, ...recordings],
      () => {},
    );
    expect(made.sidecar.recordings).toEqual({
      "810ab2357cb6dd62882afd92502fc013609b1bb326a5ff50873513b125fb0d3f": "brown-mono.flac",
      d5b8145b3639bd1c0891315ece68c9ec5fa0e23924e485d94467ac0fbed4faa5: "noise-tone.wav",
    });
    const from = ["--from", made.paths.json];
    const again = await renderCli(
      [...from, "--out", join(tmp, "recordings-again"), ...recordings],
      () => {},
    );
    expect(again.sidecar.pcmSha256).toBe(made.sidecar.pcmSha256);
    // Without the folder, and from a folder missing a file, it fails naming the file.
    await expect(renderCli([...from, "--out", join(tmp, "r3")], () => {})).rejects.toThrow(
      /no recordings folder was given/,
    );
    const partial = join(tmp, "partial");
    await mkdir(partial);
    await copyFile(join(FIXTURE_RECORDINGS, "brown-mono.flac"), join(partial, "brown-mono.flac"));
    await expect(
      renderCli([...from, "--out", join(tmp, "r4"), "--recordings", partial], () => {}),
    ).rejects.toThrow(/recording noise-tone\.wav \(sha256 d5b8145b/);
  });

  test("--no-flac writes only the WAV and the sidecar", async () => {
    const dir = join(tmp, "no-flac");
    const { paths } = await renderCli(
      [genomePath, "--seed", "1", "--duration", "3", "--out", dir, "--no-flac"],
      () => {},
    );
    expect((await readdir(dir)).sort()).toEqual(
      [paths.json, paths.wav].map((path) => path.slice(dir.length + 1)).sort(),
    );
    const sidecar = JSON.parse(await readFile(paths.json, "utf8"));
    expect(sidecar.files).toEqual({ wav: paths.wav.slice(dir.length + 1) });
  });

  test("./scripts/render exits 2 and prints the usage on a bad argument", async () => {
    const failed = run(join(root, "scripts/render"), [genomePath, "--seed", "x", "--out", tmp]);
    await expect(failed).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringMatching(/--seed must be[\s\S]*usage:/),
    });
  });
});

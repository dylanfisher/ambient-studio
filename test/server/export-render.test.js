// Exports 3 s of the drone golden genome into temp folders. One export is shared by the tests
// that only read it, to keep the gate light.
/** @import { Export } from "../../src/server/export-render.js" */
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import { SCHEMA_VERSION } from "../../src/engine/genome-schema.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { SAMPLE_RATE } from "../../src/engine/render-plan.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { exportRender, rerender } from "../../src/server/export-render.js";
import { genomeHash } from "../../src/server/genome-hash.js";

const WAV_HEADER_BYTES = 44;
const TARGET = -16;
const options = { seed: 1, duration: 3, offset: 0, target: TARGET };

/** @type {string} */
let root;
/** @type {Export} */
let first;
/** @type {string} */
let firstDir;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "export-render-"));
  firstDir = join(root, "first");
  first = await exportRender(droneGenome, { ...options, outDir: firstDir });
});
afterAll(async () => {
  await rm(root, { recursive: true });
});

/** @param {string} name */
const freshDir = (name) => mkdtemp(join(root, `${name}-`));

/**
 * Writes a copy of the first export's sidecar with `change` applied, and returns its path.
 * @param {string} dir
 * @param {Record<string, unknown>} change
 */
async function editedSidecar(dir, change) {
  const sidecar = JSON.parse(await readFile(first.paths.json, "utf8"));
  const path = join(dir, "edited.json");
  await writeFile(path, JSON.stringify({ ...sidecar, ...change }));
  return path;
}

describe("exportRender", () => {
  test("writes a WAV, a FLAC and a sidecar JSON that names the other two", async () => {
    const { paths, sidecar } = first;
    expect((await readdir(firstDir)).sort()).toEqual(
      [paths.flac, paths.json, paths.wav].map((path) => path.slice(firstDir.length + 1)).sort(),
    );
    const written = JSON.parse(await readFile(paths.json, "utf8"));
    expect(written).toEqual(sidecar);
    expect(join(firstDir, written.files.wav)).toBe(paths.wav);
    expect(join(firstDir, written.files.flac)).toBe(paths.flac);
    expect(paths.wav).toMatch(/\.wav$/);
    expect(paths.flac).toMatch(/\.flac$/);
  });

  test("records the render, the versions and the measured loudness", () => {
    const { sidecar } = first;
    const genome = requireGenome(droneGenome, "drone");
    expect(sidecar).toMatchObject({
      genome,
      seed: 1,
      duration: 3,
      offset: 0,
      engineVersion: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      sampleRate: SAMPLE_RATE,
      node: process.version,
      genomeHash: genomeHash(droneGenome),
    });
    expect(sidecar.nodeWebAudioApi).toMatch(/^\d+\.\d+\.\d+$/);
    expect(sidecar.loudness.target).toBe(TARGET);
    expect(Math.abs(sidecar.loudness.integrated - TARGET)).toBeLessThanOrEqual(0.5);
    expect(sidecar.loudness.truePeak).toBeLessThanOrEqual(genome.ceiling);
    expect(Number.isFinite(sidecar.loudness.gainDb)).toBe(true);
  });

  test("the sidecar's PCM hash is the SHA-256 of the WAV's samples", async () => {
    const wav = await readFile(first.paths.wav);
    expect(wav.readUInt32LE(40)).toBe(3 * SAMPLE_RATE * 2 * 3);
    const hash = createHash("sha256").update(wav.subarray(WAV_HEADER_BYTES)).digest("hex");
    expect(first.sidecar.pcmSha256).toBe(hash);
  });

  test("writes only inside outDir, however the path is spelled", async () => {
    const outDir = join(root, "spelled", "..", "inside");
    const { paths } = await exportRender(droneGenome, { ...options, duration: 1, outDir });
    for (const path of Object.values(paths)) expect(dirname(path)).toBe(resolve(outDir));
  });

  test("refuses to overwrite an existing export, leaving its files as they were", async () => {
    const before = await Promise.all(Object.values(first.paths).map((p) => readFile(p)));
    await expect(exportRender(droneGenome, { ...options, outDir: firstDir })).rejects.toThrow(
      /already exists/,
    );
    const after = await Promise.all(Object.values(first.paths).map((p) => readFile(p)));
    expect(after).toEqual(before);
  });

  test("throws without a loudness target", async () => {
    const outDir = await freshDir("no-target");
    await expect(
      exportRender(droneGenome, { seed: 1, duration: 1, offset: 0, outDir, target: Number.NaN }),
    ).rejects.toThrow(/target/);
    expect(await readdir(outDir)).toEqual([]);
  });
});

describe("exportRender on a render that isn't finite", () => {
  afterEach(() => {
    vi.doUnmock("../../src/server/render-offline.js");
    vi.resetModules();
  });

  test.for([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("throws on %s, naming the channel and frame, and writes nothing", async ([, value]) => {
    vi.resetModules();
    vi.doMock("../../src/server/render-offline.js", () => ({
      renderOffline: async () => {
        const channels = [0, 1].map(() => new Float32Array(SAMPLE_RATE).fill(0.1));
        /** @type {Float32Array} */ (channels[1])[777] = /** @type {number} */ (value);
        return { channels, sampleRate: SAMPLE_RATE, engineVersion: ENGINE_VERSION };
      },
    }));
    const mocked = await import("../../src/server/export-render.js");
    const outDir = await freshDir("not-finite");
    await expect(
      mocked.exportRender(droneGenome, { ...options, duration: 1, outDir }),
    ).rejects.toThrow(new RegExp(`${value}.*channel 1, frame 777`));
    expect(await readdir(outDir)).toEqual([]);
  });
});

describe("exportRender when writing fails", () => {
  afterEach(() => {
    vi.doUnmock("../../src/server/write-flac.js");
    vi.resetModules();
  });

  /** Loads exportRender with a flac step that leaves a partial file and then fails. */
  async function withFailingFlac() {
    vi.resetModules();
    vi.doMock("../../src/server/write-flac.js", () => ({
      writeFlac: async (/** @type {string} */ _wav, /** @type {string} */ flac) => {
        await writeFile(flac, "partial");
        throw new Error("flac exited with code 1");
      },
    }));
    return (await import("../../src/server/export-render.js")).exportRender;
  }

  test("removes the files and folders it created and rethrows the original error", async () => {
    const exportWithFailure = await withFailingFlac();
    const parent = await freshDir("fails-new");
    const outDir = join(parent, "new", "deeper");
    await expect(
      exportWithFailure(droneGenome, { ...options, duration: 1, outDir }),
    ).rejects.toThrow("flac exited with code 1");
    expect(await readdir(parent)).toEqual([]);
  });

  test("leaves files it didn't create in an existing folder", async () => {
    const exportWithFailure = await withFailingFlac();
    const outDir = await freshDir("fails-existing");
    await writeFile(join(outDir, "other.txt"), "kept");
    await expect(
      exportWithFailure(droneGenome, { ...options, duration: 1, outDir }),
    ).rejects.toThrow("flac exited with code 1");
    expect(await readdir(outDir)).toEqual(["other.txt"]);
  });
});

describe("rerender", () => {
  test("reproduces an export's PCM hash from its sidecar", async () => {
    const outDir = await freshDir("again");
    const again = await rerender(first.paths.json, outDir);
    expect(again.sidecar).toEqual(first.sidecar);
    const wav = await readFile(again.paths.wav);
    expect(Buffer.compare(wav, await readFile(first.paths.wav))).toBe(0);
  });

  test("fails on an older engine version's sidecar, naming both versions", async () => {
    const outDir = await freshDir("older");
    const path = await editedSidecar(outDir, { engineVersion: ENGINE_VERSION - 1 });
    await expect(rerender(path, outDir)).rejects.toThrow(
      new RegExp(
        `engine version ${ENGINE_VERSION - 1}.*this is engine version ${ENGINE_VERSION}`,
        "s",
      ),
    );
    expect(await readdir(outDir)).toEqual(["edited.json"]);
  });

  test("fails when the samples differ, says which versions differ, and writes nothing", async () => {
    const outDir = await freshDir("differs");
    const path = await editedSidecar(outDir, { pcmSha256: "0".repeat(64), node: "v1.0.0" });
    const error = await rerender(path, outDir).then(
      () => undefined,
      (e) => e,
    );
    expect(String(error)).toMatch(/doesn't reproduce/);
    expect(String(error)).toMatch(/Node is v1\.0\.0 in the sidecar/);
    expect(String(error)).toMatch(new RegExp(`same engine version, ${ENGINE_VERSION}`));
    expect(String(error)).not.toMatch(/node-web-audio-api is/);
    expect(await readdir(outDir)).toEqual(["edited.json"]);
  });

  test("fails on a sidecar whose genome hash doesn't match its genome", async () => {
    const outDir = await freshDir("hash");
    const path = await editedSidecar(outDir, { genomeHash: "0".repeat(64) });
    await expect(rerender(path, outDir)).rejects.toThrow(/genome hash/);
  });

  test("refuses a sidecar whose fields aren't the right types, before writing anything", async () => {
    const outDir = await freshDir("types");
    const path = await editedSidecar(outDir, { seed: "../../escape" });
    await expect(rerender(path, outDir)).rejects.toThrow(/seed/);
    expect(await readdir(outDir)).toEqual(["edited.json"]);
    expect(await readdir(dirname(root))).not.toContain("escape.wav");
  });
});

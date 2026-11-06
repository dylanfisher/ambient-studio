// The golden-render test (decision 0009): each genome in src/engine/genomes/ renders a window at
// its start and one at its end, quantized to 24-bit, and must hash as the current engine
// version's entry says. Renders are 2 s each to keep the gate light.
/** @import { GoldenEntry, GoldenWindow } from "../support/golden.js" */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import {
  addEntry,
  checkGolden,
  currentEnvironment,
  GOLDEN_DIR,
  GOLDEN_MACHINE,
  goldenGenomes,
  goldenPath,
  goldenRenders,
  readGolden,
  renderRaw,
  writeGoldens,
} from "../support/golden.js";

const env = currentEnvironment();
const goldens = goldenGenomes();

/** @type {Map<string, Promise<Float32Array[]>>} */
const rendered = new Map();
/**
 * Renders each golden window once per file, so the tests that change a sample reuse it.
 * @param {unknown} genome
 * @param {GoldenWindow} window
 */
function cachedRaw(genome, window) {
  const name = goldens.find((g) => g.genome === genome)?.name;
  const key = `${name}/${window.name}`;
  let channels = rendered.get(key);
  if (!channels) {
    channels = renderRaw(genome, window);
    rendered.set(key, channels);
  }
  return channels;
}

const drone = /** @type {(typeof goldens)[number]} */ (goldens.find((g) => g.name === "drone"));
const dronePath = goldenPath(GOLDEN_DIR, ENGINE_VERSION, "drone");

describe("golden renders", () => {
  test("cover the drone and the master bus", () => {
    expect(goldens.map((g) => g.name)).toEqual(expect.arrayContaining(["drone", "master-bus"]));
  });

  test.for(goldens)(
    `$name matches engine version ${ENGINE_VERSION}'s raw hashes`,
    async ({ name, genome }, ctx) => {
      const path = goldenPath(GOLDEN_DIR, ENGINE_VERSION, name);
      const verdict = checkGolden({
        name,
        path,
        file: readGolden(path),
        kind: "raw",
        env,
        renders: await goldenRenders(genome, cachedRaw),
      });
      if (verdict.status === "skip") ctx.skip(verdict.message);
      expect(verdict.status, verdict.message).toBe("pass");
    },
  );

  test("a changed sample fails, printing the summaries and saying to bump ENGINE_VERSION", async () => {
    // One step of 24-bit in one sample of the end window.
    /** @type {(genome: unknown, window: GoldenWindow) => Promise<Float32Array[]>} */
    const nudged = async (genome, window) => {
      const channels = (await cachedRaw(genome, window)).map((c) => c.slice());
      const left = /** @type {Float32Array} */ (channels[0]);
      if (window.name === "end") left[1000] = /** @type {number} */ (left[1000]) + 2 ** -23;
      return channels;
    };
    const verdict = checkGolden({
      name: "drone",
      path: dronePath,
      file: readGolden(dronePath),
      kind: "raw",
      env,
      renders: await goldenRenders(drone.genome, nudged),
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.message).toMatch(/bump ENGINE_VERSION/);
    expect(verdict.message).toMatch(/end/);
    expect(verdict.message).not.toMatch(/\bstart\b/);
    expect(verdict.message).toMatch(/peak .* rms .* bands/s);
  });

  test("a missing platform entry fails naming the platform", async () => {
    const verdict = checkGolden({
      name: "drone",
      path: dronePath,
      file: readGolden(dronePath),
      kind: "raw",
      env: { ...env, platform: "linux-x64" },
      renders: await goldenRenders(drone.genome, cachedRaw),
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.message).toMatch(/linux-x64/);
  });

  test("another machine's mismatch says so instead of failing as a changed render", async () => {
    /** @type {(genome: unknown, window: GoldenWindow) => Promise<Float32Array[]>} */
    const silent = async (_, window) => [0, 1].map(() => new Float32Array(window.duration * 48000));
    const verdict = checkGolden({
      name: "drone",
      path: dronePath,
      file: readGolden(dronePath),
      kind: "raw",
      env: { ...env, cpu: "Another Chip" },
      renders: await goldenRenders(drone.genome, silent),
    });
    expect(verdict.status).toBe("skip");
    expect(verdict.message).toMatch(/Another Chip/);
    expect(verdict.message).toMatch(/only mbp2021's entries count/);
    expect(verdict.message).not.toMatch(/bump ENGINE_VERSION/);
  });

  test("a version with no hash file fails naming the writer script", async () => {
    const path = goldenPath(GOLDEN_DIR, ENGINE_VERSION + 1, "drone");
    const verdict = checkGolden({
      name: "drone",
      path,
      file: readGolden(path),
      kind: "raw",
      env,
      renders: await goldenRenders(drone.genome, cachedRaw),
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.message).toMatch(/scripts\/write-golden\.js/);
  });
});

describe("the hash writer", () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "golden-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /**
   * A render of constant `value`, so the writer runs without audio.
   * @param {number} value
   * @returns {(genome: unknown, window: GoldenWindow) => Promise<Float32Array[]>}
   */
  const constant = (value) => async (_, window) =>
    [0, 1].map(() => new Float32Array(window.duration * 48000).fill(value));
  const machine = { ...env, ...GOLDEN_MACHINE };

  test("writes each golden's entry with the platform, versions and summaries", async () => {
    const { written } = await writeGoldens({
      dir,
      version: 3,
      kind: "raw",
      env: machine,
      render: constant(0.25),
    });
    expect(written).toEqual(goldens.map((g) => goldenPath(dir, 3, g.name)));
    const file = readGolden(goldenPath(dir, 3, "drone"));
    expect(file).toMatchObject({ genome: "drone", engineVersion: 3 });
    const entry = file?.hashes.raw?.[GOLDEN_MACHINE.platform];
    expect(entry).toMatchObject({
      cpu: GOLDEN_MACHINE.cpu,
      node: machine.node,
      nodeWebAudioApi: machine.nodeWebAudioApi,
    });
    expect(entry?.renders.start?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry?.renders.end?.summary.peak).toBeCloseTo(-12.04, 2);
  });

  test("refuses to overwrite an existing version's entry", async () => {
    await writeGoldens({ dir, version: 3, kind: "raw", env: machine, render: constant(0.25) });
    const path = goldenPath(dir, 3, "drone");
    const before = readFileSync(path, "utf8");
    const again = await writeGoldens({
      dir,
      version: 3,
      kind: "raw",
      env: machine,
      render: constant(0.5),
    });
    expect(again.written).toEqual([]);
    expect(again.kept).toContain(path);
    expect(readFileSync(path, "utf8")).toBe(before);

    const entry = /** @type {GoldenEntry} */ (
      readGolden(path)?.hashes.raw?.[GOLDEN_MACHINE.platform]
    );
    expect(() =>
      addEntry(path, { genome: "drone", version: 3, kind: "raw", platform: "darwin-arm64" }, entry),
    ).toThrow(/refuses to overwrite/);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("refuses to write on another machine", async () => {
    await expect(
      writeGoldens({
        dir,
        version: 3,
        kind: "raw",
        env: { ...machine, cpu: "Another Chip" },
        render: constant(0.25),
      }),
    ).rejects.toThrow(/only mbp2021/);
  });
});

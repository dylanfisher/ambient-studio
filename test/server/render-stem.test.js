// A track's stems (decision 0063): one per voice id, each the track's mix with every section
// limited to that voice, scaled by the mix's gain, never limited, and written as a 32-bit float
// WAV whose data the hash it reports covers. Together they sum to the mix before its limiter
// (acceptance 5). Sections are seconds long.
/** @import { TrackPlan } from "../../src/server/mix-track.js" */
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { ENGINE_VERSION } from "../../src/engine/engine-version.js";
import droneGenome from "../../src/engine/genomes/drone.json" with { type: "json" };
import { SAMPLE_RATE } from "../../src/engine/render-plan.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { mixTrack } from "../../src/server/mix-track.js";
import { renderStem } from "../../src/server/render-stem.js";
import { sha256Hex } from "../../src/server/sha256-hex.js";
import { stemIds } from "../../src/server/stem-voices.js";
import { FLOAT32, headerBytes } from "../../src/server/wav-writer.js";
import { difference, EXCERPT_BELOW_DB, EXCERPT_PEAK } from "../support/compare-renders.js";

const unfaded = { ...droneGenome, fadeIn: 0, fadeOut: 0 };
/** The drone with a second, higher drone, which only the first section plays. */
const pair = requireGenome(
  {
    ...unfaded,
    voices: [
      ...unfaded.voices,
      { id: "high", type: "drone", root: 55, partials: 5, level: -14, detune: 7 },
    ],
  },
  "two drones",
);

/** Two sections of 4 s and 5 s with a 2 s crossfade and the track's own fades: 7 s. */
/** @type {TrackPlan} */
const plan = {
  sections: [
    { genome: pair, seed: 1, offset: 6, duration: 4 },
    { genome: requireGenome({ ...unfaded, key: 5 }, "drone"), seed: 2, offset: 20, duration: 5 },
  ],
  transitions: [2],
  fades: { fadeIn: 1, fadeOut: 1 },
};
const CHUNK = 2;
const FRAMES = 7 * SAMPLE_RATE;
/** Where the first section, the only one with "high", ends on the track. */
const FIRST_END = 4 * SAMPLE_RATE;

/** @type {string} */
let root;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "render-stem-"));
});
afterEach(async () => {
  await rm(root, { recursive: true });
});

/**
 * The whole of a mix, joined.
 * @param {AsyncIterable<Float32Array[]>} blocks
 */
async function joined(blocks) {
  const out = [0, 1].map(() => new Float32Array(FRAMES));
  let at = 0;
  for await (const block of blocks) {
    for (const [c, channel] of block.entries()) out[c]?.set(channel, at);
    at += block[0]?.length ?? 0;
  }
  expect(at).toBe(FRAMES);
  return out;
}

/**
 * A float WAV's samples, by channel, and its data chunk.
 * @param {string} path
 */
async function readStem(path) {
  const data = (await readFile(path)).subarray(headerBytes(FLOAT32));
  const floats = new Float32Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.length),
  );
  const channels = [0, 1].map((c) =>
    Float32Array.from({ length: floats.length / 2 }, (_, i) => floats[i * 2 + c] ?? 0),
  );
  return { channels, data };
}

/**
 * Renders the stem of `voice` at `gainDb` into the temp folder.
 * @param {string} voice
 * @param {number} gainDb
 */
async function stem(voice, gainDb) {
  const path = join(root, `${voice}.wav`);
  const done = await renderStem(plan, voice, { gainDb, path, chunkSeconds: CHUNK });
  return { ...done, ...(await readStem(path)) };
}

test("a track's stems are its voice ids, and they sum to the mix before the limiter", async () => {
  expect(stemIds(plan.sections)).toEqual(["drone", "high"]);
  const gainDb = 3.5;
  const gain = 10 ** (gainDb / 20);
  const stems = [await stem("drone", gainDb), await stem("high", gainDb)];
  const mix = await joined(mixTrack(plan, { chunkSeconds: CHUNK }));
  const scaled = mix.map((channel) => channel.map((x) => x * gain));
  const sum = [0, 1].map((c) =>
    Float32Array.from(
      { length: FRAMES },
      (_, i) => (stems[0]?.channels[c]?.[i] ?? 0) + (stems[1]?.channels[c]?.[i] ?? 0),
    ),
  );
  const { peak, belowDb } = difference(
    { channels: sum, sampleRate: SAMPLE_RATE, engineVersion: ENGINE_VERSION },
    { channels: scaled, sampleRate: SAMPLE_RATE, engineVersion: ENGINE_VERSION },
  );
  expect(peak).toBeLessThan(EXCERPT_PEAK);
  expect(belowDb).toBeGreaterThan(EXCERPT_BELOW_DB);
  for (const { sha256, frames, data } of stems) {
    expect(frames).toBe(FRAMES);
    expect(sha256).toBe(sha256Hex(data));
  }
});

test("a voice id only one section has is silent everywhere else", async () => {
  const { channels } = await stem("high", 0);
  for (const channel of channels) {
    expect(channel.subarray(FIRST_END).every((x) => x === 0)).toBe(true);
    expect(channel.subarray(0, FIRST_END).some((x) => x !== 0)).toBe(true);
  }
});

test("a stem sample past full scale is kept, not clipped or limited", async () => {
  const gainDb = 30;
  const { channels } = await stem("drone", gainDb);
  const solo = await joined(mixTrack(plan, { chunkSeconds: CHUNK, voices: () => ["drone"] }));
  let loudest = 0;
  for (const channel of channels) for (const x of channel) loudest = Math.max(loudest, Math.abs(x));
  expect(loudest).toBeGreaterThan(1);
  const gain = 10 ** (gainDb / 20);
  for (const [c, channel] of channels.entries()) {
    expect(channel).toEqual(/** @type {Float32Array} */ (solo[c]).map((x) => x * gain));
  }
});

test("cancel stops at the next chunk and removes the partial stem", async () => {
  const controller = new AbortController();
  /** @type {string[]} */
  const steps = [];
  const path = join(root, "drone.wav");
  const run = renderStem(plan, "drone", {
    gainDb: 0,
    path,
    chunkSeconds: CHUNK,
    signal: controller.signal,
    progress: (_done, _total, step) => {
      if (step) steps.push(step);
      if (steps.length === 2) controller.abort(new Error("cancelled"));
    },
  });
  await expect(run).rejects.toThrow("cancelled");
  expect(steps).toHaveLength(2);
  expect(existsSync(path)).toBe(false);
  expect(await readdir(root)).toEqual([]);
});

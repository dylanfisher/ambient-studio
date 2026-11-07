// The golden-render harness (decision 0009), shared by test/engine/golden.test.js and
// scripts/write-golden.js. Every genome in src/engine/genomes/ is a golden: it renders a window
// at its start and one at its end, each quantized to interleaved 24-bit PCM and hashed. The
// expected hashes live in test/fixtures/golden/v<N>/<name>.json, one file per golden per engine
// version, keyed by the kind of render and the platform. "raw" is the render quantized to
// 24-bit; "normalized" is the PCM `exportRender` writes, after normalization and limiting.
/** @import { RecordingEntry } from "../../src/server/recording-index.js" */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fft } from "../../src/domain/fft.js";
import { SAMPLE_RATE } from "../../src/engine/render-plan.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { encodePcm24, FULL_SCALE, PCM24_BYTES } from "../../src/server/encode-pcm24.js";
import { exportRender } from "../../src/server/export-render.js";
import { loadSamples } from "../../src/server/load-samples.js";
import { indexRecordings } from "../../src/server/recording-index.js";
import { renderOffline } from "../../src/server/render-offline.js";
import { rendererVersions } from "../../src/server/renderer-versions.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const GENOME_DIR = join(root, "src/engine/genomes");
export const GOLDEN_DIR = join(root, "test/fixtures/golden");
const WRITER = "scripts/write-golden.js";

/** The machine whose entries count: mbp2021. Only it writes them. */
export const GOLDEN_MACHINE = Object.freeze({ platform: "darwin-arm64", cpu: "Apple M1 Max" });

const SEED = 1;
/** Seconds each golden window renders. */
const WINDOW_SECONDS = 2;
/** Upper edges of the summary's 8 bands, in Hz; the last runs to Nyquist. */
const BAND_EDGES = [63, 125, 250, 500, 1000, 2000, 4000, SAMPLE_RATE / 2];
const FFT_SIZE = 4096;

/**
 * @typedef {object} Environment
 * @property {string} platform `process.platform` and `process.arch`, as in "darwin-arm64"
 * @property {string} cpu the CPU model
 * @property {string} node the Node version
 * @property {string} nodeWebAudioApi the node-web-audio-api version
 */

/**
 * @typedef {object} GoldenWindow
 * @property {string} name "start" or "end"
 * @property {number} seed
 * @property {number} offset timeline seconds
 * @property {number} duration seconds
 */

/**
 * Coarse figures that a failure prints to show which part of the sound moved; they never pass
 * or fail anything. Levels in dBFS, `null` for silence.
 * @typedef {object} Summary
 * @property {number | null} peak
 * @property {number | null} rms
 * @property {(number | null)[]} bands mean power in each of 8 bands, up to 63, 125, 250, 500,
 *   1000, 2000 and 4000 Hz and Nyquist
 */

/**
 * @typedef {object} RenderHash
 * @property {number} seed
 * @property {number} offset
 * @property {number} duration
 * @property {string} sha256 of the interleaved 24-bit PCM
 * @property {Summary} summary
 */

/**
 * @typedef {object} GoldenEntry
 * @property {string} cpu
 * @property {string} node
 * @property {string} nodeWebAudioApi
 * @property {Record<string, RenderHash>} renders by window name
 */

/**
 * @typedef {object} GoldenFile
 * @property {string} genome
 * @property {number} engineVersion
 * @property {Record<string, Record<string, GoldenEntry>>} hashes by kind, then platform
 */

/** @typedef {(genome: unknown, window: GoldenWindow) => Promise<Float32Array[]>} GoldenRender */

/** @returns {Environment} */
export function currentEnvironment() {
  return {
    platform: `${process.platform}-${process.arch}`,
    cpu: cpus()[0]?.model ?? "unknown",
    ...rendererVersions(),
  };
}

/** @returns {{ name: string; genome: unknown }[]} every genome in src/engine/genomes/, by name */
export function goldenGenomes() {
  return readdirSync(GENOME_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({
      name: basename(file, ".json"),
      genome: JSON.parse(readFileSync(join(GENOME_DIR, file), "utf8")),
    }));
}

/**
 * The windows a golden renders. Raw: its first and last 2 s, which take in both fades.
 * Normalized: only the first 2 s, since the last sits deep in the fade-out, more than
 * normalize's 40 dB gain cap under the target.
 * @param {unknown} genome
 * @param {string} kind "raw" or "normalized"
 * @returns {GoldenWindow[]}
 */
function goldenWindows(genome, kind) {
  const { duration } = requireGenome(genome, "a golden genome");
  const start = { name: "start", seed: SEED, offset: 0, duration: WINDOW_SECONDS };
  if (kind === "normalized") return [start];
  if (kind !== "raw") throw new Error(`no golden kind "${kind}"; there are raw and normalized`);
  return [
    start,
    { name: "end", seed: SEED, offset: duration - WINDOW_SECONDS, duration: WINDOW_SECONDS },
  ];
}

/**
 * The synthetic recordings the golden genomes' recording voices name (decision 0029), made from
 * noise and tones with ffmpeg at 44.1 kHz, so every golden of the voice runs the resampler.
 */
export const FIXTURE_RECORDINGS = join(root, "test/fixtures/recordings");

/** @type {Promise<RecordingEntry[]> | undefined} */
let fixtureIndex;
/** The fixture folder's index, read once a process. */
const fixtureRecordings = () => {
  fixtureIndex ??= indexRecordings(FIXTURE_RECORDINGS);
  return fixtureIndex;
};

/** @type {GoldenRender} */
export async function renderRaw(genome, { seed, offset, duration }) {
  const normalized = requireGenome(genome, "a golden genome");
  const { samples } = await loadSamples(normalized, await fixtureRecordings());
  const result = await renderOffline(normalized, { seed, offset, duration, samples });
  return result.channels;
}

/** Bytes of the plain PCM header `writeWav` writes before the samples. */
const WAV_HEADER_BYTES = 44;

/**
 * The samples of a WAV that `writeWav` wrote, back as floats. Each 24-bit value v becomes
 * v / 2^23, which `encodePcm24` maps back to v, so hashing these hashes the file's PCM.
 * @param {Buffer} wav
 * @returns {Float32Array[]}
 */
function decodeWav(wav) {
  const channelCount = wav.readUInt16LE(22);
  const pcm = wav.subarray(WAV_HEADER_BYTES, WAV_HEADER_BYTES + wav.readUInt32LE(40));
  const frames = pcm.length / (channelCount * PCM24_BYTES);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (const [c, channel] of channels.entries()) {
      channel[i] = pcm.readIntLE((i * channelCount + c) * PCM24_BYTES, PCM24_BYTES) / FULL_SCALE;
    }
  }
  return channels;
}

/**
 * Exports the window through `exportRender` to the genome's own loudness target, into a temp
 * folder, and returns the WAV's samples.
 * @type {GoldenRender}
 */
export async function renderNormalized(genome, { seed, offset, duration }) {
  const normalized = requireGenome(genome, "a golden genome");
  const outDir = await mkdtemp(join(tmpdir(), "golden-export-"));
  try {
    const { paths } = await exportRender(normalized, {
      seed,
      offset,
      duration,
      target: normalized.loudness,
      outDir,
      recordings: await fixtureRecordings(),
    });
    return decodeWav(await readFile(paths.wav));
  } finally {
    await rm(outDir, { recursive: true });
  }
}

/** @param {number} power */
const db = (power) => (power > 0 ? Math.round(1000 * Math.log10(power)) / 100 : null);

/**
 * Peak, RMS and the power in 8 bands, from Hann-windowed 4096-sample blocks of each channel.
 * @param {Float32Array[]} channels
 * @returns {Summary}
 */
function summarize(channels) {
  let peak = 0;
  let sum = 0;
  let count = 0;
  const bands = new Float64Array(BAND_EDGES.length);
  let blocks = 0;
  const hann = Float64Array.from(
    { length: FFT_SIZE },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE),
  );
  // Parseval with the window's energy, so a band's figure is its mean power.
  const scale = 1 / (FFT_SIZE * hann.reduce((a, w) => a + w * w, 0));
  for (const data of channels) {
    for (const x of data) {
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
      count++;
    }
    for (let start = 0; start + FFT_SIZE <= data.length; start += FFT_SIZE) {
      const re = Float64Array.from(
        { length: FFT_SIZE },
        (_, i) => /** @type {number} */ (data[start + i]) * /** @type {number} */ (hann[i]),
      );
      const im = new Float64Array(FFT_SIZE);
      fft(re, im);
      for (let k = 0; k <= FFT_SIZE / 2; k++) {
        const hz = (k * SAMPLE_RATE) / FFT_SIZE;
        const band = BAND_EDGES.findIndex((edge) => hz <= edge);
        // Bins other than DC and Nyquist stand for their mirror image too.
        const both = k === 0 || k === FFT_SIZE / 2 ? 1 : 2;
        const power = /** @type {number} */ (re[k]) ** 2 + /** @type {number} */ (im[k]) ** 2;
        bands[band] = /** @type {number} */ (bands[band]) + both * power * scale;
      }
      blocks++;
    }
  }
  return {
    peak: db(peak * peak),
    rms: db(sum / count),
    bands: Array.from(bands, (power) => db(power / blocks)),
  };
}

/**
 * Renders each of the golden's windows of `kind` with `render` and hashes it.
 * @param {unknown} genome
 * @param {GoldenRender} render
 * @param {string} kind
 * @returns {Promise<Record<string, RenderHash>>}
 */
export async function goldenRenders(genome, render, kind) {
  /** @type {Record<string, RenderHash>} */
  const renders = {};
  for (const window of goldenWindows(genome, kind)) {
    const { name, ...where } = window;
    const channels = await render(genome, window);
    const sha256 = createHash("sha256").update(encodePcm24(channels)).digest("hex");
    renders[name] = { ...where, sha256, summary: summarize(channels) };
  }
  return renders;
}

/**
 * @param {string} dir
 * @param {number} version
 * @param {string} name
 */
export const goldenPath = (dir, version, name) => join(dir, `v${version}`, `${name}.json`);

/**
 * @param {string} path
 * @returns {GoldenFile | undefined} undefined when there is no file
 */
export function readGolden(path) {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8"));
}

/** @param {Summary} s */
const showSummary = (s) =>
  `peak ${s.peak} rms ${s.rms} bands [${s.bands.map((b) => b ?? "-").join(", ")}]`;

/**
 * @typedef {object} Verdict
 * @property {"pass" | "fail" | "skip"} status "skip" when another machine renders differently
 * @property {string} message
 */

/**
 * Compares a golden's renders with the entry for this platform in its hash file.
 * @param {{ name: string; path: string; file: GoldenFile | undefined; kind: string;
 *   env: Environment; renders: Record<string, RenderHash> }} golden
 * @returns {Verdict}
 */
export function checkGolden({ name, path, file, kind, env, renders }) {
  if (!file) {
    return {
      status: "fail",
      message: `${name}: no hash file at ${path}. On mbp2021, run ${WRITER} to write this engine version's entries.`,
    };
  }
  const entry = file.hashes[kind]?.[env.platform];
  if (!entry) {
    return {
      status: "fail",
      message: `${name}: ${path} has no ${kind} entry for platform ${env.platform}. Only mbp2021 (${GOLDEN_MACHINE.platform}) has golden entries.`,
    };
  }
  const changed = Object.entries(renders).flatMap(([window, actual]) => {
    const expected = entry.renders[window];
    if (expected?.sha256 === actual.sha256) return [];
    return [
      `  ${window} window (${actual.offset}–${actual.offset + actual.duration} s, seed ${actual.seed}):`,
      `    entry: ${expected ? showSummary(expected.summary) : "none"}`,
      `    now:   ${showSummary(actual.summary)}`,
    ];
  });
  if (changed.length === 0) return { status: "pass", message: `${name}: every window matches` };
  const summaries = changed.join("\n");
  if (env.cpu !== entry.cpu) {
    return {
      status: "skip",
      message: `${name} renders differently on ${env.cpu} than on the entry's ${entry.cpu}; only mbp2021's entries count, so this is not a changed render.\n${summaries}`,
    };
  }
  const versions = [
    env.node !== entry.node && `Node is ${env.node} here and ${entry.node} in the entry`,
    env.nodeWebAudioApi !== entry.nodeWebAudioApi &&
      `node-web-audio-api is ${env.nodeWebAudioApi} here and ${entry.nodeWebAudioApi} in the entry`,
  ].filter(Boolean);
  const why =
    versions.length > 0
      ? `${versions.join("; ")}. Go back to the entry's versions, or `
      : "If the change is meant, ";
  return {
    status: "fail",
    message: `${name}: the ${kind} render no longer matches engine version ${file.engineVersion}'s entry in ${path}.\n${summaries}\n${why}bump ENGINE_VERSION in src/engine/engine-version.js and run ${WRITER} on mbp2021.`,
  };
}

/**
 * Adds an entry to a hash file, creating the file if needed. Throws when the entry exists: an
 * entry is never overwritten, so the only way past a changed hash is a new engine version.
 * @param {string} path
 * @param {{ genome: string; version: number; kind: string; platform: string }} key
 * @param {GoldenEntry} entry
 */
export function addEntry(path, { genome, version, kind, platform }, entry) {
  /** @type {GoldenFile} */
  const file = readGolden(path) ?? { genome, engineVersion: version, hashes: {} };
  if (file.hashes[kind]?.[platform]) {
    throw new Error(
      `${path} already has a ${kind} entry for ${platform}; the writer refuses to overwrite it. Bump ENGINE_VERSION to record a changed render.`,
    );
  }
  file.hashes[kind] = { ...file.hashes[kind], [platform]: entry };
  mkdirSync(dirname(path), { recursive: true });
  // Arrays of numbers on one line, as the formatter writes them.
  const text = JSON.stringify(file, null, 2).replace(/\[[-\d.,\snul]+\]/g, (array) =>
    array.replace(/\s+/g, "").replaceAll(",", ", "),
  );
  writeFileSync(path, `${text}\n`);
}

/**
 * Writes the entry of `kind` for every golden whose hash file for `version` lacks one on this
 * platform, and leaves existing entries alone. Throws on any machine but mbp2021.
 * @param {{ dir: string; version: number; kind: string; env: Environment;
 *   render: GoldenRender }} options
 * @returns {Promise<{ written: string[]; kept: string[] }>} hash file paths
 */
export async function writeGoldens({ dir, version, kind, env, render }) {
  if (env.platform !== GOLDEN_MACHINE.platform || env.cpu !== GOLDEN_MACHINE.cpu) {
    throw new Error(
      `this is ${env.cpu} on ${env.platform}; only mbp2021 (${GOLDEN_MACHINE.cpu} on ${GOLDEN_MACHINE.platform}) writes golden entries`,
    );
  }
  /** @type {{ written: string[]; kept: string[] }} */
  const result = { written: [], kept: [] };
  for (const { name, genome } of goldenGenomes()) {
    const path = goldenPath(dir, version, name);
    if (readGolden(path)?.hashes[kind]?.[env.platform]) {
      result.kept.push(path);
      continue;
    }
    const { cpu, node, nodeWebAudioApi, platform } = env;
    const renders = await goldenRenders(genome, render, kind);
    const entry = { cpu, node, nodeWebAudioApi, renders };
    addEntry(path, { genome: name, version, kind, platform }, entry);
    result.written.push(path);
  }
  return result;
}

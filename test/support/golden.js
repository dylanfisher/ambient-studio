// The golden-render harness (decision 0009), shared by test/engine/golden.test.js and
// scripts/write-golden.js. Every genome in src/engine/genomes/ is a golden: it renders a window
// at its start and one at its end, each quantized to interleaved 24-bit PCM and hashed. The
// expected hashes live in test/fixtures/golden/v<N>/<name>.json, one file per golden per engine
// version, keyed by the kind of render ("raw" here; step 1l adds the normalized exports) and
// the platform.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SAMPLE_RATE } from "../../src/engine/render-plan.js";
import { requireGenome } from "../../src/engine/validate-genome.js";
import { encodePcm24 } from "../../src/server/encode-pcm24.js";
import { renderOffline } from "./render-offline.js";

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
  const pkg = join(root, "node_modules/node-web-audio-api/package.json");
  return {
    platform: `${process.platform}-${process.arch}`,
    cpu: cpus()[0]?.model ?? "unknown",
    node: process.version,
    nodeWebAudioApi: JSON.parse(readFileSync(pkg, "utf8")).version,
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
 * The windows a golden renders: its first and last 2 s, which take in both fades.
 * @param {unknown} genome
 * @returns {GoldenWindow[]}
 */
function goldenWindows(genome) {
  const { duration } = requireGenome(genome, "a golden genome");
  return [
    { name: "start", seed: SEED, offset: 0, duration: WINDOW_SECONDS },
    { name: "end", seed: SEED, offset: duration - WINDOW_SECONDS, duration: WINDOW_SECONDS },
  ];
}

/** @type {GoldenRender} */
export async function renderRaw(genome, { seed, offset, duration }) {
  const result = await renderOffline(requireGenome(genome, "a golden genome"), {
    seed,
    offset,
    duration,
  });
  return result.channels;
}

/**
 * In-place radix-2 FFT of `re` and `im`, whose length is a power of 2.
 * @param {Float64Array} re
 * @param {Float64Array} im
 */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [/** @type {number} */ (re[j]), /** @type {number} */ (re[i])];
      [im[i], im[j]] = [/** @type {number} */ (im[j]), /** @type {number} */ (im[i])];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const c = Math.cos(step * k);
        const s = Math.sin(step * k);
        const br = /** @type {number} */ (re[b]);
        const bi = /** @type {number} */ (im[b]);
        const tr = br * c - bi * s;
        const ti = br * s + bi * c;
        re[b] = /** @type {number} */ (re[a]) - tr;
        im[b] = /** @type {number} */ (im[a]) - ti;
        re[a] = /** @type {number} */ (re[a]) + tr;
        im[a] = /** @type {number} */ (im[a]) + ti;
      }
    }
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
 * Renders each of the golden's windows with `render` and hashes it.
 * @param {unknown} genome
 * @param {GoldenRender} render
 * @returns {Promise<Record<string, RenderHash>>}
 */
export async function goldenRenders(genome, render) {
  /** @type {Record<string, RenderHash>} */
  const renders = {};
  for (const window of goldenWindows(genome)) {
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
    const renders = await goldenRenders(genome, render);
    const entry = { cpu, node, nodeWebAudioApi, renders };
    addEntry(path, { genome: name, version, kind, platform }, entry);
    result.written.push(path);
  }
  return result;
}

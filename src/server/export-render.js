// Export: render offline, normalize, and write a WAV, a FLAC and the sidecar JSON that
// re-renders them (decisions 0009, 0011, 0012, 0015).
/** @import { Genome } from "../engine/genome-schema.js" */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { normalize } from "../domain/normalize.js";
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { SCHEMA_VERSION } from "../engine/genome-schema.js";
import { isObject } from "../engine/is-object.js";
import { requireGenome } from "../engine/validate-genome.js";
import { encodePcm24 } from "./encode-pcm24.js";
import { genomeHash } from "./genome-hash.js";
import { renderOffline } from "./render-offline.js";
import { rendererVersions } from "./renderer-versions.js";
import { sha256Hex } from "./sha256-hex.js";
import { writeFlac } from "./write-flac.js";
import { writeWav } from "./write-wav.js";

/** Hex characters of the genome hash that start an export's file names. */
const NAME_HASH_CHARS = 12;

/**
 * @typedef {object} ExportOptions
 * @property {number} seed
 * @property {number} duration seconds
 * @property {number} [offset] timeline seconds, 0 when omitted
 * @property {number} target integrated loudness in LUFS; the caller passes the vibe's or the
 *   genome's, so there is no default
 * @property {string} outDir created when missing
 */

/**
 * @typedef {object} ExportLoudness
 * @property {number} target LUFS
 * @property {number} integrated measured after normalizing, LUFS
 * @property {number} truePeak measured after limiting, dBTP
 * @property {number} gainDb the gain applied before the limiter
 */

/**
 * The sidecar JSON, written beside the audio.
 * @typedef {object} Sidecar
 * @property {{ wav: string; flac: string }} files names in the sidecar's own folder
 * @property {string} genomeHash
 * @property {string} pcmSha256 of the interleaved 24-bit PCM in the WAV's data chunk
 * @property {number} seed
 * @property {number} duration
 * @property {number} offset
 * @property {ExportLoudness} loudness
 * @property {number} engineVersion
 * @property {number} schemaVersion
 * @property {number} sampleRate
 * @property {string} node
 * @property {string} nodeWebAudioApi
 * @property {Genome} genome normalized
 */

/**
 * @typedef {object} Export
 * @property {Sidecar} sidecar
 * @property {{ wav: string; flac: string; json: string }} paths absolute
 */

/**
 * @typedef {object} PreparedExport
 * @property {Sidecar} sidecar
 * @property {Export["paths"]} paths
 * @property {Uint8Array} pcm
 * @property {number} channelCount
 */

/**
 * The three files' paths, which must not exist yet. Checked before rendering, so a long render
 * isn't wasted on a name that's taken.
 * @param {string} outDir
 * @param {string} name
 * @returns {Export["paths"]}
 */
function outputPaths(outDir, name) {
  const dir = resolve(outDir);
  const paths = {
    wav: join(dir, `${name}.wav`),
    flac: join(dir, `${name}.flac`),
    json: join(dir, `${name}.json`),
  };
  for (const path of Object.values(paths)) {
    if (dirname(path) !== dir) throw new Error(`export file ${path} would land outside ${dir}`);
    if (existsSync(path)) throw new Error(`${path} already exists; an export never overwrites`);
  }
  return paths;
}

/** @param {Float32Array[]} channels */
function requireFinite(channels) {
  for (const [c, channel] of channels.entries()) {
    const frame = channel.findIndex((x) => !Number.isFinite(x));
    if (frame !== -1) {
      throw new Error(
        `the render holds ${channel[frame]} at channel ${c}, frame ${frame}; nothing was exported`,
      );
    }
  }
}

/**
 * Renders, normalizes and encodes, and builds the sidecar, without writing anything.
 * @param {unknown} genome
 * @param {ExportOptions} options
 * @returns {Promise<PreparedExport>}
 */
async function prepareExport(genome, { seed, duration, offset = 0, target, outDir }) {
  const normalized = requireGenome(genome, "exportRender: invalid genome");
  if (typeof seed !== "number") {
    throw new TypeError(`exportRender: seed must be a number, got ${JSON.stringify(seed)}`);
  }
  // normalize checks this too, but only after the render.
  if (!Number.isFinite(target)) {
    throw new Error(`exportRender needs a loudness target in LUFS, got ${target}`);
  }
  const hash = genomeHash(normalized);
  const name = `${hash.slice(0, NAME_HASH_CHARS)}-seed${seed}-${offset}s-${duration}s`;
  const paths = outputPaths(outDir, name);

  const rendered = await renderOffline(normalized, { seed, duration, offset });
  requireFinite(rendered.channels);
  const result = normalize(rendered.channels, rendered.sampleRate, {
    target,
    ceiling: normalized.ceiling,
  });
  const pcm = encodePcm24(result.channels);
  return {
    paths,
    pcm,
    channelCount: result.channels.length,
    sidecar: {
      files: { wav: `${name}.wav`, flac: `${name}.flac` },
      genomeHash: hash,
      pcmSha256: sha256Hex(pcm),
      seed,
      duration,
      offset,
      loudness: {
        target,
        integrated: result.loudness,
        truePeak: result.truePeak,
        gainDb: result.gainDb,
      },
      engineVersion: rendered.engineVersion,
      schemaVersion: SCHEMA_VERSION,
      sampleRate: rendered.sampleRate,
      ...rendererVersions(),
      genome: normalized,
    },
  };
}

/**
 * Writes the WAV, then the FLAC from it, then the sidecar. Each refuses to overwrite.
 * @param {PreparedExport} prepared
 * @returns {Promise<Export>}
 */
async function writeExport({ sidecar, paths, pcm, channelCount }) {
  const dir = dirname(paths.wav);
  // The outermost folder mkdir made, if any; it and the folders inside it down to `dir` are
  // this call's.
  const madeDir = await mkdir(dir, { recursive: true });
  /** @type {[string, () => Promise<void>][]} */
  const steps = [
    [paths.wav, () => writeWav(paths.wav, pcm, { channelCount, sampleRate: sidecar.sampleRate })],
    [paths.flac, () => writeFlac(paths.wav, paths.flac)],
    [
      paths.json,
      () => writeFile(paths.json, `${JSON.stringify(sidecar, null, 2)}\n`, { flag: "wx" }),
    ],
  ];
  /** @type {string[]} */
  const created = [];
  try {
    for (const [path, write] of steps) {
      // outputPaths checked each path is free, so whatever is there after the step is this
      // call's, even when the step fails partway.
      try {
        await write();
      } finally {
        if (existsSync(path)) created.push(path);
      }
    }
  } catch (error) {
    try {
      await Promise.all(created.map((path) => rm(path)));
      // rmdir, not rm: it refuses a folder something else has written into since.
      for (let at = dir; madeDir && at.startsWith(madeDir); at = dirname(at)) await rmdir(at);
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "export failed, and so did removing its files");
    }
    throw error;
  }
  return { sidecar, paths };
}

/**
 * Renders `duration` seconds of `genome` from `offset`, normalizes it to `target` under the
 * genome's true-peak ceiling, and writes `<name>.wav`, `<name>.flac` and `<name>.json` to
 * `outDir`. Throws on a render sample that isn't finite, and on a file that already exists.
 * @param {unknown} genome
 * @param {ExportOptions} options
 * @returns {Promise<Export>}
 */
export async function exportRender(genome, options) {
  return writeExport(await prepareExport(genome, options));
}

/** Each sidecar field `rerender` reads, and its type. */
const SIDECAR_FIELDS = Object.freeze({
  genomeHash: "string",
  pcmSha256: "string",
  seed: "number",
  duration: "number",
  offset: "number",
  engineVersion: "number",
  node: "string",
  nodeWebAudioApi: "string",
});

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {Sidecar}
 */
function requireSidecar(value, path) {
  if (!isObject(value)) throw new Error(`${path} isn't a sidecar: it holds no JSON object`);
  for (const [field, type] of Object.entries(SIDECAR_FIELDS)) {
    if (typeof value[field] !== type) {
      throw new Error(`${path}: ${field} must be a ${type}, got ${JSON.stringify(value[field])}`);
    }
  }
  if (!isObject(value.loudness) || typeof value.loudness.target !== "number") {
    throw new Error(`${path}: loudness.target must be a number`);
  }
  return /** @type {Sidecar} */ (/** @type {unknown} */ (value));
}

/**
 * @param {Sidecar} recorded
 * @returns {string[]} one line per renderer version that differs from this run's
 */
function rendererDifferences(recorded) {
  const here = rendererVersions();
  return [
    recorded.node !== here.node && `Node is ${recorded.node} in the sidecar and ${here.node} here`,
    recorded.nodeWebAudioApi !== here.nodeWebAudioApi &&
      `node-web-audio-api is ${recorded.nodeWebAudioApi} in the sidecar and ${here.nodeWebAudioApi} here`,
  ].filter((line) => typeof line === "string");
}

/**
 * Re-exports from a sidecar into `outDir` and writes the files only when the new PCM hash
 * matches the recorded one. Throws, writing nothing, on a sidecar from another engine version
 * or when the samples differ, naming which versions differ.
 * @param {string} sidecarPath
 * @param {string} outDir
 * @returns {Promise<Export>}
 */
export async function rerender(sidecarPath, outDir) {
  const recorded = requireSidecar(JSON.parse(await readFile(sidecarPath, "utf8")), sidecarPath);
  if (recorded.engineVersion !== ENGINE_VERSION) {
    const others = rendererDifferences(recorded).map((line) => `; ${line}`);
    throw new Error(
      `${sidecarPath} was rendered by engine version ${recorded.engineVersion}, and this is engine version ${ENGINE_VERSION}${others.join("")}. Re-render it from a worktree at tag engine-v${recorded.engineVersion}.`,
    );
  }
  const actualHash = genomeHash(recorded.genome);
  if (actualHash !== recorded.genomeHash) {
    throw new Error(
      `${sidecarPath}: its genome hash ${recorded.genomeHash} doesn't match its genome's, ${actualHash}; the file was changed after export`,
    );
  }
  const { seed, duration, offset, loudness } = recorded;
  const prepared = await prepareExport(recorded.genome, {
    seed,
    duration,
    offset,
    target: loudness.target,
    outDir,
  });
  const { pcmSha256 } = prepared.sidecar;
  if (pcmSha256 !== recorded.pcmSha256) {
    const differences = rendererDifferences(recorded);
    const why =
      differences.length > 0
        ? `${differences.join("; ")}. Going back to the sidecar's versions may reproduce it.`
        : "Node and node-web-audio-api match too, so the engine changed without a version bump.";
    throw new Error(
      `re-rendering ${sidecarPath} doesn't reproduce it: the PCM hashes to ${pcmSha256}, the sidecar says ${recorded.pcmSha256}. Both are the same engine version, ${ENGINE_VERSION}. ${why}`,
    );
  }
  return writeExport(prepared);
}

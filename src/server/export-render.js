// Export: render offline, normalize, and write a WAV, a FLAC and the sidecar JSON that
// re-renders them (decisions 0009, 0011, 0012, 0015).
/** @import { Genome } from "../engine/genome-schema.js" */
import { lstatSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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
 * @property {boolean} [flac] writes the FLAC too; true when omitted
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
 * @property {{ wav: string; flac?: string }} files names in the sidecar's own folder; no
 *   `flac` when the export skipped it
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
 * @property {{ wav: string; flac?: string; json: string }} paths absolute
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
 * @param {boolean} flac
 * @returns {Export["paths"]}
 */
function outputPaths(outDir, name, flac) {
  const dir = resolve(outDir);
  const paths = {
    wav: join(dir, `${name}.wav`),
    ...(flac && { flac: join(dir, `${name}.flac`) }),
    json: join(dir, `${name}.json`),
  };
  for (const path of Object.values(paths)) {
    if (dirname(path) !== dir) throw new Error(`export file ${path} would land outside ${dir}`);
    // lstat, not exists: a dangling link is taken too, and a write would follow it.
    if (lstatSync(path, { throwIfNoEntry: false })) {
      throw new Error(`${path} already exists; an export never overwrites`);
    }
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
async function prepareExport(genome, { seed, duration, offset = 0, target, outDir, flac = true }) {
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
  const paths = outputPaths(outDir, name, flac);

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
      files: { wav: `${name}.wav`, ...(flac && { flac: `${name}.flac` }) },
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
 * Writes the WAV, the FLAC from it unless the export skips it, and the sidecar into a new temp
 * folder inside the output folder, then hard-links each to its name there. `link` fails rather than replace any entry,
 * a link included, so a name taken during the render is never overwritten or followed. On a
 * failure, removes the names this call linked, the temp folder and any folders it made, and
 * rethrows.
 * @param {PreparedExport} prepared
 * @returns {Promise<Export>}
 */
async function writeExport({ sidecar, paths, pcm, channelCount }) {
  const dir = dirname(paths.wav);
  // The outermost folder mkdir made, if any; it and the folders inside it down to `dir` are
  // this call's.
  const madeDir = await mkdir(dir, { recursive: true });
  const temp = await mkdtemp(join(dir, ".export-"));
  /** @param {string} path */
  const staged = (path) => join(temp, basename(path));
  /** @type {string[]} */
  const linked = [];
  try {
    await writeWav(staged(paths.wav), pcm, { channelCount, sampleRate: sidecar.sampleRate });
    const { flac } = paths;
    if (flac !== undefined) await writeFlac(staged(paths.wav), staged(flac));
    const text = `${JSON.stringify(sidecar, null, 2)}\n`;
    await writeFile(staged(paths.json), text, { flag: "wx" });
    for (const path of [paths.wav, flac, paths.json]) {
      if (path === undefined) continue;
      try {
        await link(staged(path), path);
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") throw error;
        throw new Error(`${path} appeared during the export; an export never overwrites`, {
          cause: error,
        });
      }
      linked.push(path);
    }
    await rm(temp, { recursive: true });
  } catch (error) {
    try {
      await Promise.all(linked.map((path) => unlink(path)));
      await rm(temp, { recursive: true, force: true });
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
 * genome's true-peak ceiling, and writes `<name>.wav`, `<name>.flac` (unless `flac` is false)
 * and `<name>.json` to `outDir`. Throws on a render sample that isn't finite, and on a file that already exists.
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
 * or when the samples differ, naming which versions differ. Writes the FLAC whether or not the
 * export did.
 * @param {string} sidecarPath
 * @param {string} outDir
 * @returns {Promise<Export>}
 */
export async function rerender(sidecarPath, outDir) {
  const text = await readFile(sidecarPath, "utf8");
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${sidecarPath} isn't a sidecar: it isn't valid JSON`, { cause: error });
  }
  const recorded = requireSidecar(parsed, sidecarPath);
  if (recorded.engineVersion !== ENGINE_VERSION) {
    const others = rendererDifferences(recorded).map((line) => `; ${line}`);
    throw new Error(
      `${sidecarPath} was rendered by engine version ${recorded.engineVersion}, and this is engine version ${ENGINE_VERSION}${others.join("")}. Re-render it from a worktree at tag engine-v${recorded.engineVersion}.`,
    );
  }
  const actualHash = genomeHash(recorded.genome);
  if (actualHash !== recorded.genomeHash) {
    throw new Error(
      `${sidecarPath}: its genome hash ${recorded.genomeHash} doesn't match its genome's, ${actualHash}. Either the file was changed after export, or the schema's defaults changed since, which a migration should have written into the sidecar's genome`,
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

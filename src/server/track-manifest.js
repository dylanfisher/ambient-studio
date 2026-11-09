// What a track's audio is made from (decision 0062): its recipe, read from the store once, which
// a render, a seam preview and an export share; the cache key it hashes to; and the manifest,
// the recipe with what the render measured, from which `rerenderTrack` renders it again. Built
// like 0015's sidecar: each section's normalized genome with its hash, the seed and window, and
// the engine and renderer versions.
/** @import { Constraints } from "../domain/constraint-schema.js" */
/** @import { TrackCost } from "../domain/track-cost.js" */
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { MeasuredLoudness, TrackLoudness } from "./render-track.js" */
/** @import { TrackPlan } from "./mix-track.js" */
/** @import { RecordingEntry } from "./recording-index.js" */
/** @import { Store } from "./store.js" */
/** @import { Track, TrackRevision } from "./track-store.js" */
import {
  renderedTransition,
  sectionGenome,
  sectionInstances,
  sectionWindow,
} from "../domain/section-genome.js";
import { trackCost } from "../domain/track-cost.js";
import { trackFades } from "../domain/track-fades.js";
import { sortedJson } from "../engine/canonical-genome.js";
import { CHUNK_SECONDS } from "../engine/chunk-windows.js";
import { CROSSFADE_LAW } from "../engine/crossfade.js";
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { SCHEMA_VERSION } from "../engine/genome-schema.js";
import { isObject } from "../engine/is-object.js";
import { LANE_CURVE, LANE_POINTS, LANE_SAMPLE_SECONDS } from "../engine/macro-lane.js";
import { SAMPLE_RATE } from "../engine/render-plan.js";
import { requireGenome } from "../engine/validate-genome.js";
import { getCandidate, getGenome } from "./generation-store.js";
import { genomeHash } from "./genome-hash.js";
import { loadSamples } from "./load-samples.js";
import { getSketch } from "./rating-store.js";
import { vibeLoudness } from "./render-excerpt.js";
import { rendererVersions } from "./renderer-versions.js";
import { sha256Hex } from "./sha256-hex.js";
import { getRevision } from "./vibe-store.js";

/**
 * A section as the manifest records it.
 * @typedef {object} ManifestSection
 * @property {number} sketchId
 * @property {number} candidateId
 * @property {number} seed the candidate's
 * @property {number} offset timeline seconds where the section's render starts: where the
 *   section starts, or a morph's handover into it (`sectionWindow`)
 * @property {number} duration seconds the section renders
 * @property {string} genomeHash of `genome`
 * @property {Genome} genome the section's, from `sectionGenome`, normalized
 * @property {string[]} [instances] a morph's renamed instances in `genome` (0064), when it has any
 */

/**
 * How a lane is written into a section's macro (`src/engine/macro-lane.js`).
 * @typedef {{ sampleSeconds: number, points: number, curve: string }} LaneRule
 */

/**
 * Everything that decides a track's samples, plus the track it came from.
 * @typedef {object} TrackRecipe
 * @property {{ id: number, name: string, revisionId: number }} track
 * @property {ManifestSection[]} sections
 * @property {{ kind: string, seconds: number, morphSeconds?: number, curve?: string }[]} transitions
 *   as the mix renders them (`renderedTransition`): `seconds` is the crossfade, the handover
 *   for a morph or a weave
 * @property {{ fadeIn: number, fadeOut: number }} fades the track's, in seconds
 * @property {number} chunkSeconds
 * @property {string} crossfadeLaw
 * @property {LaneRule} [laneRule] the macro lanes' rule (0065), when a lane has points: the
 *   lanes themselves are in each section's genome
 * @property {TrackLoudness} loudness the vibe's target and the strictest section's ceiling
 * @property {number} engineVersion
 * @property {number} schemaVersion
 * @property {number} sampleRate
 * @property {string} node
 * @property {string} nodeWebAudioApi
 */

/**
 * A stem an export wrote (0063): its voice id, its file in the export's folder and the SHA-256
 * of the float WAV's data chunk.
 * @typedef {object} StemEntry
 * @property {string} voice
 * @property {string} file
 * @property {string} sha256
 */

/**
 * The recipe with what its render measured: the file an export writes beside its audio, with
 * `stems` when the export wrote them.
 * @typedef {TrackRecipe & {
 *   files?: { wav: string, flac: string },
 *   stems?: StemEntry[],
 *   loudness: MeasuredLoudness,
 *   frames: number,
 *   pcmSha256: string,
 *   recordings?: Record<string, string>,
 * }} TrackManifest
 */

/**
 * The sketch's candidate and stored genome, and the vibe it was made for. Throws when a row it
 * names is missing, which the store's foreign keys rule out.
 * @param {Store} store
 * @param {{ id: number, candidateId: number }} sketch
 */
export function sketchParts(store, { id, candidateId }) {
  const candidate = getCandidate(store, candidateId);
  if (!candidate) throw new Error(`sketch ${id} names no candidate ${candidateId}`);
  const revision = getRevision(store, candidate.vibeRevisionId);
  if (!revision) throw new Error(`candidate ${candidateId} names no revision`);
  if (candidate.genomeId === null) throw new Error(`sketch ${id} keeps a candidate with no genome`);
  const genome = getGenome(store, candidate.genomeId)?.genome;
  if (!genome) throw new Error(`candidate ${candidateId} names no genome ${candidate.genomeId}`);
  return {
    candidate,
    genome,
    vibeId: revision.vibeId,
    duration: /** @type {number} */ (genome.duration),
  };
}

/**
 * The revision's recipe and cost. The loudness target is the vibe's current one, as a section's
 * player uses (0061); the ceiling is the lowest any section's genome sets.
 * @param {Store} store
 * @param {{ track: Track, revision: TrackRevision, constraints: Constraints }} from
 * @returns {{ recipe: TrackRecipe, cost: TrackCost }}
 */
export function trackRecipe(store, { track, revision, constraints }) {
  const { arrangement } = revision;
  if (arrangement.sections.length === 0) throw new Error("the track has no sections to render");
  /** @type {Map<number, unknown>} */
  const genomes = new Map();
  /** @type {Map<number, { candidateId: number, seed: number }>} */
  const candidates = new Map();
  for (const { sketchId } of arrangement.sections) {
    const sketch = getSketch(store, sketchId);
    if (!sketch) throw new Error(`there is no sketch ${sketchId}`);
    const { candidate, genome } = sketchParts(store, sketch);
    genomes.set(sketchId, genome);
    candidates.set(sketchId, { candidateId: candidate.id, seed: candidate.seed });
  }
  const sections = arrangement.sections.map((section, index) => {
    const genome = sectionGenome(arrangement, index, genomes);
    const window = sectionWindow(arrangement, index, genomes);
    const instances = sectionInstances(arrangement, index, genomes);
    const { candidateId, seed } = /** @type {{ candidateId: number, seed: number }} */ (
      candidates.get(section.sketchId)
    );
    return {
      sketchId: section.sketchId,
      candidateId,
      seed,
      offset: window.offset,
      duration: window.duration,
      genomeHash: genomeHash(genome),
      genome,
      ...(instances.length > 0 && { instances }),
    };
  });
  return {
    recipe: {
      track: { id: track.id, name: track.name, revisionId: revision.id },
      sections,
      transitions: arrangement.transitions.map((_, index) =>
        renderedTransition(arrangement, index, genomes),
      ),
      fades: trackFades(arrangement, genomes),
      chunkSeconds: CHUNK_SECONDS,
      crossfadeLaw: CROSSFADE_LAW,
      // Named only when a lane has points, so a track with none keeps its recipe and cache key.
      ...(arrangement.lanes.some(({ points }) => points.length > 0) && {
        laneRule: { sampleSeconds: LANE_SAMPLE_SECONDS, points: LANE_POINTS, curve: LANE_CURVE },
      }),
      loudness: {
        target: vibeLoudness(constraints),
        ceiling: Math.min(...sections.map(({ genome }) => genome.ceiling)),
      },
      engineVersion: ENGINE_VERSION,
      schemaVersion: SCHEMA_VERSION,
      sampleRate: SAMPLE_RATE,
      ...rendererVersions(),
    },
    cost: trackCost(arrangement, genomes),
  };
}

/**
 * The hash a render is cached by: every field of the recipe but the track it came from, so two
 * revisions that sound the same share it, and any change to the audio's inputs, the versions
 * included, makes a new one.
 * @param {TrackRecipe | TrackManifest} recipe
 */
export function recipeKey({
  sections,
  transitions,
  fades,
  chunkSeconds,
  crossfadeLaw,
  laneRule,
  loudness,
  engineVersion,
  schemaVersion,
  sampleRate,
  node,
  nodeWebAudioApi,
}) {
  const { target, ceiling } = loudness;
  return sha256Hex(
    sortedJson({
      sections,
      transitions,
      fades,
      chunkSeconds,
      crossfadeLaw,
      ...(laneRule && { laneRule }),
      loudness: { target, ceiling },
      engineVersion,
      schemaVersion,
      sampleRate,
      node,
      nodeWebAudioApi,
    }),
  );
}

/**
 * The mix's plan, with each genome's recordings decoded.
 * @param {TrackRecipe} recipe
 * @param {readonly RecordingEntry[] | undefined} recordings the recordings folder's index
 * @param {Readonly<Record<string, string>>} [names] file names by hash, from a manifest
 * @returns {Promise<{ plan: TrackPlan, files: Record<string, string> }>}
 */
export async function recipePlan({ sections, transitions, fades }, recordings, names) {
  /** @type {Record<string, string>} */
  const files = {};
  const planned = [];
  for (const { genome, seed, offset, duration, instances } of sections) {
    const loaded = await loadSamples(genome, recordings, names);
    Object.assign(files, loaded.files);
    planned.push({
      genome,
      seed,
      offset,
      duration,
      samples: loaded.samples,
      ...(instances && { instances }),
    });
  }
  return {
    plan: { sections: planned, transitions: transitions.map(({ seconds }) => seconds), fades },
    files,
  };
}

/** Each top-level manifest field `rerenderTrack` reads, and its type. */
const MANIFEST_FIELDS = Object.freeze({
  pcmSha256: "string",
  chunkSeconds: "number",
  crossfadeLaw: "string",
  engineVersion: "number",
  node: "string",
  nodeWebAudioApi: "string",
});

/**
 * @param {unknown} value
 * @param {string} name what to call it in an error
 * @returns {TrackManifest}
 */
export function requireManifest(value, name) {
  /** @param {string} why */
  const refuse = (why) => new Error(`${name} isn't a track manifest: ${why}`);
  if (!isObject(value)) throw refuse("it holds no JSON object");
  for (const [field, type] of Object.entries(MANIFEST_FIELDS)) {
    if (typeof value[field] !== type) throw refuse(`${field} must be a ${type}`);
  }
  const { sections, transitions, fades, loudness, recordings } = value;
  /** @param {unknown[]} values */
  const numbers = (...values) => values.every((x) => typeof x === typeof 0);
  if (
    !Array.isArray(sections) ||
    sections.length === 0 ||
    !sections.every(
      (s) =>
        isObject(s) &&
        numbers(s.seed, s.offset, s.duration) &&
        typeof s.genomeHash === typeof "" &&
        isObject(s.genome),
    )
  ) {
    throw refuse("sections must each hold a seed, offset, duration, genomeHash and genome");
  }
  if (!Array.isArray(transitions) || !transitions.every((t) => isObject(t) && numbers(t.seconds))) {
    throw refuse("transitions must each hold seconds");
  }
  if (!isObject(fades) || !numbers(fades.fadeIn, fades.fadeOut)) {
    throw refuse("fades must hold fadeIn and fadeOut");
  }
  if (!isObject(loudness) || !numbers(loudness.target, loudness.ceiling)) {
    throw refuse("loudness must hold target and ceiling");
  }
  if (
    recordings !== undefined &&
    !(isObject(recordings) && Object.values(recordings).every((f) => typeof f === typeof ""))
  ) {
    throw refuse("recordings must map each sha256 to a file name");
  }
  for (const [i, section] of sections.entries()) {
    const genome = requireGenome(section.genome, `${name}: section ${i + 1}'s genome`);
    const actual = genomeHash(genome);
    if (actual !== section.genomeHash) {
      throw new Error(
        `${name}: section ${i + 1}'s genome hash ${section.genomeHash} doesn't match its genome's, ${actual}. Either the file was changed after export, or the schema's defaults changed since`,
      );
    }
  }
  return /** @type {TrackManifest} */ (/** @type {unknown} */ (value));
}

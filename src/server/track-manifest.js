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
import { sectionGenome } from "../domain/section-genome.js";
import { trackCost } from "../domain/track-cost.js";
import { trackFades } from "../domain/track-fades.js";
import { sortedJson } from "../engine/canonical-genome.js";
import { CHUNK_SECONDS } from "../engine/chunk-windows.js";
import { CROSSFADE_LAW } from "../engine/crossfade.js";
import { ENGINE_VERSION } from "../engine/engine-version.js";
import { SCHEMA_VERSION } from "../engine/genome-schema.js";
import { isObject } from "../engine/is-object.js";
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
 * @property {number} offset timeline seconds where the section starts
 * @property {number} duration the section's seconds
 * @property {string} genomeHash of `genome`
 * @property {Genome} genome the section's, from `sectionGenome`, normalized
 */

/**
 * Everything that decides a track's samples, plus the track it came from.
 * @typedef {object} TrackRecipe
 * @property {{ id: number, name: string, revisionId: number }} track
 * @property {ManifestSection[]} sections
 * @property {{ kind: string, seconds: number }[]} transitions
 * @property {{ fadeIn: number, fadeOut: number }} fades the track's, in seconds
 * @property {number} chunkSeconds
 * @property {string} crossfadeLaw
 * @property {TrackLoudness} loudness the vibe's target and the strictest section's ceiling
 * @property {number} engineVersion
 * @property {number} schemaVersion
 * @property {number} sampleRate
 * @property {string} node
 * @property {string} nodeWebAudioApi
 */

/**
 * The recipe with what its render measured: the file an export writes beside its audio.
 * @typedef {TrackRecipe & {
 *   files?: { wav: string, flac: string },
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
    const { candidateId, seed } = /** @type {{ candidateId: number, seed: number }} */ (
      candidates.get(section.sketchId)
    );
    return {
      sketchId: section.sketchId,
      candidateId,
      seed,
      offset: section.offset,
      duration: section.seconds,
      genomeHash: genomeHash(genome),
      genome,
    };
  });
  return {
    recipe: {
      track: { id: track.id, name: track.name, revisionId: revision.id },
      sections,
      transitions: arrangement.transitions.map(({ kind, seconds }) => ({ kind, seconds })),
      fades: trackFades(arrangement, genomes),
      chunkSeconds: CHUNK_SECONDS,
      crossfadeLaw: CROSSFADE_LAW,
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
  for (const { genome, seed, offset, duration } of sections) {
    const loaded = await loadSamples(genome, recordings, names);
    Object.assign(files, loaded.files);
    planned.push({ genome, seed, offset, duration, samples: loaded.samples });
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

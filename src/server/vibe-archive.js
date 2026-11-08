// A brief's map of candidates as the archive route and the fill job read it (decision 0057):
// its axes from `vibe_attachments`, each live valid candidate of its sessions with a current
// excerpt described on them from that excerpt's window, as the owner heard it, and scored by the
// brief's taste model when it has a current one. Derived: rebuilt on every read.
/** @import { Archive, ArchiveAxis, ArchiveEntry } from "../domain/build-archive.js" */
/** @import { Features } from "../domain/extract-features.js" */
/** @import { FeatureRanges } from "../domain/target-schema.js" */
/** @import { Embedder } from "./embed-audio.js" */
/** @import { SourcedItem } from "./fit-job.js" */
/** @import { Candidate } from "./generation-store.js" */
/** @import { App } from "./routing.js" */
/** @import { Store } from "./store.js" */
import { ATTACHMENT_KIND, AXIS_SOURCE } from "../domain/attachment-kind.js";
import { archiveCoverage, axisEnds, buildArchive } from "../domain/build-archive.js";
import { checkTargets } from "../domain/check-targets.js";
import { projection } from "../domain/direction-vector.js";
import { PREFERENCE_STATE } from "../domain/preference-text.js";
import { searchScore } from "../domain/search-score.js";
import { regionSimilarity } from "../domain/steer-terms.js";
import { excerptTerms } from "../domain/training-set.js";
import { requireGenome } from "../engine/validate-genome.js";
import { listAttachments } from "./attachment-store.js";
import { currentExcerpt } from "./candidate-excerpt.js";
import { embedText, readEmbedder } from "./embed-audio.js";
import { findEmbedding, vectorFloats } from "./embedding-store.js";
import { currentRevision } from "./generate-candidates.js";
import { getCandidate, getGenome, listSessionCandidates } from "./generation-store.js";
import { predictScores } from "./predict-scores.js";
import { currentModel } from "./preference-summary.js";
import { REVISE_CONTROL } from "./revise-candidate.js";
import { listSessions } from "./session-store.js";
import { readSteering } from "./vibe-steering.js";

/** The reason a map with too few or too many axes gives. */
export const CHOOSE_AXES =
  "Choose two or three axes for the map on the brief page, under “Axes for the map”.";

/** How far up a candidate's parents its shown intent is looked for. */
const INTENT_DEPTH = 64;

/**
 * One axis as read: its row's details, the names the pages word it by, the CLAP vector a
 * direction or region axis reads with, and why it can't be read, if it can't.
 * @typedef {object} AxisReading
 * @property {number} id the attachment's
 * @property {string} source an `AXIS_SOURCE` value
 * @property {string} [name] the name of a feature or a macro
 * @property {number} [directionId]
 * @property {string | null} [near] a direction's near end
 * @property {string} [far]
 * @property {number} [regionId]
 * @property {string} [label] a region's
 * @property {[number | null, number | null]} ends the owner's; null for the default
 * @property {number} bins
 * @property {Float32Array | null} vector a direction's or region's; null for the others
 * @property {string | null} reason
 */

/**
 * What the map reads with: the axes, the brief's ranges, its model and embedder.
 * @typedef {object} ArchiveContext
 * @property {AxisReading[]} axes oldest first
 * @property {FeatureRanges} ranges the current revision's
 * @property {{ file: string, embedder: Embedder } | null} model the brief's current taste
 *   model, or null when it has none
 * @property {Embedder | null} embedder the sidecar's, when the model or an axis reads sound
 * @property {string | null} reason why the map can't be read at all, or null
 */

/**
 * One excerpt on the map, with what the page shows of it.
 * @typedef {ArchiveEntry & { renderId: number, intent: string | null, ownIntent: boolean }} MapEntry
 */

/** @param {AxisReading} axis */
const readsSound = ({ source }) =>
  source === AXIS_SOURCE.direction || source === AXIS_SOURCE.region;

/**
 * The live, valid candidates of the vibe's sessions, oldest first, one per excerpt: a revision
 * that changed nothing shares its first try's excerpt and is left out. 3h's control revisions
 * are never shown and are left out too.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {Candidate[]}
 */
export const vibeCandidates = (store, vibeId) =>
  listSessions(store, vibeId)
    .flatMap((session) => listSessionCandidates(store, session.id))
    .filter(
      ({ operator, rejectReason, genomeId }) =>
        operator !== REVISE_CONTROL && rejectReason === null && genomeId !== null,
    )
    .sort((a, b) => a.id - b.id);

/**
 * The brief's axes and what reads them, or the reason the map can't be read. Asks the sidecar
 * only when the brief has a model file or an axis on a direction or region.
 * @param {App} app
 * @param {number} vibeId
 * @param {AbortSignal} signal
 * @returns {Promise<ArchiveContext>}
 */
export async function archiveContext(app, vibeId, signal) {
  const { ranges } = currentRevision(app.store, vibeId);
  /** @type {AxisReading[]} */
  const axes = listAttachments(app.store, vibeId, ATTACHMENT_KIND.axis).map((row) => ({
    id: row.id,
    // The store checked the details when it added the row.
    .../** @type {{ source: string, ends: [number | null, number | null], bins: number }} */ (
      row.details
    ),
    ...(row.regionId === null ? {} : { regionId: row.regionId }),
    vector: null,
    reason: null,
  }));
  const context = { axes, ranges, model: null, embedder: null, reason: null };
  if (axes.length < 2 || axes.length > 3) return { ...context, reason: CHOOSE_AXES };
  const found = await currentModel(app, vibeId, signal);
  const model = found.state === PREFERENCE_STATE.fitted ? found : null;
  if (!axes.some(readsSound)) return { ...context, model, embedder: model?.embedder ?? null };
  const embedder = model?.embedder ?? (await readEmbedder(app, { fetch: false, signal }));
  if (typeof embedder === "string") {
    const reason = `It reads the sound analysis, which is off: ${embedder}`;
    for (const axis of axes) if (readsSound(axis)) axis.reason = reason;
    return { ...context, model };
  }
  const steering = await readSteering(app.store, vibeId, {
    producer: embedder.producer,
    embedText: (text, what) => embedText(app, embedder, text, what, signal),
  });
  for (const axis of axes) {
    if (axis.source === AXIS_SOURCE.direction) {
      const found = steering.directions.find(({ id }) => id === axis.directionId);
      if (!found) {
        axis.reason = "Its direction was removed from the brief; choose the axes again.";
        continue;
      }
      Object.assign(axis, { near: found.near, far: found.far, vector: found.vector });
    } else if (axis.source === AXIS_SOURCE.region) {
      const found = steering.regions.find(({ regionId }) => regionId === axis.regionId);
      if (!found) {
        axis.reason =
          "Its region isn't attached to the brief any more; attach it again, or choose the axes again.";
        continue;
      }
      Object.assign(axis, { label: found.label, vector: found.vector });
      if (found.vector === null) axis.reason = `Its region can't be read yet: ${found.reason}.`;
    }
  }
  return { ...context, model, embedder };
}

/**
 * The intent the map shows for a candidate: its own, or its nearest parent's when a nudge or a
 * search point has none.
 * @param {Store} store
 * @param {Candidate} candidate
 * @returns {{ intent: string | null, ownIntent: boolean }}
 */
function shownIntent(store, candidate) {
  /** @type {Candidate | undefined} */
  let at = candidate;
  for (let depth = 0; at && depth < INTENT_DEPTH; depth++) {
    if (at.intent !== null) return { intent: at.intent, ownIntent: at === candidate };
    /** @type {unknown} */
    const parent = at.parentIds[0];
    at = typeof parent === "number" ? getCandidate(store, parent) : undefined;
  }
  return { intent: null, ownIntent: false };
}

/**
 * Each candidate with a current excerpt and a value on every axis, described from its excerpt:
 * features as measured, macros as means over the window, and a direction's or region's value
 * from the excerpt's embedding. One `predict` scores those with an embedding when the brief
 * has a model. `unplaced` counts the candidates left out for want of a value.
 * @param {App} app
 * @param {ArchiveContext} context
 * @param {readonly Candidate[]} candidates
 * @param {AbortSignal} signal
 * @returns {Promise<{ entries: MapEntry[], unplaced: number }>}
 */
export async function archiveEntries(app, context, candidates, signal) {
  const { axes, ranges, model, embedder } = context;
  /** @type {MapEntry[]} */
  const entries = [];
  /** @type {SourcedItem[]} */
  const items = [];
  /** @type {number[]} each item's entry */
  const itemEntries = [];
  /** @type {Set<number>} */
  const renders = new Set();
  let unplaced = 0;
  for (const candidate of candidates) {
    const render = currentExcerpt(app.store, app.paths.renderCache, candidate);
    if (!render || renders.has(render.id)) continue;
    renders.add(render.id);
    const genome = requireGenome(
      getGenome(app.store, render.genomeId)?.genome,
      `genome ${render.genomeId} is invalid`,
    );
    // Features are stored as extractFeatures returned them (decision 0023).
    const features = /** @type {Features} */ (render.features);
    const terms = excerptTerms(genome, features, render.offset, render.duration);
    const source = { ratedAudioId: null, renderId: render.id };
    const row = embedder === null ? undefined : findEmbedding(app.store, source, embedder.producer);
    const embedding = row ? vectorFloats(row.vector) : null;
    const values = axes.map((axis) => {
      if (axis.source === AXIS_SOURCE.feature) return terms.features[String(axis.name)] ?? null;
      if (axis.source === AXIS_SOURCE.macro) {
        return terms.macros[/** @type {keyof typeof terms.macros} */ (axis.name)];
      }
      if (embedding === null || axis.vector === null) return null;
      return axis.source === AXIS_SOURCE.direction
        ? projection(embedding, axis.vector)
        : regionSimilarity(embedding, axis.vector);
    });
    if (!values.every((value) => value !== null && Number.isFinite(value))) {
      unplaced += 1;
      continue;
    }
    if (model !== null && embedding !== null) {
      items.push({ source, ...terms });
      itemEntries.push(entries.length);
    }
    entries.push({
      candidateId: candidate.id,
      createdAt: candidate.createdAt,
      renderId: render.id,
      values: /** @type {number[]} */ (values),
      score: null,
      misses: checkTargets(features, ranges).findings.length,
      ...shownIntent(app.store, candidate),
    });
  }
  if (model !== null && items.length > 0) {
    const { mean, variance } = await predictScores(app, model.file, items, {
      embeddingProducer: model.embedder.producer,
      dimension: model.embedder.dimension,
      signal,
    });
    for (const [i, at] of itemEntries.entries()) {
      /** @type {MapEntry} */ (entries[at]).score = searchScore(
        /** @type {number} */ (mean[i]),
        /** @type {number} */ (variance[i]),
      );
    }
  }
  return { entries, unplaced };
}

/**
 * The axes with their ends: the owner's where given, else a feature's range from the brief,
 * else the 10th and 90th percentiles of the entries' values. Each axis that can't be had gets
 * its reason in `reasons`.
 * @param {ArchiveContext} context
 * @param {readonly ArchiveEntry[]} entries
 * @returns {{ axes: ArchiveAxis[], reasons: (string | null)[] }}
 */
export function heldAxes({ axes, ranges }, entries) {
  /** @type {ArchiveAxis[]} */
  const held = [];
  const reasons = axes.map((axis, i) => {
    if (axis.reason !== null) return axis.reason;
    const range = axis.source === AXIS_SOURCE.feature ? ranges[String(axis.name)] : undefined;
    const [low, high] = axis.ends;
    const ends = axisEnds(
      entries.map(({ values }) => /** @type {number} */ (values[i])),
      [low ?? range?.[0] ?? null, high ?? range?.[1] ?? null],
    );
    if (ends === null) {
      return "Its ends can't be set yet: the brief's excerpts all read the same on it, or it has too few, and no range gives both ends.";
    }
    held.push({ bins: axis.bins, ...ends });
    return null;
  });
  return { axes: held, reasons };
}

/**
 * The map as the page reads it.
 * @param {ArchiveContext} context
 * @param {{ axes: ArchiveAxis[], reasons: (string | null)[] }} held
 * @param {readonly MapEntry[]} entries
 * @param {number} unplaced
 */
function archiveView(context, held, entries, unplaced) {
  const axes = context.axes.map(({ vector, ...axis }, i) => ({
    ...axis,
    low: held.reasons[i] === null ? held.axes[i]?.low : null,
    high: held.reasons[i] === null ? held.axes[i]?.high : null,
    reason: held.reasons[i] ?? null,
  }));
  const base = { model: context.model !== null, axes, placed: entries.length, unplaced };
  const blocked = context.reason ?? held.reasons.find((reason) => reason !== null) ?? null;
  if (blocked !== null) {
    return { ...base, reason: blocked, shape: [], total: 0, filled: 0, coverage: 0, cells: [] };
  }
  /** @type {Archive} */
  const archive = buildArchive(held.axes, entries);
  return {
    ...base,
    reason: null,
    shape: archive.shape,
    total: archive.total,
    filled: archive.cells.length,
    coverage: archiveCoverage(archive),
    cells: archive.cells.map(({ index, count, elite }) => {
      const { candidateId, renderId, intent, ownIntent, score, misses } = /** @type {MapEntry} */ (
        elite
      );
      const url = `/audio/${renderId}`;
      return { index, count, candidateId, renderId, url, intent, ownIntent, score, misses };
    }),
  };
}

/**
 * The brief's map, built from what is stored now.
 * @param {App} app
 * @param {number} vibeId
 * @param {AbortSignal} signal
 */
export async function readArchive(app, vibeId, signal) {
  const context = await archiveContext(app, vibeId, signal);
  if (context.reason !== null) {
    return archiveView(context, { axes: [], reasons: context.axes.map(() => null) }, [], 0);
  }
  const { entries, unplaced } = await archiveEntries(
    app,
    context,
    vibeCandidates(app.store, vibeId),
    signal,
  );
  return archiveView(context, heldAxes(context, entries), entries, unplaced);
}

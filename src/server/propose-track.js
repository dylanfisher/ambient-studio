// Proposes a new track (decision 0067): one model request through the queue, operator
// `arrange`, holding the brief, the owner's length and arc, a reference region's numbers when one
// is chosen, and a line per sketch and map elite, at most 24; the answer checked as an
// arrangement held to the length, with one repair round for one that parsed. A valid proposal
// keeps each elite it names as a sketch, then becomes the first revision of a new track, naming
// its generation in `proposal`. Nothing is rendered. It runs only when the owner's route adds it.
/** @import { MaterialItem, ArcWindow } from "../domain/arrange-prompt.js" */
/** @import { Arrangement } from "../domain/arrangement-schema.js" */
/** @import { ProposalAsk, ProposalVerdict } from "../domain/check-proposal.js" */
/** @import { Features } from "../domain/extract-features.js" */
/** @import { MacroName } from "../engine/macro-table.js" */
/** @import { Generation } from "./generation-store.js" */
/** @import { JobContext } from "./job-runner.js" */
/** @import { App } from "./routing.js" */
/** @import { Store } from "./store.js" */
import {
  arrangeMaterial,
  buildArrangePrompt,
  buildArrangeRepair,
  MATERIAL_KIND,
} from "../domain/arrange-prompt.js";
import { ARRANGEMENT_KEY } from "../domain/arrangement-schema.js";
import { ATTACHMENT_KIND } from "../domain/attachment-kind.js";
import { quotedErrors } from "../domain/build-repair-prompt.js";
import { judgeProposal } from "../domain/check-proposal.js";
import { macroWindow } from "../domain/macro-window.js";
import { OPERATOR } from "../domain/operator.js";
import { estimateTokens, promptText } from "../domain/prompt-tokens.js";
import { validateArrangement } from "../domain/validate-arrangement.js";
import { MACROS } from "../engine/genome-schema.js";
import { requireGenome } from "../engine/validate-genome.js";
import { listAttachments } from "./attachment-store.js";
import { currentExcerpt } from "./candidate-excerpt.js";
import { STREAM_SEEDS } from "./candidate-job.js";
import {
  currentRevision,
  GENERATION_STEP,
  requestGroupName,
  samplingStream,
  sendRequest,
} from "./generate-candidates.js";
import { getCandidate, getGenome, listRequestGroup } from "./generation-store.js";
import { JOB_STEP } from "./job-steps.js";
import { PRODUCER } from "./producer.js";
import { addSketch, listSketches } from "./rating-store.js";
import { findRegionAnalysis } from "./region-analysis-store.js";
import { vibeLoudness } from "./render-excerpt.js";
import { getRender } from "./render-store.js";
import { RETRIEVAL_METHOD } from "./retrieve-examples.js";
import { TABLE } from "./store.js";
import { arrangementContext } from "./track-routes.js";
import { createTrack } from "./track-store.js";
import { readArchive } from "./vibe-archive.js";

/** The answer's JSON schema, sent as `response_format` when the config asks for it (0022). */
const ARRANGE_RESPONSE_FORMAT = Object.freeze({
  name: "arrangement_answer",
  schema: {
    type: "object",
    properties: {
      [ARRANGEMENT_KEY.sections]: { type: "array" },
      [ARRANGEMENT_KEY.transitions]: { type: "array" },
      [ARRANGEMENT_KEY.lanes]: { type: "array" },
    },
    required: [ARRANGEMENT_KEY.sections, ARRANGEMENT_KEY.transitions, ARRANGEMENT_KEY.lanes],
    additionalProperties: false,
  },
});

/** The share of the context budget the first prompt may take; the rest is the repair's (0024). */
const FIRST_PROMPT_SHARE = 0.5;

/**
 * What the owner asked for.
 * @typedef {object} ProposeRequest
 * @property {number} vibeId
 * @property {string} name the new track's
 * @property {number} length seconds, checked by the route
 * @property {string} arc the owner's words, checked by the route
 * @property {number | null} regionId an attached region to follow as the arc; null for none
 */

/**
 * Each macro's least and most over the whole genome.
 * @param {unknown} stored a stored genome
 * @param {string} what what the error calls it
 */
function genomeMacros(stored, what) {
  const genome = requireGenome(stored, what);
  return Object.fromEntries(
    Object.keys(MACROS).map((name) => [
      name,
      macroWindow(genome, /** @type {MacroName} */ (name), 0, genome.duration),
    ]),
  );
}

/**
 * The brief's material, most wanted first and at most 24 lines: its live sketches, and the map's
 * elites not yet kept, each with its duration, its excerpt's features and its macros; with each
 * elite's excerpt render. A map that can't be read gives no elites.
 * @param {App} app
 * @param {number} vibeId
 * @param {AbortSignal} signal
 * @returns {Promise<{ material: MaterialItem[], durations: Map<number, number> }>}
 */
async function proposalMaterial(app, vibeId, signal) {
  const { store } = app;
  const sketches = listSketches(store, vibeId);
  const kept = new Set(sketches.map(({ candidateId }) => candidateId));
  /** @type {MaterialItem[]} */
  const sketchItems = sketches.map((sketch) => {
    const candidate = getCandidate(store, sketch.candidateId);
    if (!candidate?.genomeId) throw new Error(`sketch ${sketch.id} keeps no valid candidate`);
    const stored = getGenome(store, candidate.genomeId)?.genome;
    const genome = requireGenome(stored, `sketch ${sketch.id}'s genome`);
    const excerpt = currentExcerpt(store, app.paths.renderCache, candidate);
    return {
      kind: MATERIAL_KIND.sketch,
      id: sketch.id,
      intent: candidate.intent,
      notes: sketch.notes,
      tags: sketch.tags,
      duration: genome.duration,
      features: /** @type {Features | null} */ (excerpt?.features ?? null),
      macros: genomeMacros(genome, `sketch ${sketch.id}'s genome`),
      score: null,
      misses: 0,
    };
  });
  const archive = await readArchive(app, vibeId, signal);
  /** @type {MaterialItem[]} */
  const eliteItems = archive.cells
    .filter(({ candidateId }) => !kept.has(candidateId))
    .map(({ candidateId, renderId, intent, score, misses }) => {
      const candidate = getCandidate(store, candidateId);
      if (!candidate?.genomeId) throw new Error(`elite ${candidateId} has no genome`);
      const what = `elite ${candidateId}'s genome`;
      const genome = requireGenome(getGenome(store, candidate.genomeId)?.genome, what);
      return {
        kind: MATERIAL_KIND.elite,
        id: candidateId,
        intent,
        notes: "",
        tags: [],
        duration: genome.duration,
        features: /** @type {Features | null} */ (getRender(store, renderId)?.features ?? null),
        macros: genomeMacros(genome, what),
        score,
        misses,
      };
    });
  const material = arrangeMaterial(sketchItems, eliteItems);
  const durations = new Map(
    material
      .filter(({ kind }) => kind === MATERIAL_KIND.elite)
      .map(({ id, duration }) => [id, duration]),
  );
  return { material, durations };
}

/**
 * The attached region's windows at the brief's loudness, with its attachment's id, for the arc's
 * numbers. Throws when it isn't attached or isn't analyzed at that loudness.
 * @param {Store} store
 * @param {number} vibeId
 * @param {number} regionId
 * @returns {{ attachmentId: number, windows: ArcWindow[] }}
 */
export function arcRegion(store, vibeId, regionId) {
  const attached = listAttachments(store, vibeId, ATTACHMENT_KIND.reference).find(
    (row) => row.regionId === regionId,
  );
  if (!attached) {
    throw new Error(`region ${regionId} isn't attached to this brief; attach it first`);
  }
  const target = vibeLoudness(currentRevision(store, vibeId).constraints);
  const analysis = findRegionAnalysis(store, { regionId, target, producer: PRODUCER });
  if (!analysis) {
    throw new Error(
      `region ${regionId} isn't measured at the brief's loudness, ${target} LUFS; press Measure on the brief page first`,
    );
  }
  return {
    attachmentId: attached.id,
    windows: analysis.windows.map(({ startSeconds, seconds, features }) => ({
      startSeconds,
      seconds,
      features,
    })),
  };
}

/**
 * The arrangement with each elite's section naming the sketch kept of it, and the proposal's
 * generation.
 * @param {Arrangement} arrangement as `checkProposal` passed it
 * @param {ReadonlyMap<number, number>} elites each elite's section index and candidate id
 * @param {ReadonlyMap<number, number>} sketchIds the sketch kept of each candidate
 * @param {number} generationId
 * @returns {Arrangement}
 */
const placed = (arrangement, elites, sketchIds, generationId) => ({
  ...arrangement,
  sections: arrangement.sections.map((section, i) => {
    const candidateId = elites.get(i);
    return candidateId === undefined
      ? section
      : { ...section, sketchId: /** @type {number} */ (sketchIds.get(candidateId)) };
  }),
  proposal: generationId,
});

/**
 * The job that proposes a track and stores it. When the proposal is still invalid after its one
 * repair, or the answer can't be repaired, the job fails, listing every finding, and no track or
 * sketch is made; every request stays stored as a generation. Cancelling the job cancels the
 * omlx queue, which is the job's alone while it runs.
 * @param {App} app
 * @param {ProposeRequest} request
 * @returns {(job: JobContext) => Promise<{ trackId: number, revisionId: number,
 *   generationId: number, repaired: boolean, listed: number, keptElites: number[] }>}
 */
export function proposeJob(app, { vibeId, name, length, arc, regionId }) {
  return async (job) => {
    const { store, config } = app;
    const cancelRequests = () => app.queue.cancel();
    job.signal.addEventListener("abort", cancelRequests);
    try {
      job.progress(0, 1, JOB_STEP.readingMaterial);
      const { revision } = currentRevision(store, vibeId);
      const region = regionId === null ? null : arcRegion(store, vibeId, regionId);
      const { material, durations } = await proposalMaterial(app, vibeId, job.signal);
      job.signal.throwIfAborted();
      const built = buildArrangePrompt({
        name: revision.name,
        brief: revision.brief,
        length,
        arc,
        reference: region?.windows ?? null,
        material,
        budgetTokens: Math.floor(config.queue.contextBudgetTokens * FIRST_PROMPT_SHARE),
      });
      const seed = Math.floor(app.random() * STREAM_SEEDS);
      const requestGroup = requestGroupName(vibeId, seed, OPERATOR.arrange);
      if (listRequestGroup(store, requestGroup).length > 0) {
        throw new Error(`request group ${requestGroup} already exists; propose again`);
      }
      const [draw] = samplingStream(seed, 1);
      if (!draw) throw new Error("the sampling stream drew nothing");
      const batch = {
        store,
        queue: app.queue,
        config,
        vibeRevisionId: revision.id,
        sessionId: null,
        requestGroup,
        exampleIds: [],
        attachmentIds: region === null ? [] : [region.attachmentId],
        retrievalMethod: RETRIEVAL_METHOD.none,
        /** @param {{ kind: string }} step */
        onStep: ({ kind }) =>
          job.progress(
            0,
            1,
            kind === GENERATION_STEP.asking
              ? JOB_STEP.proposing
              : kind === GENERATION_STEP.repairing
                ? JOB_STEP.repairingProposal
                : JOB_STEP.busy,
          ),
      };
      /** @type {ProposalAsk} */
      const ask = { context: arrangementContext(store, vibeId), elites: durations, length, arc };
      /**
       * @param {import("../domain/prompt-tokens.js").ChatMessage[]} prompt
       * @param {number | null} repairsId
       * @returns {Promise<{ generation: Generation, verdict: ProposalVerdict }>}
       */
      const send = async (prompt, repairsId) => {
        const sent = await sendRequest(
          batch,
          0,
          prompt,
          draw.sampling,
          repairsId,
          ARRANGE_RESPONSE_FORMAT,
        );
        if (sent.failure !== null) throw sent.failure;
        const verdict = judgeProposal(sent.completion, config.queue.maxTokens, ask);
        return { generation: sent.generation, verdict };
      };
      let { generation, verdict } = await send(built.messages, null);
      let repaired = false;
      if (!verdict.ok && verdict.answer !== null) {
        const repair = buildArrangeRepair(
          { messages: built.messages, answer: verdict.answer },
          verdict.errors,
        );
        const tokens = estimateTokens(promptText(repair));
        if (tokens > config.queue.contextBudgetTokens) {
          throw new Error(
            `The proposal was invalid, and its repair prompt is about ${tokens} tokens, over the ${config.queue.contextBudgetTokens}-token budget, so no repair was sent:\n${quotedErrors(verdict.errors).join("\n")}`,
          );
        }
        job.signal.throwIfAborted();
        ({ generation, verdict } = await send(repair, generation.id));
        repaired = true;
      }
      if (!verdict.ok) {
        const when = repaired
          ? "still invalid after one repair"
          : "invalid, with nothing to repair";
        throw new Error(
          `The model's proposal was ${when} (generation ${generation.id}):\n${quotedErrors(verdict.errors).join("\n")}`,
        );
      }
      job.signal.throwIfAborted();
      // An elite becomes a sketch once the proposal is valid, so a failed proposal keeps none.
      // The sketch row alone: nothing is rendered, and the owner hasn't heard it to keep.
      /** @type {Map<number, number>} */
      const sketchIds = new Map();
      for (const candidateId of new Set(verdict.elites.values())) {
        sketchIds.set(candidateId, addSketch(store, { candidateId, notes: "", tags: [] }).id);
      }
      const arrangement = placed(verdict.arrangement, verdict.elites, sketchIds, generation.id);
      const checked = validateArrangement(arrangement, arrangementContext(store, vibeId));
      if (!checked.ok) {
        throw new Error(
          `the proposal failed its check once its elites were kept: ${JSON.stringify(checked.errors)}`,
        );
      }
      const { track, revision: first } = createTrack(store, {
        vibeId,
        name,
        arrangement: checked.arrangement,
        note: repaired ? "Proposed by the model, after one repair" : "Proposed by the model",
      });
      job.progress(1, 1, null);
      return {
        trackId: track.id,
        revisionId: first.id,
        generationId: generation.id,
        repaired,
        listed: built.material.length,
        keptElites: [...sketchIds.keys()],
      };
    } finally {
      job.signal.removeEventListener("abort", cancelRequests);
    }
  };
}

/**
 * How the proposals asked for so far came out, for acceptance 8's share: each request group of
 * operator `arrange` is valid when a track revision names one of its generations, failed when
 * its last request failed in the queue, and invalid otherwise.
 * @param {Store} store
 * @returns {{ asked: number, valid: number, firstTry: number, invalid: number, failed: number }}
 */
export function proposalShare(store) {
  const pattern = requestGroupName(
    /** @type {any} */ ("%"),
    /** @type {any} */ ("%"),
    OPERATOR.arrange,
  );
  const generations = store.db
    .prepare(
      `SELECT id, requestGroup, repairRound, error FROM ${TABLE.generations}
        WHERE requestGroup LIKE ? ORDER BY id`,
    )
    .all(pattern);
  const proposed = new Set(
    store.db
      .prepare(
        `SELECT DISTINCT json_extract(arrangement, '$.${ARRANGEMENT_KEY.proposal}') AS id
           FROM ${TABLE.trackRevisions}
          WHERE json_extract(arrangement, '$.${ARRANGEMENT_KEY.proposal}') IS NOT NULL`,
      )
      .all()
      .map((row) => Number(row.id)),
  );
  /** @type {Map<string, { id: number, repairRound: number, error: unknown }[]>} */
  const groups = new Map();
  for (const row of generations) {
    const group = String(row.requestGroup);
    const rows = groups.get(group) ?? [];
    rows.push({ id: Number(row.id), repairRound: Number(row.repairRound), error: row.error });
    groups.set(group, rows);
  }
  const share = { asked: groups.size, valid: 0, firstTry: 0, invalid: 0, failed: 0 };
  for (const rows of groups.values()) {
    const kept = rows.find(({ id }) => proposed.has(id));
    if (kept) {
      share.valid += 1;
      if (kept.repairRound === 0) share.firstTry += 1;
    } else if (rows.at(-1)?.error !== null) share.failed += 1;
    else share.invalid += 1;
  }
  return share;
}

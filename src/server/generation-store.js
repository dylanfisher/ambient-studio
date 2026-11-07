// LLM calls, the genomes they reach and the candidates that record each time one was reached
// (decision 0021). Genomes hold content only, one row per genome a vibe has reached (0005).
/** @import { Genome } from "../engine/genome-schema.js" */
/** @import { Removable, Store } from "./store.js" */
import { canonicalGenome } from "../engine/canonical-genome.js";
import { genomeHash } from "./genome-hash.js";
import { decode, insertRow, selectRow, selectRows, TABLE } from "./store.js";

/**
 * One LLM call, as 2f stores it: Phase 8's fine-tuning needs the exact prompt.
 * @typedef {object} GenerationDraft
 * @property {number} vibeRevisionId
 * @property {number | null} sessionId null for a call outside a session, as in an evaluation
 * @property {string} requestGroup shared by the candidates of one request
 * @property {unknown} prompt the messages sent
 * @property {unknown[]} exampleIds the examples retrieved into the prompt
 * @property {string} retrievalMethod
 * @property {string} model
 * @property {unknown} sampling
 * @property {string} response the raw text
 * @property {string} finishReason
 * @property {number} repairRound 0 for a first try
 * @property {number | null} repairsId the generation this one repairs; null in round 0
 * @property {number} latencyMs
 * @property {number | null} firstTokenMs null when no token arrived
 * @property {number | null} promptTokens null when omlx doesn't report it
 * @property {number | null} completionTokens
 * @property {string | null} reasoning the reasoning text a reasoning model sent; null when none
 * @property {unknown} requestParams the request body as the queue sent it, without its
 *   messages: model, max_tokens, sampling, stream and n, and response_format when sent; null
 *   on rows written before migration 0002
 * @property {unknown} retries the queue's backoffs before the answer or failure; null before 0002
 * @property {string | null} error why the request failed in the queue, with `finishReason`
 *   set to the failed finish reason and an empty response; null when omlx answered
 */

/** @typedef {GenerationDraft & Removable & { id: number, createdAt: number }} Generation */

/**
 * @typedef {Removable & {
 *   id: number,
 *   vibeId: number,
 *   genomeHash: string,
 *   genome: Genome,
 *   createdAt: number,
 * }} GenomeRow `genome` is the canonical genome, parsed
 */

/**
 * One time a genome was produced, or an output that never became one.
 * @typedef {object} CandidateDraft
 * @property {number} vibeRevisionId
 * @property {number | null} generationId null for a candidate no LLM call made
 * @property {number | null} sessionId the session it was made in; null outside one, as in an
 *   evaluation
 * @property {number | null} genomeId null when the output never parsed into a genome
 * @property {number} seed
 * @property {string} source llm, mutation, crossover, optimizer, breeding or random
 * @property {unknown[]} parentIds
 * @property {unknown} locks
 * @property {string | null} operator
 * @property {unknown} operatorParams
 * @property {string | null} intent the model's one-line intent
 * @property {string | null} rejectReason null for a valid candidate
 * @property {unknown} lint the lint result with every reason; null when nothing was linted
 * @property {unknown} rejectedGenome the genome as the answer wrote it, for a candidate rejected
 *   after it parsed; null otherwise, since a valid one has its `genomes` row
 */

/** @typedef {CandidateDraft & Removable & { id: number, createdAt: number }} Candidate */

const GENERATIONS = { json: ["prompt", "exampleIds", "sampling", "requestParams", "retries"] };
const GENOMES = { json: ["genome"] };
const CANDIDATES = { json: ["parentIds", "locks", "operatorParams", "lint", "rejectedGenome"] };

/**
 * @param {Store} store
 * @param {GenerationDraft} draft
 * @returns {Generation}
 */
export function addGeneration(store, draft) {
  return insertRow(store, TABLE.generations, GENERATIONS, { ...draft });
}

/**
 * @param {Store} store
 * @param {number} id
 * @returns {Generation | undefined}
 */
export function getGeneration(store, id) {
  return selectRow(store, TABLE.generations, GENERATIONS, id);
}

/**
 * The generations of one request, its repairs included, oldest first: a DPO pair's candidates
 * come from one group (phase 8).
 * @param {Store} store
 * @param {string} requestGroup
 * @returns {Generation[]}
 */
export function listRequestGroup(store, requestGroup) {
  return /** @type {Generation[]} */ (
    selectRows(store, TABLE.generations, GENERATIONS, { requestGroup })
  );
}

/**
 * The vibe's row for `genome`, written when the vibe hasn't reached it before. Throws on an
 * invalid genome.
 * @param {Store} store
 * @param {number} vibeId
 * @param {unknown} genome
 * @returns {GenomeRow}
 */
export function putGenome(store, vibeId, genome) {
  const hash = genomeHash(genome);
  store.db
    .prepare(
      `INSERT INTO genomes (vibeId, genomeHash, genome, createdAt) VALUES (?, ?, ?, ?)
       ON CONFLICT (vibeId, genomeHash) DO NOTHING`,
    )
    .run(vibeId, hash, canonicalGenome(genome), store.now());
  const row = store.db
    .prepare("SELECT * FROM genomes WHERE vibeId = ? AND genomeHash = ?")
    .get(vibeId, hash);
  if (!row) throw new Error(`genome ${hash} wasn't stored for vibe ${vibeId}`);
  return decode(GENOMES, row);
}

/**
 * @param {Store} store
 * @param {number} id
 * @returns {GenomeRow | undefined}
 */
export function getGenome(store, id) {
  return selectRow(store, TABLE.genomes, GENOMES, id);
}

/**
 * The genomes a vibe has reached and not removed, oldest first.
 * @param {Store} store
 * @param {number} vibeId
 * @returns {GenomeRow[]}
 */
export function listGenomes(store, vibeId) {
  return /** @type {GenomeRow[]} */ (selectRows(store, TABLE.genomes, GENOMES, { vibeId }));
}

/**
 * @param {Store} store
 * @param {CandidateDraft} draft
 * @returns {Candidate}
 */
export function addCandidate(store, draft) {
  return insertRow(store, TABLE.candidates, CANDIDATES, { ...draft });
}

/**
 * @param {Store} store
 * @param {number} id
 * @returns {Candidate | undefined}
 */
export function getCandidate(store, id) {
  return selectRow(store, TABLE.candidates, CANDIDATES, id);
}

/**
 * The candidates made in the session and not removed, oldest first, those made without a model
 * request included.
 * @param {Store} store
 * @param {number} sessionId
 * @returns {Candidate[]}
 */
export function listSessionCandidates(store, sessionId) {
  return /** @type {Candidate[]} */ (
    selectRows(store, TABLE.candidates, CANDIDATES, { sessionId })
  );
}

// Evaluation jobs' parameters and reports, written once the job finishes (decision 0021).
/** @import { Removable, Store } from "./store.js" */
import { insertRow, selectRow, TABLE } from "./store.js";

/**
 * @typedef {object} EvaluationDraft
 * @property {unknown} params what the owner started the job with
 * @property {unknown} report
 */

/** @typedef {EvaluationDraft & Removable & { id: number, createdAt: number }} Evaluation */

const EVALUATIONS = { json: ["params", "report"] };

/**
 * @param {Store} store
 * @param {EvaluationDraft} draft
 * @returns {Evaluation}
 */
export function addEvaluation(store, { params, report }) {
  return insertRow(store, TABLE.evaluations, EVALUATIONS, { params, report });
}

/**
 * @param {Store} store
 * @param {number} id
 * @returns {Evaluation | undefined}
 */
export function getEvaluation(store, id) {
  return selectRow(store, TABLE.evaluations, EVALUATIONS, id);
}

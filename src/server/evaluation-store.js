// Evaluation jobs' parameters and reports, written once the job finishes (decision 0021). A
// generation evaluation's params have no `kind`; the optimizer test's (0059) name theirs, so the
// two are told apart with no new column.
/** @import { Removable, Store } from "./store.js" */
import { JOB_KIND } from "../domain/job-kind.js";
import { insertRow, selectRow, selectRows, TABLE } from "./store.js";

/**
 * @typedef {object} EvaluationDraft
 * @property {unknown} params what the owner started the job with
 * @property {unknown} report
 */

/** @typedef {EvaluationDraft & Removable & { id: number, createdAt: number }} Evaluation */

const EVALUATIONS = { json: ["params", "report"] };

/** The `kind` in an evaluation's params, for the evaluations that aren't generation runs. */
export const EVALUATION_KIND = Object.freeze({ optimizer: JOB_KIND.optimizerTest });

/** @param {unknown} params an evaluation's */
const kindOf = (params) => /** @type {{ kind?: string } | null} */ (params)?.kind ?? null;

/**
 * @param {Store} store
 * @param {EvaluationDraft} draft
 * @returns {Evaluation}
 */
export function addEvaluation(store, { params, report }) {
  return insertRow(store, TABLE.evaluations, EVALUATIONS, { params, report });
}

/**
 * The evaluation, or undefined when there is none or it is of another kind.
 * @param {Store} store
 * @param {number} id
 * @param {string | null} [kind] one of `EVALUATION_KIND`; null for a generation run
 * @returns {Evaluation | undefined}
 */
export function getEvaluation(store, id, kind = null) {
  /** @type {Evaluation | undefined} */
  const found = selectRow(store, TABLE.evaluations, EVALUATIONS, id);
  return found && kindOf(found.params) === kind ? found : undefined;
}

/**
 * The evaluations of one kind not removed, oldest first: the generation runs when `kind` is
 * null.
 * @param {Store} store
 * @param {string | null} [kind] one of `EVALUATION_KIND`
 * @returns {Evaluation[]}
 */
export function listEvaluations(store, kind = null) {
  const rows = /** @type {Evaluation[]} */ (selectRows(store, TABLE.evaluations, EVALUATIONS, {}));
  return rows.filter(({ params }) => kindOf(params) === kind);
}

// The studio's JSON API, as the pages call it (decision 0027). Every POST sends a JSON body,
// `{}` when the route takes no fields, because the server answers only JSON bodies (0025). A
// reply that isn't a 2xx throws with the server's message, for the page to show. An upload is
// the one body that isn't JSON (0050).
import { FILE_NAME_HEADER, UPLOAD_TYPE } from "../domain/reference-upload.js";

/**
 * @param {string} method
 * @param {string} path
 * @param {RequestInit} init
 * @returns {Promise<any>} the parsed reply
 */
async function send(method, path, init) {
  const response = await fetch(path, { ...init, method });
  const text = await response.text();
  /** @type {any} */
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${method} ${path}: ${response.status}, and the reply isn't JSON: ${text}`, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new ApiError(
      value?.error ?? `${method} ${path}: ${response.status}`,
      response.status,
      value,
    );
  }
  return value;
}

/** A reply that isn't a 2xx: the server's message, with the status and the body it sent. */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {any} body
   */
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/** The vibes route; a vibe's own routes are under it. */
export const VIBES_PATH = "/api/vibes";

/** The seed vibes route; `/<seed id>` under it loads one as a vibe. */
export const SEED_VIBES_PATH = "/api/seed-vibes";

/** The evaluations route: a POST starts one, a GET lists the reports and the running job. */
export const EVALUATIONS_PATH = "/api/evaluations";

/** The taste model test's route: a POST starts one, a GET reads the last report and the job. */
export const PREFERENCE_TESTS_PATH = "/api/preference-tests";

/** The embed job's route: a POST starts it (decision 0042). */
export const EMBEDDINGS_PATH = "/api/embeddings";

/** The fit job's route: a POST starts it (decision 0044). */
export const PREFERENCE_MODELS_PATH = "/api/preference-models";

/** The reference recordings route: a GET lists them, a POST uploads one (decision 0050). */
export const REFERENCES_PATH = "/api/references";

/**
 * A reference's route; its peaks, audio, regions and removal are under it.
 * @param {number} referenceId
 */
export const referencePath = (referenceId) => `${REFERENCES_PATH}/${referenceId}`;

/** Every live region of every recording, for the brief page's chooser (decision 0051). */
export const REGIONS_PATH = "/api/reference-regions";

/**
 * A region's route; `/replace` and `/remove` under it change it, `/analyze` measures it, and
 * `/analysis` reads what was measured.
 * @param {number} regionId
 */
export const regionPath = (regionId) => `${REGIONS_PATH}/${regionId}`;

/** Every job since the server started, with its kind. */
export const JOBS_PATH = "/api/jobs";

/** What a search's confirm reads its cost from (decision 0054). */
export const SEARCH_ESTIMATE_PATH = "/api/search-estimate";

/**
 * A session's route; its candidates, jobs and ratings are under it.
 * @param {number} sessionId
 */
export const sessionPath = (sessionId) => `/api/sessions/${sessionId}`;

/**
 * A job's status route; `/cancel` under it cancels the job.
 * @param {number} jobId
 */
export const jobPath = (jobId) => `/api/jobs/${jobId}`;

/**
 * @param {string} path
 * @returns {Promise<any>}
 */
export const getJson = (path) => send("GET", path, {});

/**
 * @param {string} path
 * @param {Record<string, unknown>} body `{}` when the route takes no fields
 * @returns {Promise<any>}
 */
export const postJson = (path, body) =>
  send("POST", path, {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Uploads a file as the raw bytes of the body, its name in a header.
 * @param {string} path
 * @param {File} file
 * @returns {Promise<any>} the parsed reply
 */
export const uploadFile = (path, file) =>
  send("POST", path, {
    headers: { "content-type": UPLOAD_TYPE, [FILE_NAME_HEADER]: encodeURIComponent(file.name) },
    body: file,
  });

/**
 * Starts a job. The server refuses a job identical to one queued or running with a 409 naming
 * it (decision 0031); then the page follows that job instead, and shows the server's sentence,
 * since the owner's request is already being done.
 * @param {string} path
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ job: any, refused: string | null }>}
 */
export async function startJob(path, body) {
  try {
    return { job: await postJson(path, body), refused: null };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const jobId = error.body?.jobId;
    if (!Number.isInteger(jobId)) throw error;
    return { job: await getJson(jobPath(jobId)), refused: error.message };
  }
}

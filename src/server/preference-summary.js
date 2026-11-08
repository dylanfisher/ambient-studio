// A vibe's taste summary for the brief page (decision 0047): the model file under the vibe's
// current key, read and turned into text by a template. The current key names the sidecar's
// embedding producer and model code, so it asks the sidecar for both; neither loads a model.
// With no model file at all it asks nothing, so a studio that never fitted one never starts
// the sidecar from a page.
/** @import { ModelWeights, PreferenceState } from "../domain/preference-text.js" */
/** @import { Embedder } from "./embed-audio.js" */
/** @import { PlannedModel } from "./preference-model.js" */
/** @import { App } from "./routing.js" */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { PREFERENCE_STATE, preferenceText } from "../domain/preference-text.js";
import { readEmbedder } from "./embed-audio.js";
import { readModelCode } from "./fit-job.js";
import { modelFile, modelPlan } from "./preference-model.js";
import { isReportFile } from "./preference-test-store.js";

/**
 * Whether any model file has been written. A fit writes to a temp folder beside the folder and
 * moves only the finished file in; the one other file there is the taste model test's report
 * (and its partial copy while it is written), which is no model.
 * @param {App} app
 */
const anyModel = async (app) =>
  existsSync(app.paths.models) &&
  (await readdir(app.paths.models)).some((name) => !isReportFile(name));

/**
 * The vibe's model under its current key, or why there is none: no model file at all, an
 * embedder that can't be used (the reason given), or no file under the current key. The
 * summary and the ranking (decision 0046) both find it here.
 * @typedef {{ state: typeof PREFERENCE_STATE.none, reason: string | null }
 *   | { state: typeof PREFERENCE_STATE.stale }
 *   | { state: typeof PREFERENCE_STATE.fitted, planned: PlannedModel, file: string,
 *       embedder: Embedder }} CurrentModel
 */

/**
 * @param {App} app
 * @param {number} vibeId a vibe that isn't removed
 * @param {AbortSignal} signal
 * @returns {Promise<CurrentModel>}
 */
export async function currentModel(app, vibeId, signal) {
  if (!(await anyModel(app))) return { state: PREFERENCE_STATE.none, reason: null };
  const embedder = await readEmbedder(app, { fetch: false, signal });
  if (typeof embedder === "string") return { state: PREFERENCE_STATE.none, reason: embedder };
  const modelCode = await readModelCode(app, signal);
  const planned = modelPlan(app.store, embedder.producer, { modelCode }).vibes.find(
    (vibe) => vibe.vibeId === vibeId,
  );
  if (!planned) throw new Error(`brief ${vibeId} isn't in the model plan`);
  const file = modelFile(app.paths, planned.key);
  if (!existsSync(file)) return { state: PREFERENCE_STATE.stale };
  return { state: PREFERENCE_STATE.fitted, planned, file, embedder };
}

/**
 * What the current model of `vibeId` says, or that there is none or it is out of date.
 * @param {App} app
 * @param {number} vibeId a vibe that isn't removed
 * @param {AbortSignal} signal
 * @returns {Promise<{ state: PreferenceState["state"], text: string }>}
 */
export async function readPreferenceSummary(app, vibeId, signal) {
  /** @param {PreferenceState} found */
  const answer = (found) => ({ state: found.state, ...preferenceText(found) });
  const found = await currentModel(app, vibeId, signal);
  if (found.state !== PREFERENCE_STATE.fitted) return answer(found);
  /** @type {ModelWeights} */
  const model = JSON.parse(await readFile(found.file, "utf8"));
  const { pairs } = found.planned.set;
  return answer({
    state: PREFERENCE_STATE.fitted,
    model,
    pairs: new Set(pairs.map((pair) => pair.ratingId)).size,
    sessions: new Set(pairs.map((pair) => pair.sessionId)).size,
  });
}

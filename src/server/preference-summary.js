// A vibe's taste summary for the brief page (decision 0047): the model file under the vibe's
// current key, read and turned into text by a template. The current key names the sidecar's
// embedding producer and model code, so it asks the sidecar for both; neither loads a model.
// With no model file at all it asks nothing, so a studio that never fitted one never starts
// the sidecar from a page.
/** @import { ModelWeights, PreferenceState } from "../domain/preference-text.js" */
/** @import { App } from "./routing.js" */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { PREFERENCE_STATE, preferenceText } from "../domain/preference-text.js";
import { readEmbedder } from "./embed-audio.js";
import { readModelCode } from "./fit-job.js";
import { modelFile, modelPlan } from "./preference-model.js";

/**
 * Whether any model file has been written. The folder holds nothing else: a fit writes to a
 * temp folder beside it and moves only the finished file in.
 * @param {App} app
 */
const anyModel = async (app) =>
  existsSync(app.paths.models) && (await readdir(app.paths.models)).length > 0;

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
  if (!(await anyModel(app))) return answer({ state: PREFERENCE_STATE.none, reason: null });
  const embedder = await readEmbedder(app, { fetch: false, signal });
  if (typeof embedder === "string")
    return answer({ state: PREFERENCE_STATE.none, reason: embedder });
  const modelCode = await readModelCode(app, signal);
  const planned = modelPlan(app.store, embedder.producer, { modelCode }).vibes.find(
    (vibe) => vibe.vibeId === vibeId,
  );
  if (!planned) throw new Error(`brief ${vibeId} isn't in the model plan`);
  const file = modelFile(app.paths, planned.key);
  if (!existsSync(file)) return answer({ state: PREFERENCE_STATE.stale });
  /** @type {ModelWeights} */
  const model = JSON.parse(await readFile(file, "utf8"));
  const { pairs } = planned.set;
  return answer({
    state: PREFERENCE_STATE.fitted,
    model,
    pairs: new Set(pairs.map((pair) => pair.ratingId)).size,
    sessions: new Set(pairs.map((pair) => pair.sessionId)).size,
  });
}

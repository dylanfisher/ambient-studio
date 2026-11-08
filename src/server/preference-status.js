// Where the owner's taste model stands, for the Model test page (decision 0068): how many
// excerpts the embed job would analyze, when the last embedding and model file were made, and
// each brief's model state. Read from the store and the models folder, not from the jobs, which
// a restart forgets. With no embedding and no model file it asks the sidecar nothing, so a
// studio that never analyzed a sound never starts it from a page.
/** @import { PREFERENCE_STATE } from "../domain/preference-text.js" */
/** @import { App } from "./routing.js" */
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { readEmbedder } from "./embed-audio.js";
import { excerptsToEmbed } from "./embed-job.js";
import { lastEmbeddedAt } from "./embedding-store.js";
import { currentModel } from "./preference-summary.js";
import { isReportFile } from "./preference-test-store.js";
import { listVibes } from "./vibe-store.js";

/**
 * @typedef {object} PreferenceStatus
 * @property {{ waiting: number | null, reason: string | null, lastAt: number | null }} analysis
 *   `waiting` is null, with the `reason`, when the embedder can't say what is analyzed
 * @property {{ lastAt: number | null,
 *   briefs: { vibeId: number, name: string, state: (typeof PREFERENCE_STATE)[keyof typeof PREFERENCE_STATE] }[] }} fit
 */

/**
 * When the newest model file was written, or null when there is none.
 * @param {App} app
 */
async function lastFittedAt(app) {
  if (!existsSync(app.paths.models)) return null;
  const names = (await readdir(app.paths.models)).filter((name) => !isReportFile(name));
  const times = await Promise.all(
    names.map(async (name) => (await stat(join(app.paths.models, name))).mtimeMs),
  );
  return times.length === 0 ? null : Math.max(...times);
}

/**
 * @param {App} app
 * @param {AbortSignal} signal
 * @returns {Promise<PreferenceStatus>}
 */
export async function readPreferenceStatus(app, signal) {
  const lastAt = lastEmbeddedAt(app.store);
  const embedder = lastAt === null ? null : await readEmbedder(app, { fetch: false, signal });
  const analysis =
    typeof embedder === "string"
      ? { waiting: null, reason: embedder, lastAt }
      : {
          waiting: excerptsToEmbed(app, embedder?.producer ?? null).wanted.length,
          reason: null,
          lastAt,
        };
  const briefs = [];
  for (const vibe of listVibes(app.store)) {
    const { state } = await currentModel(app, vibe.id, signal);
    briefs.push({ vibeId: vibe.id, name: vibe.revision.name, state });
  }
  return { analysis, fit: { lastAt: await lastFittedAt(app), briefs } };
}

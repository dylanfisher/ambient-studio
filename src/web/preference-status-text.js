// Where the taste model stands, in plain words for the Model test page (decision 0068): the
// server's `PreferenceStatus`, read as JSON. No DOM here, so the wording is tested.
import { listed, PREFERENCE_STATE } from "../domain/preference-text.js";
import { formatTime } from "./format-time.js";

/**
 * What the sound analysis has left to do.
 * @param {{ waiting: number | null, reason: string | null, lastAt: number | null }} analysis
 */
export function analysisText({ waiting, reason, lastAt }) {
  if (waiting === null) return `Sound analysis: can't say what is analyzed, because ${reason}.`;
  const last = lastAt === null ? "" : `, last ${formatTime(lastAt)}`;
  if (waiting === 0) {
    return lastAt === null
      ? "Sound analysis: nothing to analyze yet. Rate some candidates first."
      : `Sound analysis: every rated and candidate excerpt is analyzed${last}.`;
  }
  const excerpts = `${waiting} excerpt${waiting === 1 ? "" : "s"}`;
  return `Sound analysis: ${excerpts} not analyzed yet${last}. Press Analyze the sound.`;
}

/**
 * Which briefs' taste models are up to date.
 * @param {{ lastAt: number | null,
 *   briefs: { name: string, state: string }[] }} fit
 */
export function fitText({ lastAt, briefs }) {
  if (briefs.length === 0) return "Taste model: no briefs yet.";
  if (lastAt === null) return "Taste model: not fitted yet. Analyze the sound first, then fit it.";
  const last = `last fitted ${formatTime(lastAt)}`;
  const stale = briefs.filter((b) => b.state !== PREFERENCE_STATE.fitted).map((b) => b.name);
  if (stale.length === 0) return `Taste model: up to date for every brief, ${last}.`;
  return (
    `Taste model: ${last}, and out of date for ${listed(stale)}, since ratings changed. ` +
    "Press Fit the taste model."
  );
}

// Reads the owner's words for a shift as a search by ear's sliders (decisions 0075, 0084): the
// words operator's request for the `shift` field set, each path the run moves, with where the
// best sits on each as the reading. It runs from the search's own route, not as a job, since
// the search holds the job runner while it runs. The search isn't told: the page sets its
// sliders from the answer, and the owner sends them.
/** @import { EarChannel } from "./ear-search-job.js" */
/** @import { App } from "./routing.js" */
import { checkSteering, EAR_SHIFT } from "../domain/ear-settings.js";
import { OPERATOR } from "../domain/operator.js";
import { buildWordsPrompt } from "../domain/words-prompt.js";
import { WORDS_SETS } from "../domain/words-sets.js";
import { toVector } from "../engine/vector-view.js";
import { askWords } from "./ask-words.js";
import { FIRST_PROMPT_SHARE } from "./draft-brief-routes.js";
import { currentRevision } from "./generate-candidates.js";
import { getGenome } from "./generation-store.js";
import { HttpError } from "./routing.js";

const SET = WORDS_SETS.shift;

/**
 * @param {App} app
 * @param {{ id: number, vibeId: number }} session open
 * @param {EarChannel} channel the session's search by ear, still running
 * @param {string} words the owner's, one line
 * @returns {Promise<{ shift: Record<string, number>, said: string, generationId: number }>}
 */
export async function readShiftWords(app, session, channel, words) {
  const { paths, best, steering } = channel.view();
  if (paths.length === 0 || best === null) {
    throw new HttpError(
      409,
      "The search by ear is still starting; describe a shift once its first pair shows.",
    );
  }
  const row = getGenome(app.store, best.genomeId);
  if (!row) throw new Error(`the search's best names genome ${best.genomeId}, which has no row`);
  const positions = toVector(row.genome, paths);
  const fields = Object.entries(SET.fields(paths)).map(([name, descriptor]) => ({
    name,
    descriptor,
    current: steering.shift[name] ?? EAR_SHIFT.default,
  }));
  const messages = buildWordsPrompt(
    {
      words,
      subject: SET.subject,
      fields,
      brief: currentRevision(app.store, session.vibeId).revision.brief,
      reading: paths.map(
        (path, i) =>
          `- ${path}: the best so far sits at ${/** @type {number} */ (positions[i]).toFixed(2)} of 0 to 1`,
      ),
    },
    Math.floor(app.config.queue.contextBudgetTokens * FIRST_PROMPT_SHARE),
  );
  const answer = await askWords(app, {
    vibeId: session.vibeId,
    sessionId: session.id,
    operator: OPERATOR.shift,
    messages,
    fields,
  });
  if (!answer.ok) {
    throw new HttpError(502, `${answer.error}\nDescribe it again, or set the sliders by hand.`);
  }
  // The answer names only what the words change; the rest keep the run's steering.
  const checked = checkSteering(
    steering.variation,
    { ...steering.shift, ...answer.changes },
    paths,
  );
  if (!checked.ok) throw new Error(`a checked shift failed the steering's check: ${checked.error}`);
  return { shift: checked.steering.shift, said: answer.said, generationId: answer.generationId };
}

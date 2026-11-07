// The evaluation page (decision 0030): start an evaluation over the checked vibes, follow its
// job, and read the stored reports. The vibes loaded from seeds start checked. An evaluation
// holds the shared omlx for a long while, so starting one takes Shift+S and a confirmation.
import { EVALUATION_COUNT } from "../domain/evaluation-size.js";
import {
  EVALUATIONS_PATH,
  getJson,
  jobPath,
  postJson,
  SEED_VIBES_PATH,
  VIBES_PATH,
} from "./api.js";
import { bindKeys } from "./bind-keys.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { formatTime } from "./format-time.js";
import { oneAtATime } from "./one-at-a-time.js";
import { POLL_MS } from "./poll-ms.js";
import { percentilesText, rateText, rejectsText, responseFormatText } from "./report-text.js";
import { statusLine } from "./status-line.js";

const status = statusLine();
const page = elementsById({
  vibeChoices: HTMLElement,
  countInput: HTMLInputElement,
  jobLine: HTMLElement,
  noReports: HTMLElement,
  reportList: HTMLUListElement,
  reportView: HTMLElement,
  reportHeading: HTMLElement,
  reportParams: HTMLElement,
  reportStopped: HTMLElement,
  reportTallies: HTMLElement,
  latencyFirst: HTMLElement,
  latencyRepair: HTMLElement,
  firstTokenFirst: HTMLElement,
  firstTokenRepair: HTMLElement,
  responseFormat: HTMLElement,
});
page.countInput.value = String(EVALUATION_COUNT.default);
page.countInput.max = String(EVALUATION_COUNT.max);

/** @type {any[]} every stored evaluation, oldest first */
let evaluations = [];
/** @type {number} the index of the report shown, -1 for none */
let shown = -1;
/** @type {any | null} the evaluation job being polled */
let running = null;

/** @param {any} job a job's status */
function showJob(job) {
  const progress = job.progress ? `, ${job.progress.done} of ${job.progress.total}` : "";
  const error = job.error ? `: ${job.error}` : "";
  page.jobLine.textContent = `Evaluation job ${job.id}: ${job.state}${progress}${error}`;
}

/**
 * @param {string} title
 * @param {any} tally a vibe's or the overall tally
 */
function tallyCard(title, tally) {
  const card = cloneTemplate("tally", {
    title: HTMLElement,
    validBefore: HTMLElement,
    validAfter: HTMLElement,
    schemaBefore: HTMLElement,
    schemaAfter: HTMLElement,
    truncated: HTMLElement,
    failed: HTMLElement,
    rejectsFirst: HTMLElement,
    rejectsAfter: HTMLElement,
  });
  card.title.textContent = `${title}: ${tally.made} of ${tally.requested} made`;
  card.validBefore.textContent = rateText(tally.valid.beforeRepair);
  card.validAfter.textContent = rateText(tally.valid.afterRepair);
  card.schemaBefore.textContent = rateText(tally.schemaValid.beforeRepair);
  card.schemaAfter.textContent = rateText(tally.schemaValid.afterRepair);
  card.truncated.textContent = String(tally.truncated);
  card.failed.textContent = String(tally.requestFailed);
  card.rejectsFirst.textContent = rejectsText(tally.rejects.firstTry);
  card.rejectsAfter.textContent = rejectsText(tally.rejects.afterRepair);
  return card.root;
}

/** @param {number} index into `evaluations` */
function showReport(index) {
  const evaluation = evaluations[index];
  if (!evaluation) throw new Error("No report to show yet.");
  shown = index;
  const { params, report } = evaluation;
  page.reportView.hidden = false;
  page.reportHeading.textContent = `Evaluation ${evaluation.id}, ${formatTime(evaluation.createdAt)}`;
  page.reportParams.textContent =
    `${params.count} per vibe over vibes ${params.vibeIds.join(", ")}; model ${params.model}, ` +
    `stream seed ${params.seed}, max_tokens ${params.maxTokens}.`;
  page.reportStopped.hidden = report.stopped === null;
  page.reportStopped.textContent = report.stopped === null ? "" : `Stopped: ${report.stopped}`;
  page.reportTallies.replaceChildren(
    tallyCard("Overall", report.overall),
    ...report.vibes.map((/** @type {any} */ vibe) => tallyCard(vibe.name, vibe)),
  );
  page.latencyFirst.textContent = `First tries: ${percentilesText(report.latencyMs.firstTry)}`;
  page.latencyRepair.textContent = `Repairs: ${percentilesText(report.latencyMs.repair)}`;
  page.firstTokenFirst.textContent = `First tries: ${percentilesText(report.firstTokenMs.firstTry)}`;
  page.firstTokenRepair.textContent = `Repairs: ${percentilesText(report.firstTokenMs.repair)}`;
  page.responseFormat.textContent = responseFormatText(report.responseFormat);
  for (const [i, item] of [...page.reportList.children].entries()) {
    // The list runs newest first.
    item.setAttribute("aria-current", String(i === evaluations.length - 1 - index));
  }
}

/** Reads the reports and the unfinished job, if any, and polls the job until it finishes. */
async function loadReports() {
  const listed = await getJson(EVALUATIONS_PATH);
  evaluations = listed.evaluations;
  page.noReports.hidden = evaluations.length > 0;
  // Newest first in the list; `evaluations` stays oldest first, as the server returns it.
  page.reportList.replaceChildren(
    ...evaluations
      .map((evaluation, index) => {
        const item = cloneTemplate("report-item", {
          open: HTMLButtonElement,
          summary: HTMLElement,
        });
        item.open.textContent = `Evaluation ${evaluation.id}`;
        item.open.onclick = () => status.run(() => showReport(index));
        const { overall, stopped } = evaluation.report;
        item.summary.textContent =
          ` ${formatTime(evaluation.createdAt)}: valid after repair ` +
          `${rateText(overall.valid.afterRepair)}${stopped === null ? "" : " (stopped)"}`;
        return item.root;
      })
      .reverse(),
  );
  if (evaluations.length > 0) showReport(shown === -1 ? evaluations.length - 1 : shown);
  if (listed.job) status.run(() => poll(listed.job));
}

/**
 * Reads the job's status every `POLL_MS` until it finishes, then the reports again. Each read
 * waits for the last.
 * @param {any} job its status as last read
 */
async function poll(job) {
  if (running?.id === job.id) return;
  running = job;
  let current = job;
  try {
    showJob(current);
    while (current.finishedAt === null) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      current = await getJson(jobPath(current.id));
      showJob(current);
    }
  } finally {
    running = null;
  }
  shown = -1;
  await loadReports();
  status.say(`Evaluation job ${current.id} ${current.state}.`);
}

/** @returns {number[]} the checked vibes' ids, in the list's order */
const checkedVibes = () =>
  [...page.vibeChoices.querySelectorAll("input:checked")].map((input) =>
    Number(/** @type {HTMLInputElement} */ (input).value),
  );

// Only the POST is guarded, so a second press can't start a second run; polling runs on its own.
const startEvaluation = oneAtATime(async () => {
  const vibeIds = checkedVibes();
  if (vibeIds.length === 0) throw new Error("Check at least one vibe to evaluate.");
  const count = Number(page.countInput.value);
  const total = count * vibeIds.length;
  if (
    !confirm(`Ask omlx for ${total} candidates (${count} for each of ${vibeIds.length} vibes)?`)
  ) {
    status.say("Not started.");
    return;
  }
  const job = await postJson(EVALUATIONS_PATH, { vibeIds, count });
  status.say(`Started evaluation job ${job.id}.`);
  status.run(() => poll(job));
});

async function cancelEvaluation() {
  const { job } = await getJson(EVALUATIONS_PATH);
  if (!job) throw new Error("No evaluation is running.");
  showJob(await postJson(`${jobPath(job.id)}/cancel`, {}));
}

/** @param {number} step +1 for the next report, -1 for the previous, newest first */
function moveReport(step) {
  if (evaluations.length === 0) throw new Error("No report to show yet.");
  const at = shown === -1 ? evaluations.length : shown;
  showReport((at - step + evaluations.length) % evaluations.length);
}

bindKeys(
  {
    evaluation: {
      nextReport: () => moveReport(1),
      previousReport: () => moveReport(-1),
      startEvaluation,
      cancelEvaluation,
      toList: () => location.assign("./"),
    },
  },
  "evaluation",
  status.run,
);

status.run(async () => {
  const [{ vibes }, { seeds }] = await Promise.all([getJson(VIBES_PATH), getJson(SEED_VIBES_PATH)]);
  const fromSeeds = new Set(seeds.map((/** @type {any} */ seed) => seed.vibeId));
  page.vibeChoices.replaceChildren(
    ...vibes.map((/** @type {any} */ vibe) => {
      const choice = cloneTemplate("vibe-choice", { input: HTMLInputElement, name: HTMLElement });
      choice.input.value = String(vibe.id);
      choice.input.checked = fromSeeds.has(vibe.id);
      choice.name.textContent = `${vibe.revision.name} (vibe ${vibe.id})`;
      return choice.root;
    }),
  );
  await loadReports();
  if (running === null) {
    status.say(
      vibes.length === 0
        ? "No vibes yet; load the seed vibes from the vibe list."
        : "Check the vibes, then press Shift+S to start.",
    );
  }
});

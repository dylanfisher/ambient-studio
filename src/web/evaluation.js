// The model test page (decisions 0030, 0032 and 0040): start a test over the ticked briefs, with
// or without the revision test, follow its job, and read the stored results in plain words. The briefs added from starting points start
// ticked. A test holds the shared model for a long while, so starting one asks to confirm, and
// its button stays off until the test finishes. A model test is an evaluation in the API. The
// taste model test (0045) has its own section, from taste-test-view.js, and the embed and fit
// jobs that make the taste model have theirs (0046), and the optimizer test (0059) has its own
// section, from optimizer-test-view.js.
/** @import { JobStatus } from "./job-progress.js" */
import { EVALUATION_COUNT } from "../domain/evaluation-size.js";
import { JOB_KIND } from "../domain/job-kind.js";
import {
  EMBEDDINGS_PATH,
  EVALUATIONS_PATH,
  getJson,
  JOBS_PATH,
  jobPath,
  PREFERENCE_MODELS_PATH,
  postJson,
  SEED_VIBES_PATH,
  startJob,
  VIBES_PATH,
} from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { factRows } from "./fact-rows.js";
import { followJob } from "./follow-job.js";
import { formatTime } from "./format-time.js";
import { jobControl } from "./job-control.js";
import { JOB_STATE } from "./job-progress.js";
import { jobBox } from "./job-view.js";
import { pageNumbers } from "./numbers-toggle.js";
import { oneAtATime } from "./one-at-a-time.js";
import { optimizerTestView } from "./optimizer-test-view.js";
import { NOT_STARTED, ownerJob } from "./owner-job.js";
import { analysisText, fitText } from "./preference-status-text.js";
import {
  meaningText,
  rangeText,
  rateText,
  rejectsText,
  responseFormatText,
  revisionFacts,
  revisionVerdictText,
  revisionVerdictWords,
  timeText,
} from "./report-text.js";
import { statusLine } from "./status-line.js";
import { tasteTestView } from "./taste-test-view.js";
import { costText } from "./test-cost.js";
import "./topbar-jobs.js";

const status = statusLine();
pageNumbers("evaluation.html");
const page = elementsById({
  briefChoices: HTMLElement,
  reviseInput: HTMLInputElement,
  countInput: HTMLInputElement,
  startButton: HTMLButtonElement,
  jobBox: HTMLElement,
  noReports: HTMLElement,
  reportList: HTMLUListElement,
  reportView: HTMLElement,
  reportHeading: HTMLElement,
  reportParams: HTMLElement,
  reportStopped: HTMLElement,
  reportMeaning: HTMLElement,
  reportRevision: HTMLElement,
  reportRevisionMeaning: HTMLElement,
  reportRevisionNumbers: HTMLElement,
  reportTallies: HTMLElement,
  latencyFirst: HTMLElement,
  latencyRepair: HTMLElement,
  latencyTreatment: HTMLElement,
  latencyControl: HTMLElement,
  firstTokenFirst: HTMLElement,
  firstTokenRepair: HTMLElement,
  firstTokenTreatment: HTMLElement,
  firstTokenControl: HTMLElement,
  responseFormat: HTMLElement,
  embedButton: HTMLButtonElement,
  fitButton: HTMLButtonElement,
  fitJobBox: HTMLElement,
  analysisState: HTMLElement,
  fitState: HTMLElement,
});
page.countInput.value = String(EVALUATION_COUNT.default);
page.countInput.max = String(EVALUATION_COUNT.max);
// The suggested count follows the mode, but a count the owner typed is kept.
page.reviseInput.onchange = () => {
  const [from, to] = page.reviseInput.checked
    ? [EVALUATION_COUNT.default, EVALUATION_COUNT.revise]
    : [EVALUATION_COUNT.revise, EVALUATION_COUNT.default];
  if (Number(page.countInput.value) === from) page.countInput.value = String(to);
};
const start = jobControl(page.startButton);

/** @type {any[]} every stored test, oldest first */
let evaluations = [];
/** @type {number} the index of the result shown, -1 for none */
let shown = -1;
/** @type {number | null} the id of the test job being followed */
let following = null;
/** @type {boolean | null} whether the model thinks before answering, from the server */
let thinking = null;

/**
 * @param {string} title
 * @param {any} tally a brief's or the overall tally
 * @param {number} maxTokens the length limit each answer had
 * @param {boolean} withMeaning false for the overall card, whose meaning heads the result
 */
function tallyCard(title, tally, maxTokens, withMeaning) {
  const card = cloneTemplate("tally", {
    title: HTMLElement,
    made: HTMLElement,
    meaning: HTMLElement,
    validBefore: HTMLElement,
    validBeforeRange: HTMLElement,
    validAfter: HTMLElement,
    validAfterRange: HTMLElement,
    schemaBefore: HTMLElement,
    schemaAfter: HTMLElement,
    truncated: HTMLElement,
    failed: HTMLElement,
    rejectsFirst: HTMLElement,
    rejectsAfter: HTMLElement,
    revision: HTMLElement,
    revisionFacts: HTMLElement,
  });
  card.title.textContent = title;
  card.made.textContent = `: ${tally.made} of ${tally.requested} asked for were made`;
  card.meaning.hidden = !withMeaning;
  card.meaning.textContent = withMeaning ? meaningText(tally) : "";
  card.validBefore.textContent = rateText(tally.valid.beforeRepair);
  card.validBeforeRange.textContent = rangeText(tally.valid.beforeRepair);
  card.validAfter.textContent = rateText(tally.valid.afterRepair);
  card.validAfterRange.textContent = rangeText(tally.valid.afterRepair);
  card.schemaBefore.textContent = rateText(tally.schemaValid.beforeRepair);
  card.schemaAfter.textContent = rateText(tally.schemaValid.afterRepair);
  card.truncated.textContent = `${tally.truncated} (the answer reached its length limit of ${maxTokens} tokens, a token being 3 to 4 characters, and stopped)`;
  card.failed.textContent = `${tally.requestFailed} (the model was busy, too slow or stopped; these are left out of the rates above)`;
  card.rejectsFirst.textContent = rejectsText(tally.rejects.firstTry);
  card.rejectsAfter.textContent = rejectsText(tally.rejects.afterRepair);
  const facts = revisionFacts(tally);
  card.revision.hidden = facts === null;
  card.revisionFacts.replaceChildren(...factRows(facts ?? []));
  return card.root;
}

/** @param {number} index into `evaluations` */
function showReport(index) {
  const evaluation = evaluations[index];
  if (!evaluation) throw new Error("No result to show yet.");
  shown = index;
  const { params, report } = evaluation;
  page.reportView.hidden = false;
  page.reportHeading.textContent = `Model test ${evaluation.id}, ${formatTime(evaluation.createdAt)}`;
  const briefs = report.vibes.map((/** @type {any} */ vibe) => vibe.name).join(", ");
  page.reportParams.textContent =
    `Asked for ${params.count} candidates for each of ${report.vibes.length} brief${report.vibes.length === 1 ? "" : "s"} (${briefs}), ` +
    `from the model ${params.model}. Random seed ${params.seed}, which lets the same test be asked again.` +
    (params.revise === true
      ? " With the revision test: each answer that missed was revised twice, with and without its measurements."
      : "");
  page.reportStopped.hidden = report.stopped === null;
  page.reportStopped.textContent =
    report.stopped === null ? "" : `The test stopped early: ${report.stopped}`;
  page.reportMeaning.textContent = meaningText(report.overall);
  const verdict = revisionVerdictWords(report.overall);
  page.reportRevision.hidden = verdict === null;
  page.reportRevisionMeaning.textContent = verdict ?? "";
  page.reportRevisionNumbers.textContent = revisionVerdictText(report.overall) ?? "";
  page.reportTallies.replaceChildren(
    tallyCard("All briefs", report.overall, params.maxTokens, false),
    // One brief's card would repeat the overall one.
    ...(report.vibes.length === 1 ? [] : report.vibes).map((/** @type {any} */ vibe) =>
      tallyCard(vibe.name, vibe, params.maxTokens, true),
    ),
  );
  page.latencyFirst.textContent = `First answers: ${timeText(report.latencyMs.firstTry)}`;
  page.latencyRepair.textContent = `Fixes: ${timeText(report.latencyMs.repair)}`;
  page.firstTokenFirst.textContent = `First answers: ${timeText(report.firstTokenMs.firstTry)}`;
  page.firstTokenRepair.textContent = `Fixes: ${timeText(report.firstTokenMs.repair)}`;
  // Reports stored before the revision test have no revisionTiming.
  const arms = report.revisionTiming ?? null;
  for (const [element, line] of /** @type {[HTMLElement, string][]} */ ([
    [
      page.latencyTreatment,
      `Revisions with the measurements: ${timeText(arms?.latencyMs.treatment ?? null)}`,
    ],
    [page.latencyControl, `Revisions without them: ${timeText(arms?.latencyMs.control ?? null)}`],
    [
      page.firstTokenTreatment,
      `Revisions with the measurements: ${timeText(arms?.firstTokenMs.treatment ?? null)}`,
    ],
    [
      page.firstTokenControl,
      `Revisions without them: ${timeText(arms?.firstTokenMs.control ?? null)}`,
    ],
  ])) {
    element.hidden = arms === null;
    element.textContent = arms === null ? "" : line;
  }
  page.responseFormat.textContent = responseFormatText(report.responseFormat);
  for (const [i, item] of [...page.reportList.children].entries()) {
    // The list runs newest first.
    item
      .querySelector("button")
      ?.setAttribute("aria-current", String(i === evaluations.length - 1 - index));
  }
}

/** Reads the results and the unfinished test, if any, and follows the test until it finishes. */
async function loadReports() {
  const listed = await getJson(EVALUATIONS_PATH);
  evaluations = listed.evaluations;
  thinking = listed.thinking;
  page.noReports.hidden = evaluations.length > 0;
  // Newest first in the list; `evaluations` stays oldest first, as the server returns it.
  page.reportList.replaceChildren(
    ...evaluations
      .map((evaluation, index) => {
        const item = cloneTemplate("report-item", {
          open: HTMLButtonElement,
          name: HTMLElement,
          rate: HTMLElement,
        });
        const { overall, stopped } = evaluation.report;
        item.name.textContent = `Test ${evaluation.id}, ${formatTime(evaluation.createdAt)}${stopped === null ? "" : " (stopped early)"}`;
        item.rate.textContent = `: worked after one fix ${rateText(overall.valid.afterRepair)}`;
        item.open.title = `Shows the result of model test ${evaluation.id} below.`;
        item.open.onclick = () => status.run(() => showReport(index));
        return item.root;
      })
      .reverse(),
  );
  if (evaluations.length > 0) showReport(shown === -1 ? evaluations.length - 1 : shown);
  if (listed.job) status.run(() => follow(listed.job));
}

/** @param {JobStatus} job */
async function cancel(job) {
  box?.show(await postJson(`${jobPath(job.id)}/cancel`, {}));
}

/** @type {ReturnType<typeof jobBox> | null} */
let box = null;

/**
 * Shows the test's progress until it finishes, with the start button off, then the results.
 * @param {JobStatus} job
 */
async function follow(job) {
  if (following === job.id) return;
  following = job.id;
  box?.root.remove();
  const shownBox = jobBox((current) => status.run(() => cancel(current)));
  box = shownBox;
  page.jobBox.append(shownBox.root);
  start.hold(job);
  try {
    const finished = await followJob(job, (current) => shownBox.show(current));
    status.say(
      finished.state === JOB_STATE.done
        ? "The model test is done; its result is below."
        : `The model test ${finished.state === JOB_STATE.failed ? "stopped on an error" : "was stopped"}; what it measured is below.`,
    );
  } finally {
    following = null;
    start.release();
  }
  shown = -1;
  await loadReports();
}

/** @returns {number[]} the ticked briefs' ids, in the list's order */
const tickedBriefs = () =>
  [...page.briefChoices.querySelectorAll("input:checked")].map((input) =>
    Number(/** @type {HTMLInputElement} */ (input).value),
  );

const startTest = oneAtATime(async () => {
  const vibeIds = tickedBriefs();
  if (vibeIds.length === 0) throw new Error("Tick at least one brief to test.");
  const count = Number(page.countInput.value);
  const revise = page.reviseInput.checked;
  if (thinking === null) throw new Error("The page is still loading; try again in a moment.");
  if (!confirm(costText({ count, briefs: vibeIds.length, revise, thinking }))) {
    status.say(NOT_STARTED);
    return;
  }
  start.wait();
  try {
    const { job, refused } = await startJob(EVALUATIONS_PATH, { vibeIds, count, revise });
    status.say(refused ? `${refused} Showing that test's progress.` : "The model test started.");
    status.run(() => follow(job));
  } catch (error) {
    start.release();
    throw error;
  }
});

page.startButton.onclick = () => status.run(startTest);

/** Says where the taste model stands, from the store rather than the jobs (decision 0068). */
async function showPreferenceStatus() {
  const { analysis, fit } = await getJson(PREFERENCE_MODELS_PATH);
  page.analysisState.textContent = analysisText(analysis);
  page.fitState.textContent = fitText(fit);
}

/** The embed and fit jobs' buttons, by the kind of job each starts (decisions 0042, 0044). */
const ownerJobs = new Map([
  [
    JOB_KIND.embed,
    ownerJob(status, {
      button: page.embedButton,
      boxes: page.fitJobBox,
      path: EMBEDDINGS_PATH,
      started: "The sound analysis started.",
      done: "The sound analysis is done. Fit the taste model next.",
      onEnd: showPreferenceStatus,
    }),
  ],
  [
    JOB_KIND.fit,
    ownerJob(status, {
      button: page.fitButton,
      boxes: page.fitJobBox,
      path: PREFERENCE_MODELS_PATH,
      started: "Fitting the taste model started.",
      done: "The taste model is fitted. Each brief's page says what it learned, and its next candidates are ranked by it.",
      onEnd: showPreferenceStatus,
    }),
  ],
]);

/** Follows an embed or fit job already queued or running, so a reload shows it. */
async function followOwnerJobs() {
  const { jobs } = await getJson(JOBS_PATH);
  for (const job of jobs) {
    const view = ownerJobs.get(job.kind);
    if (view && job.finishedAt === null) status.run(() => view.follow(job));
  }
}

status.run(async () => {
  const [{ vibes }, { seeds }] = await Promise.all([getJson(VIBES_PATH), getJson(SEED_VIBES_PATH)]);
  const fromSeeds = new Set(seeds.map((/** @type {any} */ seed) => seed.vibeId));
  page.briefChoices.replaceChildren(
    ...vibes.map((/** @type {any} */ vibe) => {
      const choice = cloneTemplate("brief-choice", { input: HTMLInputElement, name: HTMLElement });
      choice.input.value = String(vibe.id);
      choice.input.checked = fromSeeds.has(vibe.id);
      choice.input.title = `Includes the brief ${vibe.revision.name} in the next model test.`;
      choice.name.textContent = vibe.revision.name;
      return choice.root;
    }),
  );
  await loadReports();
  await tasteTestView(status);
  await optimizerTestView(status, vibes);
  await showPreferenceStatus();
  await followOwnerJobs();
  if (following === null) {
    status.say(
      vibes.length === 0
        ? "No briefs yet; add the starting points from the dashboard first."
        : "Tick the briefs to test, then press Start the model test.",
    );
  }
});

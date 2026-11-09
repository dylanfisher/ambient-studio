// The taste model test's section of the model test page (decision 0045): start the test, follow
// its job, and show the last report, one card per brief. It runs on the processor, so it needs
// no confirm the way a model test does.
/** @import { JobStatus } from "./job-progress.js" */
/** @import { statusLine } from "./status-line.js" */
import { getJson, jobPath, PREFERENCE_TESTS_PATH, postJson, startJob } from "./api.js";
import { cloneTemplate } from "./clone-template.js";
import { elementsById } from "./element-by-id.js";
import { factRows } from "./fact-rows.js";
import { followJob } from "./follow-job.js";
import { formatTime } from "./format-time.js";
import { jobControl } from "./job-control.js";
import { endedText, JOB_STATE } from "./job-progress.js";
import { jobBox } from "./job-view.js";
import { oneAtATime } from "./one-at-a-time.js";
import { tasteFacts, tasteSummary, tasteVerdict } from "./taste-test-text.js";

/**
 * Wires the section and shows the last report.
 * @param {ReturnType<typeof statusLine>} status the page's status line
 */
export function tasteTestView(status) {
  const page = elementsById({
    tasteButton: HTMLButtonElement,
    tasteWhen: HTMLElement,
    tasteJobBox: HTMLElement,
    tasteNone: HTMLElement,
    tasteResults: HTMLElement,
  });
  const start = jobControl(page.tasteButton);
  /** @type {ReturnType<typeof jobBox> | null} */
  let box = null;
  /** @type {number | null} */
  let following = null;

  /** @param {any} report */
  function show(report) {
    page.tasteNone.hidden = report !== null;
    page.tasteWhen.textContent = report === null ? "" : `Last run ${formatTime(report.createdAt)}.`;
    page.tasteResults.replaceChildren(
      ...(report?.vibes ?? []).map((/** @type {any} */ vibe) => {
        const card = cloneTemplate("taste-card", {
          title: HTMLElement,
          verdict: HTMLElement,
          summary: HTMLElement,
          facts: HTMLElement,
        });
        card.title.textContent = vibe.name;
        card.verdict.textContent = tasteVerdict(vibe);
        card.summary.textContent = tasteSummary(vibe);
        card.facts.replaceChildren(...factRows(tasteFacts(vibe)));
        card.facts.hidden = vibe.test === null;
        return card.root;
      }),
    );
  }

  /** @param {JobStatus} job */
  async function follow(job) {
    if (following === job.id) return;
    following = job.id;
    box?.root.remove();
    const shownBox = jobBox((current) =>
      status.run(async () => shownBox.show(await postJson(`${jobPath(current.id)}/cancel`, {}))),
    );
    box = shownBox;
    page.tasteJobBox.append(shownBox.root);
    start.hold(job);
    try {
      const finished = await followJob(job, (current) => shownBox.show(current));
      status.say(
        finished.state === JOB_STATE.done
          ? "The taste model test is done; its result is below."
          : `${endedText(finished)} The last finished result is shown.`,
      );
    } finally {
      following = null;
      start.release();
    }
    await load();
  }

  async function load() {
    const { report, job } = await getJson(PREFERENCE_TESTS_PATH);
    show(report);
    if (job) status.run(() => follow(job));
  }

  const startTest = oneAtATime(async () => {
    start.wait();
    try {
      const { job, refused } = await startJob(PREFERENCE_TESTS_PATH, {});
      status.say(
        refused ? `${refused} Showing that test's progress.` : "The taste model test started.",
      );
      status.run(() => follow(job));
    } catch (error) {
      start.release();
      throw error;
    }
  });
  page.tasteButton.onclick = () => status.run(startTest);
  return load();
}

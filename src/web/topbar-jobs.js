// The top bar's job indicator, on every page: for each lane of the server's job runner, the job
// running there with a bar from its count and a Cancel (decisions 0073, 0092), read every
// `POLL_MS` while the page is in view, each read waiting for the last (0028). A page imports it
// for that alone. The page that started a job follows it in its own box, which shows it
// cancelled however it was cancelled.
/** @import { JobsSummary } from "./jobs-summary.js" */
import { getJson, JOBS_PATH, jobPath, postJson } from "./api.js";
import { elementsById } from "./element-by-id.js";
import { laneSummaries } from "./jobs-summary.js";
import { POLL_MS } from "./poll-ms.js";
import { showProgress } from "./progress-bar.js";

const parts = elementsById({
  topbarJobs: HTMLElement,
  topbarMainJob: HTMLElement,
  topbarMainText: HTMLElement,
  topbarMainBar: HTMLElement,
  topbarMainFill: HTMLElement,
  topbarMainCancel: HTMLButtonElement,
  topbarWordsJob: HTMLElement,
  topbarWordsText: HTMLElement,
  topbarWordsBar: HTMLElement,
  topbarWordsFill: HTMLElement,
  topbarWordsCancel: HTMLButtonElement,
});

/**
 * One lane's entry. Its Cancel cancels the job shown; when the cancel fails, the entry says so
 * for as long as it shows that job.
 * @param {{ root: HTMLElement, text: HTMLElement, bar: HTMLElement, fill: HTMLElement,
 *   cancel: HTMLButtonElement }} entry
 */
function laneEntry({ root, text, bar, fill, cancel }) {
  /** @type {number | null} */
  let shown = null;
  /** @type {{ id: number, message: string } | null} */
  let failed = null;
  cancel.onclick = async () => {
    if (shown === null) return;
    const id = shown;
    cancel.disabled = true;
    try {
      await postJson(`${jobPath(id)}/cancel`, {});
    } catch (error) {
      failed = { id, message: /** @type {Error} */ (error).message };
      cancel.disabled = false;
    }
  };
  return {
    /** @param {JobsSummary | null} summary */
    show(summary) {
      root.hidden = summary === null;
      bar.hidden = false;
      cancel.hidden = false;
      if (!summary) return;
      if (summary.id !== shown) {
        shown = summary.id;
        cancel.disabled = false;
      }
      const failure = failed?.id === summary.id ? failed.message : null;
      text.textContent = failure ? `${summary.text} · the cancel failed` : summary.text;
      root.title = failure ? `${summary.title} The cancel failed: ${failure}` : summary.title;
      showProgress(bar, fill, summary.fraction, false);
    },
    /** @param {string} message */
    unreadable(message) {
      root.hidden = false;
      bar.hidden = true;
      cancel.hidden = true;
      text.textContent = "Can't read the jobs";
      root.title = message;
    },
  };
}

const main = laneEntry({
  root: parts.topbarMainJob,
  text: parts.topbarMainText,
  bar: parts.topbarMainBar,
  fill: parts.topbarMainFill,
  cancel: parts.topbarMainCancel,
});
const words = laneEntry({
  root: parts.topbarWordsJob,
  text: parts.topbarWordsText,
  bar: parts.topbarWordsBar,
  fill: parts.topbarWordsFill,
  cancel: parts.topbarWordsCancel,
});

/** Reads the jobs once and shows each lane's, or hides the indicator when none runs. */
async function show() {
  const summaries = laneSummaries((await getJson(JOBS_PATH)).jobs, Date.now());
  parts.topbarJobs.hidden = summaries.main === null && summaries.words === null;
  main.show(summaries.main);
  words.show(summaries.words);
}

/** Resolves once the page is in view, at once when it is. */
const inView = () =>
  new Promise((resolve) => {
    if (!document.hidden) return resolve(undefined);
    document.addEventListener("visibilitychange", () => inView().then(resolve), { once: true });
  });

// Not awaited at the top level: that would hold the importing page's module until it ended.
async function poll() {
  for (;;) {
    await inView();
    try {
      await show();
    } catch (error) {
      // Shown in the bar, and read again next time, so a server restart clears it.
      parts.topbarJobs.hidden = false;
      main.unreadable(/** @type {Error} */ (error).message);
      words.show(null);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

void poll();

// The top bar's job indicator, on every page: the server's running job with a bar from its
// count, read every `POLL_MS` while the page is in view, each read waiting for the last
// (decision 0028). A page imports it for that alone. It only reads; Cancel stays in the boxes
// of the page that started the job.
import { getJson, JOBS_PATH } from "./api.js";
import { elementsById } from "./element-by-id.js";
import { jobsSummary } from "./jobs-summary.js";
import { POLL_MS } from "./poll-ms.js";
import { showProgress } from "./progress-bar.js";

const parts = elementsById({
  topbarJobs: HTMLElement,
  topbarJobsText: HTMLElement,
  topbarJobsBar: HTMLElement,
  topbarJobsFill: HTMLElement,
});

/** Resolves once the page is in view, at once when it is. */
const inView = () =>
  new Promise((resolve) => {
    if (!document.hidden) return resolve(undefined);
    document.addEventListener("visibilitychange", () => inView().then(resolve), { once: true });
  });

/** Reads the jobs once and shows the one running, or hides the indicator when none is. */
async function show() {
  const summary = jobsSummary((await getJson(JOBS_PATH)).jobs, Date.now());
  parts.topbarJobs.hidden = summary === null;
  if (!summary) return;
  parts.topbarJobsText.textContent = summary.text;
  parts.topbarJobs.title = summary.title;
  parts.topbarJobsBar.hidden = false;
  showProgress(parts.topbarJobsBar, parts.topbarJobsFill, summary.fraction, false);
}

// Not awaited at the top level: that would hold the importing page's module until it ended.
async function poll() {
  for (;;) {
    await inView();
    try {
      await show();
    } catch (error) {
      // Shown in the bar, and read again next time, so a server restart clears it.
      parts.topbarJobs.hidden = false;
      parts.topbarJobsBar.hidden = true;
      parts.topbarJobsText.textContent = "Can't read the jobs";
      parts.topbarJobs.title = /** @type {Error} */ (error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

void poll();

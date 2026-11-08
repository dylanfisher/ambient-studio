// A job's progress box on a page, from the page's `job-progress` template (decision 0032): what
// it does, a badge for its state, a bar, its step sentence, why its excerpts weren't embedded
// when it says (0042), the time it has run, and a Cancel button while it hasn't finished.
/** @import { JobStatus } from "./job-progress.js" */
import { cloneTemplate } from "./clone-template.js";
import { jobProgress } from "./job-progress.js";

/** The badge classes in studio.css that color a badge. */
export const TONE = Object.freeze({ good: "good", bad: "bad", muted: "muted" });

/** The badge class for each state the box colors. */
const BADGE = Object.freeze({ Done: TONE.good, Failed: TONE.bad, Cancelled: TONE.muted });

/**
 * @param {(job: JobStatus) => unknown} onCancel what the box's Cancel button runs
 */
export function jobBox(onCancel) {
  const parts = cloneTemplate("job-progress", {
    title: HTMLElement,
    state: HTMLElement,
    elapsed: HTMLElement,
    cancel: HTMLButtonElement,
    bar: HTMLElement,
    fill: HTMLElement,
    step: HTMLElement,
    notEmbedded: HTMLElement,
    notRanked: HTMLElement,
    error: HTMLElement,
  });
  /** @type {JobStatus | null} */
  let shown = null;
  parts.cancel.onclick = () => {
    if (!shown) return;
    parts.cancel.disabled = true;
    onCancel(shown);
  };
  return {
    root: parts.root,
    /** @param {JobStatus} job */
    show(job) {
      shown = job;
      const progress = jobProgress(job, Date.now());
      parts.title.textContent = `${progress.title} (job ${job.id})`;
      parts.state.textContent = progress.state;
      const tone = BADGE[/** @type {keyof typeof BADGE} */ (progress.state)] ?? "";
      parts.state.className = `badge ${tone}`;
      parts.elapsed.textContent = progress.elapsed;
      parts.step.textContent = progress.step;
      parts.notEmbedded.hidden = progress.notEmbedded === null;
      parts.notEmbedded.textContent = progress.notEmbedded ?? "";
      parts.notRanked.hidden = progress.notRanked === null;
      parts.notRanked.textContent = progress.notRanked ?? "";
      parts.error.hidden = progress.error === null;
      parts.error.textContent = progress.error ?? "";
      parts.cancel.hidden = progress.finished;
      const percent = progress.fraction === null ? null : Math.round(progress.fraction * 100);
      parts.bar.classList.toggle("unknown", percent === null && !progress.finished);
      parts.fill.style.width = `${progress.finished ? 100 : (percent ?? 0)}%`;
      if (percent === null) parts.bar.removeAttribute("aria-valuenow");
      else parts.bar.setAttribute("aria-valuenow", String(percent));
    },
  };
}

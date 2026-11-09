// A `.progress` bar's fill and value from a job's count (decision 0032): a sliding bar while
// there is no count and the job hasn't finished, full once it has.

/**
 * @param {HTMLElement} bar the `.progress` element, with role progressbar
 * @param {HTMLElement} fill its `.progress-fill`
 * @param {number | null} fraction from 0 to 1, or null while there is no count
 * @param {boolean} finished
 */
export function showProgress(bar, fill, fraction, finished) {
  const percent = fraction === null ? null : Math.round(fraction * 100);
  bar.classList.toggle("unknown", percent === null && !finished);
  fill.style.width = `${finished ? 100 : (percent ?? 0)}%`;
  if (percent === null) bar.removeAttribute("aria-valuenow");
  else bar.setAttribute("aria-valuenow", String(percent));
}

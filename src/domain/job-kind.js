// The kinds of the jobs only the owner starts from the Model test page (decisions 0042, 0044,
// 0046). The server adds each job under its kind and the page finds a running one by it.
export const JOB_KIND = Object.freeze({
  /** The embed job: the sound analysis of every excerpt without one (0042). */
  embed: "embed",
  /** The fit job: every brief's taste model (0044). */
  fit: "fit",
});

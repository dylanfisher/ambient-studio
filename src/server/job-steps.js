// The sentences a job's progress gives the owner for what it is doing now (decision 0031). They
// are shown on the page as written, so they use plain words: the model, never omlx.

/** Each candidate and excerpt number is counted from 1. */
export const JOB_STEP = Object.freeze({
  /** @param {number} n @param {number} of */
  asking: (n, of) => `Asking the model for candidate ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  exploring: (n, of) => `Asking the model for variation ${n} of ${of}`,
  /** @param {number} n */
  repairing: (n) => `Asking the model to fix candidate ${n}`,
  busy: "Waiting for the model: it is busy with another request",
  /** @param {number} n @param {number} of */
  renderingCandidate: (n, of) => `Rendering the excerpt for candidate ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  measuring: (n, of) => `Measuring candidate ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  revising: (n, of) => `Revising candidate ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  renderingRevision: (n, of) => `Rendering the revision of candidate ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  renderingNudge: (n, of) => `Rendering the excerpt for nudge ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  renderingExcerpt: (n, of) => `Rendering excerpt ${n} of ${of}`,
});

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
  revisingControl: (n, of) =>
    `Asking the model for the control revision of candidate ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  renderingControl: (n, of) => `Rendering the control revision of candidate ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  renderingNudge: (n, of) => `Rendering the excerpt for nudge ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  renderingExcerpt: (n, of) => `Rendering excerpt ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  embeddingCandidate: (n, of) => `Analyzing the sound of candidate ${n} of ${of}`,
  fetchingEmbedder: "Loading the sound-analysis model; the first time, it downloads 0.8 GB",
  /** @param {number} n @param {number} of */
  embeddingExcerpt: (n, of) => `Analyzing the sound of excerpt ${n} of ${of}`,
  decodingRegion: "Reading the region from the recording",
  /** @param {number} n @param {number} of */
  measuringWindow: (n, of) => `Measuring window ${n} of ${of} of the region`,
  /** @param {number} n @param {number} of */
  preparingWindow: (n, of) => `Preparing window ${n} of ${of} of the region for sound analysis`,
  /** @param {number} n @param {number} of */
  embeddingWindow: (n, of) => `Analyzing the sound of window ${n} of ${of} of the region`,
  fittingCheck: "Checking that every rated excerpt's sound is analyzed",
  ranking: "Ranking the candidates by your taste",
  /** @param {number} n @param {number} of */
  fittingVibe: (n, of) => `Learning your taste for brief ${n} of ${of}`,
  testingCount: "Counting each brief's A/B choices",
  /** @param {number} n @param {number} of @param {number} session @param {number} sessions */
  testingFold: (n, of, session, sessions) =>
    `Testing brief ${n} of ${of}: learning without session ${session} of ${sessions}, then predicting it`,
});

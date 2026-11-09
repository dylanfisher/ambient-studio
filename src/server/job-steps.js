// The sentences a job's progress gives the owner for what it is doing now (decision 0031). They
// are shown on the page as written, so they use plain words: the model, never omlx.

/** Each candidate and excerpt number is counted from 1. */
export const JOB_STEP = Object.freeze({
  /** @param {number} n @param {number} of */
  asking: (n, of) => `Asking the model for candidate ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  exploring: (n, of) => `Asking the model for variation ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  breeding: (n, of) => `Asking the model for child ${n} of ${of}`,
  /** @param {number} n */
  repairing: (n) => `Asking the model to fix candidate ${n}`,
  busy: "Waiting for the model: it is busy with another request",
  readingMaterial: "Reading the brief's sketches and map for the proposal",
  proposing: "Asking the model to propose the track",
  repairingProposal: "Asking the model to fix its proposal",
  readingSection: "Reading the section's sketch, its lineage and its neighbors",
  developing: "Asking the model to develop the section",
  repairingDevelopment: "Asking the model to fix its development",
  readingBridge: "Reading the two sections' sketches and where they meet",
  draftingBrief: "Asking the model to write the brief from your words",
  repairingBrief: "Asking the model to fix the brief it wrote",
  readingWords: "Asking the model to read your words as settings",
  repairingWords: "Asking the model to fix its reading of your words",
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
  renderingMutation: (n, of) => `Rendering the mutation of child ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  renderingExcerpt: (n, of) => `Rendering excerpt ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  embeddingCandidate: (n, of) => `Analyzing the sound of candidate ${n} of ${of}`,
  fetchingEmbedder: "Loading the sound-analysis model; the first time, it downloads 0.8 GB",
  /** @param {number} n @param {number} of */
  embeddingExcerpt: (n, of) => `Analyzing the sound of excerpt ${n} of ${of}`,
  decodingRegion: "Reading the region from the recording",
  /** @param {number} seconds */
  renderingSection: (seconds) => `Rendering the section's ${seconds} s to play`,
  /** @param {number} n @param {number} of @param {number} chunk @param {number} chunks */
  renderingTrack: (n, of, chunk, chunks) =>
    `Rendering section ${n} of ${of}, chunk ${chunk} of ${chunks}`,
  normalizingTrack: "Bringing the track to its loudness target",
  encodingTrack: "Writing the track's WAV and its preview",
  exportingTrack: "Writing the export's WAV, FLAC and manifest",
  /** @param {number} n @param {number} of @param {string} voice @param {string} step */
  renderingStem: (n, of, voice, step) =>
    `Stem ${n} of ${of}, ${voice}: ${step.charAt(0).toLowerCase()}${step.slice(1)}`,
  /** @param {number} n @param {number} of */
  measuringWindow: (n, of) => `Measuring window ${n} of ${of} of the region`,
  /** @param {number} n @param {number} of */
  preparingWindow: (n, of) => `Preparing window ${n} of ${of} of the region for sound analysis`,
  /** @param {number} n @param {number} of */
  embeddingWindow: (n, of) => `Analyzing the sound of window ${n} of ${of} of the region`,
  fittingCheck: "Checking that every rated excerpt's sound is analyzed",
  ranking: "Ranking the candidates by your taste",
  /** @param {number} n @param {number} of */
  searching: (n, of) => `Searching: generation ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  steering: (n, of) => `Steering: generation ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  searchControl: (n, of) => `Scoring the search's control nudges: batch ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  filling: (n, of) => `Filling the map: step ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  fillControl: (n, of) => `Filling the map's control: nudge ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  earDrawing: (n, of) => `Searching by ear: drawing and rendering pair ${n} of ${of}`,
  /** @param {number} n @param {number} of */
  earListening: (n, of) =>
    `Searching by ear: waiting for your choice on pair ${n} of ${of}, and rendering what could come next`,
  /** @param {number} n @param {number} of */
  fittingVibe: (n, of) => `Learning your taste for brief ${n} of ${of}`,
  /**
   * A step of one of the optimizer test's searches (decision 0059).
   * @param {number} n @param {number} of @param {number} run @param {number} runs
   * @param {string} step the search's own step
   */
  optimizerTest: (n, of, run, runs, step) =>
    `Testing the optimizer on brief ${n} of ${of}, search ${run} of ${runs}: ${step}`,
  testingCount: "Counting each brief's A/B choices",
  /** @param {number} n @param {number} of @param {number} session @param {number} sessions */
  testingFold: (n, of, session, sessions) =>
    `Testing brief ${n} of ${of}: learning without session ${session} of ${sessions}, then predicting it`,
});

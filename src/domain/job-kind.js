// The kinds of the jobs only the owner starts from the Model test page (decisions 0042, 0044,
// 0046), the References and brief pages (0051, 0067) and the timeline (0061). The server adds each
// job under its kind and the page finds a running one by it.
export const JOB_KIND = Object.freeze({
  /** The Analyze job: one reference region's features and embedding (0051). */
  analyze: "analyze",
  /** The embed job: the sound analysis of every excerpt without one (0042). */
  embed: "embed",
  /** The fit job: every brief's taste model (0044). */
  fit: "fit",
  /** The optimizer test: searches against their controls on the chosen briefs (0059). */
  optimizerTest: "optimizer-test",
  /** One track section's window, rendered for its player on the timeline (0061). */
  sectionAudio: "section-audio",
  /** A whole track's render and its preview (0062). */
  trackRender: "track-render",
  /** The span around one of a track's transitions, rendered to play (0062). */
  seamPreview: "seam-preview",
  /** A rendered track's WAV, FLAC and manifest, written to a new folder (0062). */
  trackExport: "track-export",
  /** The model's proposed arrangement for a new track, stored as its first revision (0067). */
  propose: "propose",
  /** The model's draft of a brief from the owner's words, to fill the brief form (0074). */
  draftBrief: "draft-brief",
  /** The model's development of one section of a track, from the timeline (0079). */
  developSection: "develop-section",
  /** The model's bridge for one join of a track, written between its two sections (0081). */
  bridge: "bridge-join",
  /** A field set's new values, read by the model from the owner's words, to fill a page (0084). */
  words: "words",
});

/** The job runner's lanes (decision 0092). Each runs one job at a time, in the order added. */
export const JOB_LANE = Object.freeze({
  /** Every job but a words job, as the runner ran all jobs before 0092 (0026). */
  main: "main",
  /** Words jobs only: one model request and its repair, beside whatever the main lane runs. */
  words: "words",
});

/**
 * @param {string} kind
 * @returns {(typeof JOB_LANE)[keyof typeof JOB_LANE]} the lane a job of this kind runs in
 */
export const jobLane = (kind) => (kind === JOB_KIND.words ? JOB_LANE.words : JOB_LANE.main);

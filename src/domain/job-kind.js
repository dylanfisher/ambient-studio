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
});

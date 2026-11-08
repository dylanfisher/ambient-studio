// The kinds of the jobs only the owner starts from the Model test page (decisions 0042, 0044,
// 0046), the References and brief pages (0051) and the timeline (0061). The server adds each
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
});

// The operators a candidate stores, naming how it was made (decisions 0036–0038, 0054–0056,
// 0058); a first try from a plain request stores null. The server writes them and the pages
// read them. `arrange` (0067) and `shift` (0075) name a request group instead, as they make no
// candidate.
export const OPERATOR = Object.freeze({
  /** The model's one revision of a first try whose excerpt missed (0036). */
  revise: "revise",
  /** 3h's control arm: the same follow-up without the measurements, never shown. */
  reviseControl: "revise-control",
  /** Seeded steps in the vector view, with no model request (0037). */
  nudge: "nudge",
  /** A fresh first prompt holding a base (0038). */
  explore: "explore",
  /** A point of a CMA-ES search scored by the taste model, with no model request (0054). */
  optimize: "optimize",
  /** 5e's control arm: as many medium nudges from the search's base, never shown. */
  optimizeControl: "optimize-control",
  /** A point of a search by ear, compared by the owner with the run's best (0055). */
  optimizeEar: "optimize-ear",
  /** A point of a steer along a brief's directions or toward its regions (0056). */
  steer: "steer",
  /** Breeding: a crossover child of two parents by the model, or its one small nudge (0058). */
  breed: "breed",
  /** A fill step of the brief's map: a nudge of an elite beside an empty cell (0057). */
  elite: "elite",
  /** The fill's control: as many medium nudges from the same starts, never shown (0057). */
  eliteControl: "elite-control",
  /** A track's arrangement proposed by the model (0067); its generations name it in their
   * request group, since they make a track revision, not a candidate. */
  arrange: "arrange",
  /** The model's reading of the owner's words as a search by ear's shift (0075); its
   * generation names it in its request group, since it makes no candidate. */
  shift: "shift",
  /** A saved brief reworked by the model from the owner's words (0074); its generations name it
   * in their request group, since they make no candidate. */
  draft: "draft",
  /** The model's reading of the owner's words as values for a field set (0084); its
   * generations name it in their request group, since they make no candidate. */
  words: "words",
});

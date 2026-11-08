// The operators a candidate stores, naming how it was made (decisions 0036–0038, 0054); a first
// try from a plain request stores null. The server writes them and the pages read them.
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
});
